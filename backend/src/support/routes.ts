import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { answerSupportMessage } from "./assistant.js";
import { redactSupportMessage } from "./core.js";
import { clientAddress } from "../http/client-address.ts";
import { llmConfigured } from "../runners/llm/client.js";
import {
  hashOpaqueToken,
  hashSupportPassword,
  newOpaqueToken,
  normalizeSupportEmail,
  secretMatches,
  validateSupportPassword,
  verifySupportPassword,
} from "./security.js";

const SESSION_COOKIE = "agon_support_session";
const SESSION_SECONDS = 12 * 60 * 60;
const EMAIL = z.string().trim().email().max(254);
const STAFF_ROLES = ["support", "technical"] as const;
const TICKET_STATUSES = ["ai_triage", "open", "in_progress", "waiting_user", "resolved", "closed"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

type SupportStaff = { staffId: string; email: string; displayName: string; role: (typeof STAFF_ROLES)[number]; mustChangePassword: boolean };
type Variables = { supportStaff: SupportStaff };

const staffCreateSchema = z.object({
  email: EMAIL,
  displayName: z.string().trim().min(2).max(80),
  password: z.string().min(12).max(128),
  role: z.enum(STAFF_ROLES).default("support"),
});
const ticketCreateSchema = z.object({
  requesterName: z.string().trim().min(2).max(80).optional(),
  requesterEmail: EMAIL,
  subject: z.string().trim().min(4).max(140),
  message: z.string().trim().min(2).max(4_000),
});
const messageSchema = z.object({ message: z.string().trim().min(1).max(4_000) });
const dummyPasswordHash = hashSupportPassword("AGON-dummy-password-2026");

function ticketReference(): string {
  return `AGN-${Date.now().toString(36).toUpperCase()}-${newOpaqueToken(3).toUpperCase()}`;
}

function cookieSecure(): boolean {
  return config.auth.appUrl.startsWith("https://");
}

function requestIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return clientAddress((name) => c.req.header(name));
}

async function consumeRateLimit(key: string, maximum: number, windowMinutes: number): Promise<boolean> {
  const { rows } = await query<{ request_count: number }>(
    `insert into agon_support_rate_limits (limit_key, request_count, window_started_at, updated_at)
     values ($1, 1, now(), now())
     on conflict (limit_key) do update set
       request_count = case when agon_support_rate_limits.window_started_at < now() - ($2 * interval '1 minute') then 1 else agon_support_rate_limits.request_count + 1 end,
       window_started_at = case when agon_support_rate_limits.window_started_at < now() - ($2 * interval '1 minute') then now() else agon_support_rate_limits.window_started_at end,
       updated_at = now()
     returning request_count`,
    [hashOpaqueToken(key), windowMinutes],
  );
  return Number(rows[0]?.request_count ?? maximum + 1) <= maximum;
}

async function getStaffFromSession(token: string | undefined): Promise<SupportStaff | null> {
  if (!token) return null;
  const { rows } = await query<{
    staff_id: string; email: string; display_name: string; role: SupportStaff["role"]; must_change_password: boolean;
  }>(`select s.staff_id::text, s.email, s.display_name, s.role, s.must_change_password
        from agon_support_sessions ss
        join agon_support_staff s on s.staff_id = ss.staff_id
       where ss.token_hash = $1 and ss.revoked_at is null and ss.expires_at > now() and s.status = 'active'
       limit 1`, [hashOpaqueToken(token)]);
  const row = rows[0];
  if (!row) return null;
  void query("update agon_support_sessions set last_seen_at = now() where token_hash = $1", [hashOpaqueToken(token)]);
  return { staffId: row.staff_id, email: row.email, displayName: row.display_name, role: row.role, mustChangePassword: row.must_change_password };
}

function serializeMessage(row: Record<string, unknown>) {
  return {
    messageId: row.message_id,
    authorType: row.author_type,
    authorName: row.author_name,
    body: row.body,
    visibility: row.visibility,
    createdAt: row.created_at,
  };
}

async function ticketForAccess(ticketId: string, token: string | undefined) {
  if (!token) return null;
  const { rows } = await query<Record<string, unknown>>(
    `select ticket_id::text, reference, requester_name, requester_email, subject, category, status, priority,
            assigned_staff_id::text, ai_enabled, created_at, updated_at, last_message_at
       from agon_support_tickets where ticket_id = $1 and access_token_hash = $2 limit 1`,
    [ticketId, hashOpaqueToken(token)],
  );
  return rows[0] ?? null;
}

async function appendAssistant(ticketId: string, userMessage: string) {
  const history = await query<{ body: string }>(
    `select body from agon_support_messages where ticket_id = $1 and visibility = 'public' order by created_at desc limit 8`,
    [ticketId],
  );
  const answer = await answerSupportMessage(userMessage, history.rows.reverse().map((row) => row.body), ticketId);
  await query(
    `insert into agon_support_messages (message_id, ticket_id, author_type, author_name, body, visibility, metadata)
     values ($1, $2, 'assistant', 'AGON guide', $3, 'public', $4::jsonb)`,
    [randomUUID(), ticketId, answer.reply, JSON.stringify({ mode: answer.mode })],
  );
  await query(
    `update agon_support_tickets
        set status = case when $2 then 'open' else status end,
            ai_enabled = case when $2 then false else ai_enabled end,
            updated_at = now(), last_message_at = now()
      where ticket_id = $1`,
    [ticketId, answer.escalate],
  );
  return answer;
}

export function createSupportRoutes() {
  const app = new Hono<{ Variables: Variables }>();

  const requireStaff: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
    const staff = await getStaffFromSession(getCookie(c, SESSION_COOKIE));
    if (!staff) return c.json({ error: "support sign-in required" }, 401);
    c.set("supportStaff", staff);
    await next();
  };
  const requireReadyStaff: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
    const staff = await getStaffFromSession(getCookie(c, SESSION_COOKIE));
    if (!staff) return c.json({ error: "support sign-in required" }, 401);
    if (staff.mustChangePassword) return c.json({ error: "password change required" }, 403);
    c.set("supportStaff", staff);
    await next();
  };

  app.post("/support/tickets", async (c) => {
    const parsed = ticketCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "email, subject, and message are required" }, 400);
    const allowed = await consumeRateLimit(`ticket:${normalizeSupportEmail(parsed.data.requesterEmail)}:${requestIp(c)}`, 10, 60);
    if (!allowed) return c.json({ error: "too many support requests; try again later" }, 429);
    const ticketId = randomUUID();
    const accessToken = newOpaqueToken();
    const reference = ticketReference();
    const requesterName = parsed.data.requesterName ?? "Customer";
    await query(
      `insert into agon_support_tickets
         (ticket_id, reference, requester_name, requester_email, access_token_hash, subject, category, status, priority)
       values ($1, $2, $3, $4, $5, $6, 'general', 'ai_triage', 'normal')`,
      [ticketId, reference, requesterName, normalizeSupportEmail(parsed.data.requesterEmail), hashOpaqueToken(accessToken), parsed.data.subject],
    );
    await query(
      `insert into agon_support_messages (message_id, ticket_id, author_type, author_name, body, visibility)
       values ($1, $2, 'user', $3, $4, 'public')`,
      [randomUUID(), ticketId, "You", redactSupportMessage(parsed.data.message)],
    );
    await query(`insert into agon_support_ticket_events (event_id, ticket_id, event_type, detail) values ($1,$2,'created',$3::jsonb)`, [randomUUID(), ticketId, JSON.stringify({ source: "support-chat" })]);
    await appendAssistant(ticketId, parsed.data.message);
    return c.json({ ticketId, reference, accessToken }, 201);
  });

  app.get("/support/tickets/:ticketId", async (c) => {
    const ticket = await ticketForAccess(c.req.param("ticketId"), c.req.header("x-support-ticket-token"));
    if (!ticket) return c.json({ error: "ticket not found" }, 404);
    const messages = await query<Record<string, unknown>>(
      `select message_id::text, author_type, author_name, body, visibility, created_at
         from agon_support_messages where ticket_id = $1 and visibility = 'public' order by created_at asc`,
      [c.req.param("ticketId")],
    );
    return c.json({ ticket, messages: messages.rows.map(serializeMessage) });
  });

  app.post("/support/tickets/:ticketId/messages", async (c) => {
    const ticket = await ticketForAccess(c.req.param("ticketId"), c.req.header("x-support-ticket-token"));
    if (!ticket) return c.json({ error: "ticket not found" }, 404);
    const parsed = messageSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "message is required" }, 400);
    const allowed = await consumeRateLimit(`message:${c.req.param("ticketId")}:${requestIp(c)}`, 60, 60);
    if (!allowed) return c.json({ error: "too many messages; try again later" }, 429);
    await query(
      `insert into agon_support_messages (message_id, ticket_id, author_type, author_name, body, visibility)
       values ($1, $2, 'user', $3, $4, 'public')`,
      [randomUUID(), c.req.param("ticketId"), "You", redactSupportMessage(parsed.data.message)],
    );
    await query(
      `update agon_support_tickets set status = case when status in ('waiting_user','resolved') then 'open' else status end,
       updated_at = now(), last_message_at = now() where ticket_id = $1`,
      [c.req.param("ticketId")],
    );
    if (ticket.ai_enabled === true && ticket.status === "ai_triage") await appendAssistant(c.req.param("ticketId"), parsed.data.message);
    return c.json({ ok: true });
  });

  app.post("/support/staff/login", async (c) => {
    const body = await c.req.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
    const email = typeof body?.email === "string" ? normalizeSupportEmail(body.email) : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!EMAIL.safeParse(email).success || password.length < 1 || password.length > 128) return c.json({ error: "invalid email or password" }, 401);
    const allowed = await consumeRateLimit(`login:${email}:${requestIp(c)}`, 10, 15);
    if (!allowed) return c.json({ error: "too many sign-in attempts; try again later" }, 429);
    const result = await query<{ staff_id: string; email: string; display_name: string; role: SupportStaff["role"]; password_hash: string; status: string; must_change_password: boolean; failed_login_attempts: number; locked_until: string | null }>(
      `select staff_id::text, email, display_name, role, password_hash, status, must_change_password, failed_login_attempts, locked_until
         from agon_support_staff where email = $1 limit 1`, [email],
    );
    const row = result.rows[0];
    if (!row) {
      await verifySupportPassword(password, await dummyPasswordHash);
      return c.json({ error: "invalid email or password" }, 401);
    }
    if (row.status !== "active" || (row.locked_until && new Date(row.locked_until).getTime() > Date.now())) {
      return c.json({ error: "invalid email or password" }, 401);
    }
    const valid = await verifySupportPassword(password, row.password_hash);
    if (!valid) {
      await query(
        `update agon_support_staff set failed_login_attempts = failed_login_attempts + 1,
         locked_until = case when failed_login_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
         updated_at = now() where staff_id = $1`, [row.staff_id],
      );
      return c.json({ error: "invalid email or password" }, 401);
    }
    const token = newOpaqueToken();
    await query("delete from agon_support_sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '7 days'");
    await query(`insert into agon_support_sessions (token_hash, staff_id, expires_at) values ($1, $2, now() + interval '12 hours')`, [hashOpaqueToken(token), row.staff_id]);
    await query(`update agon_support_staff set failed_login_attempts = 0, locked_until = null, last_login_at = now(), updated_at = now() where staff_id = $1`, [row.staff_id]);
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: cookieSecure(), sameSite: "Lax", path: "/", maxAge: SESSION_SECONDS });
    return c.json({ staff: { staffId: row.staff_id, email: row.email, displayName: row.display_name, role: row.role, mustChangePassword: row.must_change_password } });
  });

  app.post("/support/staff/logout", requireStaff, async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await query("update agon_support_sessions set revoked_at = now() where token_hash = $1", [hashOpaqueToken(token)]);
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: cookieSecure() });
    return c.json({ ok: true });
  });
  app.get("/support/staff/session", requireStaff, (c) => c.json({ staff: c.get("supportStaff") }));
  app.get("/support/health", (c) => c.json({ ok: true, ai: { enabled: config.support.aiEnabled, configured: llmConfigured(), dailyCapUsd: config.support.aiDailyUsd } }));
  app.post("/support/staff/password", requireStaff, async (c) => {
    const body = await c.req.json().catch(() => null) as { currentPassword?: unknown; newPassword?: unknown } | null;
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    const passwordError = validateSupportPassword(newPassword);
    if (passwordError) return c.json({ error: passwordError }, 400);
    const staff = c.get("supportStaff");
    const existing = await query<{ password_hash: string }>("select password_hash from agon_support_staff where staff_id = $1", [staff.staffId]);
    if (!existing.rows[0] || !(await verifySupportPassword(currentPassword, existing.rows[0].password_hash))) {
      return c.json({ error: "current password is incorrect" }, 401);
    }
    const passwordHash = await hashSupportPassword(newPassword);
    await query(`update agon_support_staff set password_hash = $2, must_change_password = false, updated_at = now() where staff_id = $1`, [staff.staffId, passwordHash]);
    return c.json({ ok: true });
  });

  app.get("/support/staff/tickets", requireReadyStaff, async (c) => {
    const status = c.req.query("status");
    const params: unknown[] = [];
    const where = status && (TICKET_STATUSES as readonly string[]).includes(status) ? (params.push(status), "where t.status = $1") : "";
    const { rows } = await query<Record<string, unknown>>(
      `select t.ticket_id::text, t.reference, t.requester_name, t.subject, t.status, t.priority,
              t.assigned_staff_id::text, s.display_name as assigned_name, t.last_message_at, t.updated_at
         from agon_support_tickets t left join agon_support_staff s on s.staff_id = t.assigned_staff_id
         ${where} order by case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
         t.last_message_at desc limit 200`, params,
    );
    return c.json({ tickets: rows });
  });

  app.get("/support/staff/tickets/:ticketId", requireReadyStaff, async (c) => {
    const { rows } = await query<Record<string, unknown>>(
      `select t.*, t.ticket_id::text, t.assigned_staff_id::text, s.display_name as assigned_name
         from agon_support_tickets t left join agon_support_staff s on s.staff_id = t.assigned_staff_id
        where t.ticket_id = $1 limit 1`, [c.req.param("ticketId")],
    );
    if (!rows[0]) return c.json({ error: "ticket not found" }, 404);
    const messages = await query<Record<string, unknown>>(
      `select message_id::text, author_type, author_name, body, visibility, created_at
         from agon_support_messages where ticket_id = $1 order by created_at asc`, [c.req.param("ticketId")],
    );
    return c.json({ ticket: rows[0], messages: messages.rows.map(serializeMessage) });
  });

  app.post("/support/staff/tickets/:ticketId/assign", requireReadyStaff, async (c) => {
    const staff = c.get("supportStaff");
    const assigned = await query(
      `update agon_support_tickets set assigned_staff_id = $2, status = case when status in ('ai_triage','open') then 'in_progress' else status end,
       ai_enabled = false, updated_at = now() where ticket_id = $1 and (assigned_staff_id is null or assigned_staff_id = $2)
       returning ticket_id`, [c.req.param("ticketId"), staff.staffId],
    );
    if (!assigned.rowCount) {
      const exists = await query("select 1 from agon_support_tickets where ticket_id = $1", [c.req.param("ticketId")]);
      return exists.rowCount ? c.json({ error: "ticket is already assigned to another teammate" }, 409) : c.json({ error: "ticket not found" }, 404);
    }
    await query(`insert into agon_support_ticket_events (event_id, ticket_id, staff_id, event_type, detail) values ($1,$2,$3,'assigned',$4::jsonb)`, [randomUUID(), c.req.param("ticketId"), staff.staffId, JSON.stringify({ assignedTo: staff.staffId })]);
    return c.json({ ok: true });
  });

  app.post("/support/staff/tickets/:ticketId/status", requireReadyStaff, async (c) => {
    const body = await c.req.json().catch(() => null) as { status?: unknown; priority?: unknown } | null;
    const parsed = z.object({ status: z.enum(TICKET_STATUSES), priority: z.enum(PRIORITIES).optional() }).safeParse(body);
    if (!parsed.success) return c.json({ error: "valid status is required" }, 400);
    const staff = c.get("supportStaff");
    const { rowCount } = await query(
      `update agon_support_tickets set status = $2, priority = coalesce($3, priority), ai_enabled = false,
       resolved_at = case when $2 in ('resolved','closed') then now() else null end, updated_at = now() where ticket_id = $1`,
      [c.req.param("ticketId"), parsed.data.status, parsed.data.priority ?? null],
    );
    if (!rowCount) return c.json({ error: "ticket not found" }, 404);
    await query(`insert into agon_support_ticket_events (event_id, ticket_id, staff_id, event_type, detail) values ($1,$2,$3,'status_changed',$4::jsonb)`, [randomUUID(), c.req.param("ticketId"), staff.staffId, JSON.stringify(parsed.data)]);
    return c.json({ ok: true });
  });

  app.post("/support/staff/tickets/:ticketId/messages", requireReadyStaff, async (c) => {
    const parsed = z.object({ message: z.string().trim().min(1).max(4_000), internal: z.boolean().default(false) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "message is required" }, 400);
    const staff = c.get("supportStaff");
    await query(
      `insert into agon_support_messages (message_id, ticket_id, author_type, author_staff_id, author_name, body, visibility)
       values ($1,$2,'staff',$3,$4,$5,$6)`,
      [randomUUID(), c.req.param("ticketId"), staff.staffId, staff.displayName, parsed.data.message, parsed.data.internal ? "internal" : "public"],
    );
    await query(`update agon_support_tickets set assigned_staff_id = coalesce(assigned_staff_id, $2), status = case when $3 then status else 'waiting_user' end, ai_enabled = false, updated_at = now(), last_message_at = now() where ticket_id = $1`, [c.req.param("ticketId"), staff.staffId, parsed.data.internal]);
    return c.json({ ok: true });
  });

  app.get("/admin/support/staff", async (c) => {
    if (!secretMatches(c.req.header("x-admin-token"), config.adminToken)) return c.json({ error: "unauthorized" }, 401);
    const { rows } = await query(`select staff_id::text, email, display_name, role, status, must_change_password, last_login_at, created_at, updated_at from agon_support_staff order by display_name asc`);
    return c.json({ staff: rows });
  });
  app.post("/admin/support/staff", async (c) => {
    if (!secretMatches(c.req.header("x-admin-token"), config.adminToken)) return c.json({ error: "unauthorized" }, 401);
    const parsed = staffCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid staff account" }, 400);
    const passwordError = validateSupportPassword(parsed.data.password);
    if (passwordError) return c.json({ error: passwordError }, 400);
    const passwordHash = await hashSupportPassword(parsed.data.password);
    const staffId = randomUUID();
    try {
      await query(`insert into agon_support_staff (staff_id,email,display_name,password_hash,role,status,must_change_password,created_by) values ($1,$2,$3,$4,$5,'active',true,'owner-token')`, [staffId, normalizeSupportEmail(parsed.data.email), parsed.data.displayName, passwordHash, parsed.data.role]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return c.json({ error: "a staff account already uses this email" }, 409);
      throw error;
    }
    return c.json({ staffId, email: normalizeSupportEmail(parsed.data.email), displayName: parsed.data.displayName, role: parsed.data.role }, 201);
  });
  app.post("/admin/support/staff/:staffId/disable", async (c) => {
    if (!secretMatches(c.req.header("x-admin-token"), config.adminToken)) return c.json({ error: "unauthorized" }, 401);
    const result = await query(`update agon_support_staff set status = 'disabled', updated_at = now() where staff_id = $1`, [c.req.param("staffId")]);
    if (!result.rowCount) return c.json({ error: "staff account not found" }, 404);
    await query(`update agon_support_sessions set revoked_at = now() where staff_id = $1 and revoked_at is null`, [c.req.param("staffId")]);
    return c.json({ ok: true });
  });
  app.post("/admin/support/staff/:staffId/reset-password", async (c) => {
    if (!secretMatches(c.req.header("x-admin-token"), config.adminToken)) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null) as { password?: unknown } | null;
    const password = typeof body?.password === "string" ? body.password : "";
    const passwordError = validateSupportPassword(password);
    if (passwordError) return c.json({ error: passwordError }, 400);
    const passwordHash = await hashSupportPassword(password);
    const result = await query(`update agon_support_staff set password_hash = $2, must_change_password = true, failed_login_attempts = 0, locked_until = null, updated_at = now() where staff_id = $1`, [c.req.param("staffId"), passwordHash]);
    if (!result.rowCount) return c.json({ error: "staff account not found" }, 404);
    await query(`update agon_support_sessions set revoked_at = now() where staff_id = $1 and revoked_at is null`, [c.req.param("staffId")]);
    return c.json({ ok: true });
  });

  return app;
}
