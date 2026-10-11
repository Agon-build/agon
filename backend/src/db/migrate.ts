import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

// Migration is a database-only operation. Do not import the full application
// config here: Redis, RPC, and signing credentials are unrelated to applying
// an idempotent SQL schema and may not exist in a migration job.
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

const AGON_TABLES = [
  "agon_profiles",
  "agon_listings",
  "agon_listing_versions",
  "agon_listing_events",
  "agon_chain_events",
  "agon_write_operations",
  "agon_mcp_provider_drafts",
  "agon_hosted_manifests",
  "agon_verification_evidence",
  "agon_playground_runs",
  "agon_certification_jobs",
  "agon_x402_call_intents",
  "agon_mcp_hire_previews",
  "agon_seasons",
  "agon_season_entries",
  "agon_season_rounds",
  "agon_season_round_markets",
  "agon_season_forecasts",
  "agon_season_market_results",
  "agon_budget_wallets",
  "agon_wallet_spends",
  "agon_pay_confirmations",
  "agon_wallet_approvals",
  "agon_x402_seller_nonces",
  "agon_x402_quotes",
  "agon_jobs",
  "agon_job_payments",
  "agon_x402_call_receipts",
  "agon_x402_facilitator_verifications",
  "agon_x402_execution_approvals",
  "agon_x402_delivery_evidence",
  "agon_x402_agent_wallet_policies",
  "agon_x402_agent_spends",
  "agon_escrow_intents",
  "agon_escrow_transaction_approvals",
  "agon_job_escrow_intents",
  "agon_arena_evaluations",
  "agon_syndicate_contributions",
  "agon_prize_claim_intents",
  "agon_support_staff",
  "agon_support_sessions",
  "agon_support_tickets",
  "agon_support_messages",
  "agon_support_ticket_events",
  "agon_support_rate_limits",
  "agon_support_ai_usage",
  "agon_indexer_state",
] as const;

/// Applies schema.sql. The schema is written with `if not exists`, so this is
/// safe to run repeatedly.
async function migrate() {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  const marker = "-- Agon Market foundation";
  const markerIndex = sql.indexOf(marker);
  const legacySql = markerIndex >= 0 ? sql.slice(0, markerIndex) : sql;
  const agonSql = markerIndex >= 0 ? sql.slice(markerIndex) : "";

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local search_path = public");
    await client.query(legacySql);
    await client.query("create schema if not exists agon");

    // Preserve an older public Agon installation by moving its tables once.
    // If both schemas already contain a table, refuse to guess which copy is
    // authoritative rather than silently splitting the data set.
    for (const table of AGON_TABLES) {
      const existing = await client.query<{ public_exists: boolean; agon_exists: boolean }>(
        `select to_regclass($1) is not null as public_exists,
                to_regclass($2) is not null as agon_exists`,
        [`public.${table}`, `agon.${table}`],
      );
      const row = existing.rows[0];
      if (row?.public_exists && row.agon_exists) {
        throw new Error(`Agon migration found duplicate public and agon tables: ${table}`);
      }
      if (row?.public_exists) {
        await client.query(`alter table public."${table}" set schema agon`);
      }
    }

    await client.query("set local search_path = agon, public");
    if (agonSql.trim()) await client.query(agonSql);
    await client.query("commit");
    console.log("migrations applied (legacy public + dedicated agon schema)");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
