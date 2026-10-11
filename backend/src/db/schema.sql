-- ArcRun denormalized read model. Big integers (uint256) are stored as numeric
-- to keep full precision; the indexer writes them as decimal strings.

create table if not exists indexer_state (
  id          int primary key default 1,
  last_block  bigint not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists operators (
  address              text primary key,
  x_handle             text,
  telegram_id          text,
  telegram_username    text,
  discord_id           text,
  discord_username     text,
  current_syndicate_id bigint,
  reputation           numeric not null default 0,
  cycles               numeric not null default 0,
  created_at           timestamptz not null default now()
);
-- Add cycles to operators tables created before this column existed.
alter table operators add column if not exists cycles numeric not null default 0;
-- Telegram and Discord social linking columns, idempotent for live deployments.
alter table operators add column if not exists telegram_id text;
alter table operators add column if not exists telegram_username text;
alter table operators add column if not exists discord_id text;
alter table operators add column if not exists discord_username text;
-- X profile image, captured at link time. Used when an agent's display mode
-- is "x" so it can show the operator's X avatar alongside the handle.
alter table operators add column if not exists x_avatar text;
-- Telegram / Discord profile images, captured at link time (Telegram from the
-- login widget's photo_url, Discord from the OAuth avatar hash). Neither can be
-- resolved from a username after the fact, so we store the URL when linking.
alter table operators add column if not exists telegram_avatar text;
alter table operators add column if not exists discord_avatar text;
-- Operator-level identity shown on the leaderboard row and public profile.
-- 'auto' resolves X first, then Discord, then the masked wallet. The operator
-- can pin it from their profile: 'x', 'discord', 'custom' (first agent skin +
-- name), or 'wallet' to force the masked address. Distinct from per-agent
-- display_mode, which only governs how an agent appears inside a live event.
alter table operators add column if not exists identity_mode text not null default 'auto';
-- Email and Circle Dev-Controlled wallet linkage. An operator row exists for
-- both SIWE-only users (email/circle null) and email-login users (email set,
-- circle_wallet_id set). When circle_wallet_id is non-null the backend signs
-- writes on the operator's behalf through Circle. Email is unique so the same
-- mailbox cannot register two wallets.
alter table operators add column if not exists email text;
alter table operators add column if not exists circle_wallet_id text;
create unique index if not exists operators_email_idx on operators(email) where email is not null;
create unique index if not exists operators_circle_wallet_idx on operators(circle_wallet_id) where circle_wallet_id is not null;

-- Additional wallet principals linked to an operator. This is deliberately
-- separate from operators.circle_wallet_id, which remains the legacy
-- Developer-Controlled Circle wallet used by email/passkey accounts. Tokens,
-- encryption keys, refresh tokens, and keyshares are never persisted here.
create table if not exists agon_wallet_principals (
  id                  bigserial primary key,
  operator_address    text not null references operators(address) on delete cascade,
  principal_type      text not null,
  address             text not null,
  provider_user_id    text,
  provider_wallet_id  text,
  blockchain          text,
  status              text not null default 'active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint agon_wallet_principals_type_ck
    check (principal_type in ('circle_user_controlled')),
  constraint agon_wallet_principals_status_ck
    check (status in ('active', 'unlinked', 'pending')),
  constraint agon_wallet_principals_address_ck
    check (address = lower(address)),
  constraint agon_wallet_principals_address_unique
    unique (principal_type, address)
);
create unique index if not exists agon_wallet_principals_provider_wallet_idx
  on agon_wallet_principals(provider_wallet_id)
  where provider_wallet_id is not null;
create index if not exists agon_wallet_principals_operator_idx
  on agon_wallet_principals(operator_address, status);

-- Short-lived OAuth-style device sessions for the Agon CLI. Only hashes of
-- the device and user codes are persisted. Approval binds the CLI token to
-- the already-authenticated operator address; it never transfers wallet key
-- custody or authorizes a blockchain transaction by itself.
create table if not exists agon_cli_device_sessions (
  device_code_hash text primary key,
  user_code_hash text not null unique,
  client_name text not null,
  scopes text[] not null default array['agon:read']::text[],
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_by text,
  approved_at timestamptz,
  consumed_at timestamptz,
  constraint agon_cli_device_sessions_status_ck
    check (status in ('pending', 'approved', 'consumed', 'expired'))
);
alter table agon_cli_device_sessions add column if not exists scopes text[] not null default array['agon:read']::text[];
create index if not exists agon_cli_device_sessions_expiry_idx
  on agon_cli_device_sessions(expires_at);

-- Per-user Circle dev-controlled wallets on SOURCE chains, used for cross-chain
-- TOP UP: the user funds `address` on `chain` (an App Kit chain name like
-- "Base_Sepolia"), then the backend bridges it to their Arc wallet. One row per
-- (operator, chain); provisioned on demand and reused, so a user only ever has
-- one deposit wallet per chain. The operator's main Arc wallet stays in
-- operators.circle_wallet_id and is not duplicated here.
create table if not exists circle_chain_wallets (
  operator   text not null,
  chain      text not null,
  wallet_id  text not null,
  address    text not null,
  created_at timestamptz not null default now(),
  primary key (operator, chain)
);

-- Per-call audit trail for LLM runner calls. Lets the demo prove that an
-- agent's answer came from a real model call and not a synthetic ticker:
-- show the puzzle text, the agent's response, the verdict, and the tokens
-- consumed. (contest_id, agent_id, round_idx, puzzle_idx) uniquely keys a
-- single solve attempt; primary key is the autoincrement id to make
-- inserts simple.
create table if not exists llm_runs (
  id            bigserial primary key,
  contest_id    bigint not null,
  agent_id      bigint not null,
  operator      text   not null,
  round_idx     int    not null default 0,
  puzzle_idx    int    not null default 0,
  kind          text   not null, -- "solver" | "analyst" | "scout"
  model         text   not null,
  prompt        text   not null,
  response      text   not null,
  expected      text,
  -- The agent's final answer, extracted from `response` by the judge. This
  -- is what the live "REAL SOLVES" cell displays so the audience sees just
  -- the answer ("C", "9375", "transfer") instead of the full reasoning.
  -- Hover/tooltip still surfaces the full response text.
  answer        text,
  verdict       text   not null, -- "correct" | "wrong" | "skipped" | "error"
  latency_ms    int    not null default 0,
  input_tokens  int    not null default 0,
  output_tokens int    not null default 0,
  cost_usd      numeric(12, 6) not null default 0,
  created_at    timestamptz not null default now()
);
-- Backfill for existing deployments where llm_runs was created without the
-- answer column. Safe to run repeatedly.
alter table llm_runs add column if not exists answer text;
create index if not exists llm_runs_contest_idx on llm_runs(contest_id, agent_id);
create index if not exists llm_runs_created_idx on llm_runs(created_at desc);
-- One audit row per (contest, agent, kind, round, puzzle). Without this the
-- runner duplicates rows every preview pass during the live window, and the
-- LLM gets called per pass too, so the demo paid for the same solve 40
-- times. Insert path uses ON CONFLICT DO NOTHING to make re-runs idempotent.
-- Dedupe any historical bloat first so the unique index can build.
delete from llm_runs
where id in (
  select id from (
    select id, row_number() over (
      partition by contest_id, agent_id, kind, round_idx, puzzle_idx
      order by created_at, id
    ) as rn
    from llm_runs
  ) ranked
  where rn > 1
);
create unique index if not exists llm_runs_unique_idx
  on llm_runs(contest_id, agent_id, kind, round_idx, puzzle_idx);

-- WebAuthn passkey credentials. One row per registered authenticator. An email
-- can have multiple credentials over time (extra devices), but the demo only
-- ever uses one per email. `credential_id` is base64url-encoded as it comes
-- from the authenticator; `public_key` is the raw CBOR-encoded public key
-- bytes the SimpleWebAuthn library returns. `operator_address` is the email
-- user's resolved wallet address (foreign-key-ish to operators.address).
create table if not exists webauthn_credentials (
  credential_id    text primary key,
  operator_address text not null,
  public_key       bytea not null,
  counter          bigint not null default 0,
  transports       text[],
  device_type      text,
  backed_up        boolean,
  created_at       timestamptz not null default now()
);
create index if not exists webauthn_credentials_op_idx on webauthn_credentials(operator_address);

create table if not exists agents (
  id               bigint primary key,
  owner            text not null,
  erc8004_token_id numeric,
  scout_tier       int not null default 0,
  analyst_tier     int not null default 0,
  solver_tier      int not null default 0,
  reputation       numeric not null default 0,
  nickname         text,
  created_at       timestamptz not null default now()
);
create index if not exists agents_owner_idx on agents(owner);
-- Backfill columns for installs that pre-date them; no-op when already present.
alter table agents add column if not exists nickname text;
-- Last time the nickname changed, for the once-every-30-days rename cooldown.
alter table agents add column if not exists nickname_updated_at timestamptz;
-- Custom skin: base64 data URL (image/png|jpeg|webp|gif), capped 256KB on the
-- server. Null means "use the mascot variant fallback".
alter table agents add column if not exists skin text;
-- Display identity for the agent: which name+avatar to show.
--   'default' -> robot mascot + default name (#id)
--   'x'       -> owner's X handle + X avatar (falls back to default if unlinked)
--   'custom'  -> uploaded skin + nickname (falls back to default if none)
-- Defaults to 'x' so a fresh agent reads as the operator's X identity when
-- one is linked, and as the robot otherwise.
alter table agents add column if not exists display_mode text not null default 'x';

-- Phase 2 scoring mode: pnl_mtm (default), pnl_realized, or volume.
-- Set by the creator at contest/challenge open time; the runner reads it
-- at settlement to dispatch the right payout curve. NULL = default
-- (pnl_mtm). Stored off-chain because contracts don't see it.
-- See docs/brandkit/13-prediction-windows-design.md.
create table if not exists contests (
  id              bigint primary key,
  sponsor         text,
  contest_type    int,
  protocol_target text,
  metric          text,
  prize_pool      numeric,
  status          text not null default 'open',
  final_root      text,
  paid_out        numeric,
  platform_fee    numeric,
  created_block   bigint,
  created_at      timestamptz not null default now()
);

create table if not exists entries (
  contest_id     bigint not null,
  agent_id       bigint not null,
  operator       text not null,
  syndicate_id   bigint,
  claimed        boolean not null default false,
  claimed_amount numeric,
  created_at     timestamptz not null default now(),
  primary key (contest_id, agent_id)
);
create index if not exists entries_operator_idx on entries(operator);

-- Idempotent column add so existing DBs pick up scoring_mode without a
-- manual migration. Default null = treat as pnl_mtm at scoring time.
alter table contests add column if not exists scoring_mode text;
-- Creator-set prize distribution. payout_preset is a key from PAYOUT_PRESETS
-- (winner_take_all | top2 | top3 | top5_half_field | even_all) or 'custom';
-- payout_config holds the custom { winnersBps:[], restSharedBps } when custom.
-- Null = legacy scoring-mode curve, so old contests settle unchanged.
alter table contests add column if not exists payout_preset text;
alter table contests add column if not exists payout_config jsonb;

-- Tier snapshot at entry time. The indexer reads getTier(agentId, cType)
-- once when EntryRegistered fires and stores it here, so the runner's
-- fetchField (called every 2.5s during the live window) reads from the
-- row instead of round-tripping N agents × M ticks to the chain. Null
-- on legacy rows; the runner falls back to a live read and backfills.
alter table entries add column if not exists tier int;
-- challenge_entries.tier is added right after that table is created below;
-- altering it here would fail on a fresh DB where the table doesn't exist yet.

-- Treasury / payout flow from PrizeEscrow.PaidOut. Every USDC outflow
-- from a pool gets a row here: contest prize claims, challenge payouts,
-- listing fees to treasury, platform-fee skims. The (controller,
-- pool_id, recipient) keys let us reconcile this against contests /
-- challenges / treasury without re-parsing the raw events_log.
create table if not exists treasury_flow (
  id           bigserial primary key,
  controller   text not null,
  pool_id      numeric not null,
  recipient    text not null,
  amount       numeric not null,
  tx_hash      text not null,
  block_number bigint not null,
  log_index    int not null,
  created_at   timestamptz not null default now(),
  unique (tx_hash, log_index)
);
create index if not exists treasury_flow_recipient_idx on treasury_flow(recipient);
create index if not exists treasury_flow_pool_idx on treasury_flow(controller, pool_id);

-- Per-event log of syndicate ContributionRecorded events so we can roll
-- contributions up into rolling weekly windows. Existing
-- syndicates.total_reputation is cumulative all-time; this table is the
-- raw stream the war settler reads from. Keyed on (tx_hash, log_index)
-- so re-indexing a block range is idempotent.
create table if not exists syndicate_contributions (
  id           bigserial primary key,
  syndicate_id bigint not null,
  member       text not null,
  amount       numeric not null,
  tx_hash      text not null,
  block_number bigint not null,
  log_index    int not null,
  recorded_at  timestamptz not null default now(),
  unique (tx_hash, log_index)
);
create index if not exists syndicate_contrib_syn_idx on syndicate_contributions(syndicate_id, recorded_at);
create index if not exists syndicate_contrib_member_idx on syndicate_contributions(member, recorded_at);

-- Idempotency guard for syndicate contribution recording. recordContribution is
-- ADDITIVE on-chain, so an event's reputation must roll into its syndicate at
-- most once, ever. The settlement path and the backfill both claim the event
-- here first (insert on conflict do nothing); a claim that finds the row already
-- present skips, so re-running a backfill or replaying an event never
-- double-counts. Keyed by (source, event_id): a contest 88 and a challenge 88
-- are distinct.
create table if not exists syndicate_contrib_events (
  source      text not null,        -- 'contest' | 'challenge'
  event_id    bigint not null,
  recorded_at timestamptz not null default now(),
  primary key (source, event_id)
);

-- Weekly war standings snapshot. The coordinator's settle job writes one
-- row per syndicate per ISO-week with the syndicate's rank and total
-- contribution that week. The scoring path reads the latest week's row
-- to apply the top-3 multiplier on the current week's contests.
-- `week_id` is the ISO-8601 year-week string ("2026-W22") so it's
-- human-readable and naturally sorts.
create table if not exists syndicate_war_results (
  week_id        text not null,
  syndicate_id   bigint not null,
  rank           int not null,
  total          numeric not null,
  member_count   int not null,
  settled_at     timestamptz not null default now(),
  primary key (week_id, syndicate_id)
);
create index if not exists war_results_week_idx on syndicate_war_results(week_id, rank);

-- Weekly syndicate reward pool. One row per ISO-week with the total USDC set
-- aside (6-dec), computed once at week close. The row's existence is the guard
-- that the week was already split, so the computation is idempotent.
create table if not exists syndicate_pool_weeks (
  week_id     text primary key,
  pool_usdc6  numeric not null,
  computed_at timestamptz not null default now()
);

-- Per-member share of a week's pool, split by contribution. claimed flips when
-- the member pulls it; claim_tx records the on-chain transfer. Unclaimed shares
-- simply accumulate across weeks until claimed.
create table if not exists syndicate_pool_shares (
  week_id      text not null,
  operator     text not null,
  syndicate_id bigint not null,
  share_usdc6  numeric not null,
  claimed      boolean not null default false,
  claim_tx     text,
  claimed_at   timestamptz,
  primary key (week_id, operator)
);
create index if not exists syndicate_pool_shares_op_idx on syndicate_pool_shares(operator, claimed);

-- Email OTP proof-of-ownership. Required before a never-seen email can
-- register a passkey for the first time (so an attacker can't claim
-- someone else's email and mint a Circle wallet under it). Returning
-- passkey users don't hit this path. Codes hash via sha256+pepper at
-- rest so a DB dump doesn't leak active codes. `verified_at` non-null
-- means /auth/email/begin can proceed within OTP_VERIFY_TTL.
create table if not exists email_otp (
  email        text primary key,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists challenges (
  id          bigint primary key,
  creator     text,
  kind        int,
  stake       numeric,
  status      text not null default 'open',
  winner_root text,
  pot         numeric,
  entrants    int not null default 0,
  created_at  timestamptz not null default now()
);

alter table challenges add column if not exists scoring_mode text;
-- Creator-set prize distribution, same shape as contests above.
alter table challenges add column if not exists payout_preset text;
alter table challenges add column if not exists payout_config jsonb;

create table if not exists syndicates (
  id               bigint primary key,
  name             text,
  founder          text,
  is_custom        boolean not null default false,
  total_reputation numeric not null default 0,
  member_count     bigint not null default 0
);

-- Raw event stream for debugging and replay. Unique on (tx, log index) so the
-- indexer is idempotent across restarts and overlapping ranges.
create table if not exists events_log (
  id           bigserial primary key,
  block_number bigint not null,
  tx_hash      text not null,
  log_index    int not null,
  address      text not null,
  event_name   text not null,
  args         jsonb not null,
  created_at   timestamptz not null default now(),
  unique (tx_hash, log_index)
);
create index if not exists events_log_block_idx on events_log(block_number);

-- Activity and error log. Clients and services append here (POST /events);
-- only the admin token can read it (GET /admin/events). Append-only audit stream.
create table if not exists events (
  id          bigserial primary key,
  level       text not null default 'info',  -- info | warn | error
  kind        text not null,                 -- login, contest_enter, client_error, ...
  message     text,
  context     jsonb,
  address     text,
  source      text not null default 'server', -- web | auth | coordinator | indexer
  created_at  timestamptz not null default now()
);

-- Older ArcRun databases used a compact events projection with `at`,
-- `actor`, and `detail`. Add the current append-only event columns
-- idempotently so the public legacy schema can be upgraded without blocking
-- the dedicated Agon schema migration.
alter table events add column if not exists level text not null default 'info';
alter table events add column if not exists message text;
alter table events add column if not exists context jsonb;
alter table events add column if not exists address text;
alter table events add column if not exists source text not null default 'server';
alter table events add column if not exists created_at timestamptz not null default now();
create index if not exists events_created_idx on events(created_at desc);
create index if not exists events_level_idx on events(level);

-- Settlement payouts the coordinator wrote, in the exact leaf order used to build
-- the merkle root. Serves claim proofs (GET /contests/:id/payout). Keyed by rank
-- so the rebuilt tree matches what was posted, even if an operator appears twice.
create table if not exists payouts (
  contest_id  bigint not null,
  rank        int not null,
  operator    text not null,
  amount      numeric not null,
  created_at  timestamptz not null default now(),
  primary key (contest_id, rank)
);
create index if not exists payouts_lookup_idx on payouts(contest_id, operator);

-- Final standings snapshot for replay. When an event settles, the coordinator
-- saves the last standings frame (the same {rank, agentId, operator, score,
-- progress}[] it broadcasts live) here, so visiting/refreshing a settled event
-- reconstructs the FULL result — volumes, ops, tx hashes, solver cells, research
-- spend — for someone who never watched it live. source is 'contest'|'challenge'.
create table if not exists event_standings (
  source      text not null,
  event_id    bigint not null,
  entries     jsonb not null,
  settled_at  timestamptz not null default now(),
  primary key (source, event_id)
);

-- Peer-challenge entrants, from ChallengeArena's ChallengeJoined. Mirrors
-- `entries` so the coordinator can assemble and score a challenge's field.
create table if not exists challenge_entries (
  challenge_id bigint not null,
  agent_id     bigint not null,
  operator     text not null,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, agent_id)
);
create index if not exists challenge_entries_operator_idx on challenge_entries(operator);
-- Tier snapshot at entry time (see the entries.tier note above). Added here,
-- after the create, so a fresh DB has the table before the column is added.
alter table challenge_entries add column if not exists tier int;

-- Resolved challenge payouts, in leaf order, for serving claim proofs.
create table if not exists challenge_payouts (
  challenge_id bigint not null,
  rank         int not null,
  operator     text not null,
  amount       numeric not null,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, rank)
);
create index if not exists challenge_payouts_lookup_idx on challenge_payouts(challenge_id, operator);

-- Per-agent traits earned over time. Source records where the trait came from:
-- 'mystery' for daily mystery claims, 'contest' for top-N placements, 'challenge'
-- for challenge wins. The (agent_id, trait_id) pair is unique so each agent owns
-- each trait at most once.
create table if not exists agent_traits (
  agent_id     bigint not null,
  trait_id     text not null,
  source       text not null,
  source_ref   text,
  awarded_at   timestamptz not null default now(),
  primary key (agent_id, trait_id)
);
create index if not exists agent_traits_agent_idx on agent_traits(agent_id);

-- Per-operator mystery-claim cooldown. One row per operator, updated on every
-- claim. The "one per UTC day" rule is enforced by the auth service.
create table if not exists mystery_claims (
  operator     text primary key,
  last_claim   timestamptz not null,
  total_claims bigint not null default 0
);

-- Global daily pool counter. One row per UTC day. Each successful claim
-- increments `claimed`; the auth service refuses to award once `claimed`
-- reaches the configured `MYSTERY_DAILY_POOL`. Resets implicitly at midnight
-- UTC because a new day key creates a fresh row.
create table if not exists mystery_pool_daily (
  day      date primary key,
  claimed  bigint not null default 0
);
-- `claimed` counts ROLLS (100/day). `won` counts traits actually awarded, which
-- is the scarce cap (3/day, 7 on a bonus day). Most rolls rug.
alter table mystery_pool_daily add column if not exists won bigint not null default 0;

-- Pool of LLM-generated, source-grounded, grader-verified puzzles. A background
-- job tops this up; contests draw from it (skipping recently-used) and fall back
-- to the deterministic templates when it's thin. `content_hash` dedupes so a
-- question never enters twice. `source` carries the doc provenance for display.
create table if not exists generated_puzzles (
  id           bigserial primary key,
  content_hash text not null unique,
  kind         text not null,
  prompt       text not null,
  expected     text not null,
  presentation jsonb not null,
  difficulty   int not null default 2,
  source       text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  use_count    bigint not null default 0
);
create index if not exists generated_puzzles_pick
  on generated_puzzles (difficulty, last_used_at nulls first, id);

-- Consecutive contest wins per operator. Winning (placing #1) a contest bumps
-- the streak; any other finish resets it. 5 in a row unlocks a rare trait, 10
-- in a row a legendary (then the streak resets). The skill-based path to traits,
-- alongside the daily mystery box.
create table if not exists win_streaks (
  operator   text primary key,
  streak     int not null default 0,
  updated_at timestamptz not null default now()
);

-- Weekly Cycle drop to the top syndicates (funds training). One row per settled
-- ISO week guards against re-dropping when the hourly settler re-runs.
create table if not exists syndicate_cycle_drops (
  week_id    text primary key,
  dropped_at timestamptz not null default now()
);

-- Per-agent skill training. Six stats (POWER, PRECISION, SPEED, ENDURANCE,
-- LUCK, FOCUS) each 0..20. Each level adds 1% to the relevant scoring
-- component in the coordinator pipeline. Funded by Cycles, time-gated.
create table if not exists agent_stats (
  agent_id bigint not null,
  stat     text not null,
  level    int not null default 0,
  primary key (agent_id, stat)
);
create index if not exists agent_stats_agent_idx on agent_stats(agent_id);

-- Active training slot. One row per agent at a time. When `completes_at` is
-- in the past, the next read promotes the row: bumps agent_stats.level and
-- writes a row to training_log, then deletes from this table.
create table if not exists training_queue (
  agent_id     bigint primary key,
  stat         text not null,
  from_level   int not null,
  to_level     int not null,
  cycles_spent bigint not null,
  started_at   timestamptz not null default now(),
  completes_at timestamptz not null
);

-- Private challenge invite list. The contract emits ChallengeInvited per
-- (id, invitee); the indexer mirrors it here so the frontend can render
-- "who's been invited" without scanning logs.
create table if not exists challenge_invites (
  challenge_id bigint not null,
  invitee      text   not null,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, invitee)
);
create index if not exists challenge_invites_id_idx on challenge_invites(challenge_id);

-- Equipped trait loadouts per entry. ArcRun caps a loadout at three traits
-- and rejects clashing combinations. Used by the runner to fold the trait
-- multiplier (and any routing trait) into final score. Source distinguishes
-- contest entries from peer-challenge entries since the two have separate id
-- spaces.
create table if not exists entry_loadouts (
  source       text   not null, -- 'contest' or 'challenge'
  event_id     bigint not null,
  agent_id     bigint not null,
  operator     text   not null,
  trait_ids    text[] not null default '{}',
  created_at   timestamptz not null default now(),
  primary key (source, event_id, agent_id)
);
create index if not exists entry_loadouts_op_idx on entry_loadouts(operator);

-- Append-only log of every completed training step. Used for history on the
-- workshop card and for the future training_log feed on the dashboard.
create table if not exists training_log (
  id           bigserial primary key,
  agent_id     bigint not null,
  stat         text not null,
  from_level   int not null,
  to_level     int not null,
  cycles_spent bigint not null,
  completed_at timestamptz not null default now()
);
create index if not exists training_log_agent_idx on training_log(agent_id, completed_at desc);

-- Admin-only soft burn. An agent id listed here is filtered out of every
-- public agent listing (fetchAgents) so the operator profile, workshop,
-- dashboard, and contest entry pickers all treat it as removed. The on-chain
-- ERC-8004 NFT stays where it is; this only hides it from the ArcRun UI.
-- Users never see this table or any indication that delisting happened.
create table if not exists delisted_agents (
  agent_id     bigint primary key,
  delisted_at  timestamptz not null default now(),
  reason       text
);

-- ===========================================================================
-- Arcana Markets integration (read + index)
-- ===========================================================================
-- Cached state of every Arcana market the indexer has seen. Updated on
-- SharesBought (pool deltas), MarketResolved (outcome), and a periodic
-- reconciliation sweep that re-reads markets(i) for the latest N to catch
-- new markets created by the Arcana team. `outcome` is null until the market
-- resolves: true = YES won, false = NO won.
create table if not exists arcana_markets (
  market_id     bigint primary key,
  title         text not null default '',
  category      text not null default '',
  end_time      timestamptz not null,
  yes_pool      numeric(38, 0) not null default 0,
  no_pool       numeric(38, 0) not null default 0,
  resolved      boolean not null default false,
  cancelled     boolean not null default false,
  outcome       boolean,
  resolved_at   timestamptz,
  first_seen    timestamptz not null default now(),
  last_updated  timestamptz not null default now()
);
create index if not exists arcana_markets_open_idx
  on arcana_markets(end_time)
  where resolved = false and cancelled = false;
create index if not exists arcana_markets_resolved_idx
  on arcana_markets(resolved_at desc)
  where resolved = true;

-- Every USDC trade an agent places against the Arcana contract. One row per
-- buyShares call. Linked to the contest round that prompted it so we can
-- compute per-agent PnL inside a round window. `pnl_usdc` is filled when the
-- market resolves (positive = won, negative = lost stake to the other pool).
create table if not exists agent_positions (
  id              bigserial primary key,
  contest_id      bigint not null,
  agent_id        bigint not null,
  operator        text not null,
  market_id       bigint not null,
  side            text not null check (side in ('yes', 'no')),
  stake_usdc      numeric(38, 0) not null,
  shares          numeric(38, 0),
  entry_yes_pool  numeric(38, 0) not null default 0,
  entry_no_pool   numeric(38, 0) not null default 0,
  tx_hash         text,
  block_number    bigint,
  claimed         boolean not null default false,
  claim_tx_hash   text,
  pnl_usdc        numeric(38, 0),
  created_at      timestamptz not null default now()
);
create index if not exists agent_positions_contest_idx
  on agent_positions(contest_id, agent_id);
create index if not exists agent_positions_market_idx
  on agent_positions(market_id);
create index if not exists agent_positions_unclaimed_idx
  on agent_positions(market_id, claimed)
  where claimed = false;

-- Replayable raw event log for the Arcana contract. Kept separate from
-- events_log (ArcRun-native contracts) so a partner-contract change can be
-- re-played without touching the rest of the system.
create table if not exists arcana_events (
  id            bigserial primary key,
  block_number  bigint not null,
  tx_hash       text not null,
  log_index     int not null,
  event_kind    text not null,  -- 'SharesBought' | 'MarketResolved' | 'WinningsClaimed'
  market_id     bigint not null,
  args          jsonb not null,
  created_at    timestamptz not null default now(),
  unique (tx_hash, log_index)
);
create index if not exists arcana_events_market_idx
  on arcana_events(market_id, block_number);
create index if not exists arcana_events_kind_idx
  on arcana_events(event_kind, block_number desc);

-- The indexer tracks Arcana progress separately so the existing indexer_state
-- row keeps describing the ArcRun-contracts indexer. Single row, id=1.
create table if not exists arcana_indexer_state (
  id            int primary key,
  last_block    bigint not null,
  updated_at    timestamptz not null default now()
);

-- Phase 1 tick-driven prediction model. One row per agent decision tick
-- during a contest/challenge trade window. `tick_idx` is the agent's
-- per-event tick counter (0-based); the unique index gives at-most-once
-- semantics so a scheduler crash + restart doesn't double-fire a tick.
-- `action` is the LLM's decision: OPEN_YES / OPEN_NO opens a position,
-- HEDGE_YES / HEDGE_NO buys the opposite side of an existing position
-- to cut exposure, HOLD records that the agent saw the tick and chose
-- not to act (still counts toward the budget). market_id + stake_usdc
-- are null for HOLD ticks.
create table if not exists agent_decisions (
  id            bigserial primary key,
  source        text not null,                       -- 'contest' | 'challenge'
  event_id      bigint not null,                     -- contest id or challenge id
  agent_id      bigint not null,
  operator      text not null,
  tick_idx      int not null,
  action        text not null,                       -- OPEN_YES | OPEN_NO | HEDGE_YES | HEDGE_NO | HOLD
  market_id     bigint,
  stake_usdc    numeric(38, 0),
  tx_hash       text,
  rationale     text,
  decided_at    timestamptz not null default now(),
  unique (source, event_id, agent_id, tick_idx)
);
create index if not exists agent_decisions_event_idx
  on agent_decisions(source, event_id);
create index if not exists agent_decisions_agent_idx
  on agent_decisions(agent_id, decided_at desc);

-- Per-contest pinned market set. When the coordinator opens an Analyst
-- contest, it selects N open Arcana markets up-front and persists them
-- here. The runner reads from this table so every agent in the round sees
-- the same menu and the round is deterministic. The pool snapshots let
-- the live page show entry-time odds even after the pools drift.
create table if not exists contest_arcana_markets (
  contest_id        bigint not null,
  market_id         bigint not null,
  title             text not null default '',
  category          text not null default '',
  end_time          timestamptz not null,
  entry_yes_pool    numeric(38, 0) not null default 0,
  entry_no_pool     numeric(38, 0) not null default 0,
  pinned_at         timestamptz not null default now(),
  primary key (contest_id, market_id)
);
create index if not exists contest_arcana_markets_lookup_idx on contest_arcana_markets(contest_id);

-- Coordinator-side autofund tracking. One row per drip sent. The unique
-- index on (agent_id, drip_day) gives us the one-drip-per-agent-per-day
-- guarantee at the DB layer; the global daily cap is enforced in the caller
-- by summing amount_usd for the current drip_day. drip_day is the UTC date
-- the drip belongs to, so the day boundary matches everywhere.
create table if not exists analyst_autofund_log (
  id            bigserial primary key,
  agent_id      bigint not null,
  operator      text not null,
  drip_day      date not null,
  amount_usd    numeric(10, 2) not null,
  tx_hash       text not null,
  created_at    timestamptz not null default now(),
  unique (agent_id, drip_day)
);
create index if not exists analyst_autofund_day_idx on analyst_autofund_log(drip_day desc);

-- Nanopayments: every paid x402 call made by an agent during a contest.
-- One row per call, regardless of HTTP status. status='settled' means the
-- usdc moved and the response payload arrived. 'rejected' means the call
-- was budget-blocked before any USDC moved. 'failed' means the call paid
-- but the upstream API returned an error after settlement.
create table if not exists nanopayments (
  id                bigserial primary key,
  agent_id          bigint not null,
  contest_id        bigint,
  challenge_id      bigint,
  puzzle_idx        int not null default 0,
  tier              int not null,
  endpoint          text not null,
  endpoint_label    text,
  -- USDC 6-decimal as a string so we don't lose precision through json.
  usdc_amount_6     text not null default '0',
  chain             text not null default 'ARC',
  tx_hash           text,
  status            text not null default 'pending',
  response_summary  text,
  error_message     text,
  budget_remaining_6 text,
  created_at        timestamptz not null default now()
);
create index if not exists nanopayments_agent_idx on nanopayments(agent_id);
create index if not exists nanopayments_contest_idx on nanopayments(contest_id, puzzle_idx);
create index if not exists nanopayments_challenge_idx on nanopayments(challenge_id, puzzle_idx);
create index if not exists nanopayments_recent_idx on nanopayments(created_at desc);

-- Tier-pool Gateway state. One row per tier (0..4). Tracks the wallet
-- address, Gateway-deposited USDC balance snapshot, and the cumulative
-- spend across contests. Coordinator refreshes balance_usdc_6 on each
-- top-up and after each settlement sweep.
create table if not exists tier_pool_state (
  tier                int primary key,
  wallet_address      text not null,
  wallet_id           text,
  balance_usdc_6      text not null default '0',
  lifetime_spend_6    text not null default '0',
  per_puzzle_cap_6    text not null default '0',
  last_updated_at     timestamptz not null default now()
);

-- Custom contest/challenge requests. A project that wants a campaign shaped
-- to its own metric submits one here; ArcRun reviews it and coordinates the
-- wiring offline. status moves pending -> reviewing -> accepted | declined.
create table if not exists custom_requests (
  id          bigserial primary key,
  operator    text,
  surface     text not null,            -- 'contest' | 'challenge'
  kind        text,                     -- requested type/kind label
  contact     text not null,            -- how ArcRun reaches the project
  spec        text not null,            -- the metric and rules described
  status      text not null default 'pending',
  created_at  timestamptz not null default now()
);
create index if not exists custom_requests_status_idx on custom_requests(status, created_at desc);
create index if not exists custom_requests_operator_idx on custom_requests(operator);

-- In-app notifications. One row per operator-targeted event (new contest,
-- private invite, win, balance change, training done, mystery win, custom
-- request update). The auth API serves a per-operator feed; the coordinator
-- and auth service insert rows and push them over the WebSocket. `kind`
-- drives the icon and sound on the client; `body` is the rendered line.
create table if not exists notifications (
  id          bigserial primary key,
  operator    text not null,
  kind        text not null,
  title       text not null,
  body        text,
  href        text,
  context     jsonb,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_operator_idx on notifications(operator, created_at desc);
create index if not exists notifications_unread_idx on notifications(operator, read);

-- AGON operational incidents are canonical records shared by the in-app feed
-- and Telegram delivery. Identical open failures deduplicate by fingerprint;
-- critical incidents remain open until an authenticated administrator records
-- acknowledgement. Delivery state is deliberately separate from product state.
create table if not exists agon_operations_alerts (
  alert_id         uuid primary key,
  operator         text not null check (operator ~ '^0x[0-9a-f]{40}$'),
  fingerprint      text not null check (char_length(fingerprint) between 1 and 256),
  source           text not null check (source in ('certification','arena')),
  severity         text not null check (severity in ('info','warning','critical')),
  status           text not null default 'open' check (status in ('open','acknowledged','resolved')),
  title            text not null check (char_length(title) between 1 and 180),
  body             text,
  href             text,
  context          jsonb not null default '{}',
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  notification_id  bigint references notifications(id) on delete set null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  acknowledged_at  timestamptz,
  acknowledged_by  text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists agon_operations_alerts_open_fingerprint_idx
  on agon_operations_alerts(operator, fingerprint) where status = 'open';
create index if not exists agon_operations_alerts_inbox_idx
  on agon_operations_alerts(status, severity, last_seen_at desc);

create table if not exists agon_alert_subscriptions (
  subscription_id    uuid primary key,
  operator_address   text not null references operators(address) on delete cascade,
  scope_type         text not null check (scope_type in ('platform','service')),
  scope_reference    text,
  source             text not null default 'any' check (source in ('any','certification','arena')),
  minimum_severity   text not null default 'warning' check (minimum_severity in ('info','warning','critical')),
  in_app             boolean not null default true,
  telegram           boolean not null default false,
  enabled            boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((scope_type = 'platform' and scope_reference is null) or (scope_type = 'service' and scope_reference is not null)),
  check (in_app or telegram)
);
create unique index if not exists agon_alert_subscriptions_scope_idx
  on agon_alert_subscriptions(operator_address, scope_type, coalesce(scope_reference, ''), source);
create index if not exists agon_alert_subscriptions_match_idx
  on agon_alert_subscriptions(enabled, source, scope_type, scope_reference);

create table if not exists agon_alert_recipients (
  alert_id            uuid not null references agon_operations_alerts(alert_id) on delete cascade,
  recipient_operator  text not null references operators(address) on delete cascade,
  notification_id     bigint references notifications(id) on delete set null,
  in_app               boolean not null default true,
  telegram             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (alert_id, recipient_operator)
);
create unique index if not exists agon_alert_recipients_notification_idx
  on agon_alert_recipients(notification_id) where notification_id is not null;

create table if not exists agon_alert_delivery_outbox (
  delivery_id         uuid primary key,
  alert_id            uuid not null references agon_operations_alerts(alert_id) on delete cascade,
  recipient_operator  text not null references operators(address) on delete cascade,
  channel             text not null check (channel = 'telegram'),
  status              text not null default 'pending' check (status in ('pending','processing','retry','delivered','dead')),
  attempts            integer not null default 0 check (attempts >= 0),
  max_attempts        integer not null default 8 check (max_attempts between 1 and 20),
  next_attempt_at     timestamptz not null default now(),
  lease_expires_at    timestamptz,
  provider_message_id text,
  delivered_severity  text check (delivered_severity is null or delivered_severity in ('info','warning','critical')),
  last_error          text,
  delivered_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table agon_alert_delivery_outbox add column if not exists recipient_operator text;
update agon_alert_delivery_outbox d
   set recipient_operator = a.operator
  from agon_operations_alerts a
 where d.alert_id = a.alert_id and d.recipient_operator is null;
alter table agon_alert_delivery_outbox alter column recipient_operator set not null;
alter table agon_alert_delivery_outbox drop constraint if exists agon_alert_delivery_outbox_alert_id_channel_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'agon_alert_delivery_outbox_recipient_operator_fk'
       and conrelid = 'agon_alert_delivery_outbox'::regclass
  ) then
    alter table agon_alert_delivery_outbox
      add constraint agon_alert_delivery_outbox_recipient_operator_fk
      foreign key (recipient_operator) references operators(address) on delete cascade;
  end if;
end;
$$;
create unique index if not exists agon_alert_delivery_outbox_recipient_idx
  on agon_alert_delivery_outbox(alert_id, channel, recipient_operator);
create index if not exists agon_alert_delivery_outbox_due_idx
  on agon_alert_delivery_outbox(status, next_attempt_at) where status in ('pending','processing','retry');
alter table agon_alert_delivery_outbox add column if not exists delivered_severity text;
alter table agon_alert_delivery_outbox drop constraint if exists agon_alert_delivery_outbox_delivered_severity_check;
alter table agon_alert_delivery_outbox add constraint agon_alert_delivery_outbox_delivered_severity_check
  check (delivered_severity is null or delivered_severity in ('info','warning','critical'));

-- Tier gates on contests and challenges. The contracts don't store a tier
-- restriction, so the gate lives here: the host records it at creation, the
-- entry UI blocks out-of-range agents, and the coordinator excludes any
-- out-of-range entry at settlement so an on-chain bypass can't win. Absent
-- row means open to all tiers (0..4).
create table if not exists event_tier_gates (
  surface     text not null,            -- 'contest' | 'challenge'
  event_id    bigint not null,
  min_tier    int not null default 0,
  max_tier    int not null default 4,
  created_at  timestamptz not null default now(),
  primary key (surface, event_id)
);

-- Per-agent daily swap budget for the Scout real-swap path. Every tier gets
-- the same daily cap, so a lower-tier agent (smaller funding) has to swap
-- more times to match the volume of a higher-tier agent. Keyed by UTC day.
create table if not exists scout_swap_budget (
  agent_id    bigint not null,
  day         date not null,
  used        int not null default 0,
  primary key (agent_id, day)
);

-- Admin ops queue. The admin console (auth API process) enqueues a command;
-- the coordinator process drains it and executes through its own single-flight
-- guard, so manual settle/resolve/cancel run in the SAME place as the autopilot
-- sweeper (one nonce owner, real WS broadcast) instead of racing it from the API
-- process. Status flows pending -> running -> done | error.
create table if not exists admin_commands (
  id           bigserial primary key,
  kind         text not null,            -- 'settle_contest' | 'resolve_challenge' | 'cancel_contest' | 'cancel_challenge'
  target_id    bigint not null,
  status       text not null default 'pending',  -- 'pending' | 'running' | 'done' | 'error'
  result       text,
  requested_by text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists admin_commands_pending_idx on admin_commands (status, id) where status = 'pending';
-- Optional per-command params (open_mission carries {domain, poolUsdc, windowSeconds}).
alter table admin_commands add column if not exists params jsonb;

-- Missions: the agent labor market (full design in docs/missions.md). A mission
-- is a SOLVER-type contest tagged here. `domain` (solver | analyst | scout)
-- decides the operative's work: solver/analyst MAKE fragments by paying x402
-- services; scout MAKEs by doing on-chain DeFi work. One row per mission, keyed
-- by the on-chain contest id (no contract redeploy).
create table if not exists missions (
  contest_id    bigint primary key,
  domain        text not null,            -- 'solver' | 'analyst' | 'scout'
  template_id   text not null,
  title         text not null,
  brief         text not null,
  deliverable   text not null,
  status        text not null default 'open',  -- 'open' | 'settled' | 'cancelled'
  created_at    timestamptz not null default now()
);
-- v2 economy (docs/missions.md s1c): archetype decides external-x402 vs the
-- internal intel market; weight (0..1) and base_price set the intel price band;
-- pool_usdc_6 is the prize pool (stored here so the operative join fee, a % of
-- it, is computable without an on-chain read).
alter table missions add column if not exists archetype         text    not null default 'internal';
alter table missions add column if not exists weight            numeric not null default 0;
alter table missions add column if not exists base_price_usdc_6 text    not null default '0';
alter table missions add column if not exists pool_usdc_6       text    not null default '0';
-- A display sequence so missions read as "MISSION 001" rather than the on-chain
-- contest id (one counter across all contests). The URL still uses contest_id.
create sequence if not exists mission_display_seq;
alter table missions add column if not exists seq bigint not null default nextval('mission_display_seq');
-- Per-mission seat caps. NULL falls back to the global MISSION_*_SEATS config,
-- so an admin can open a bigger or smaller field for one mission without
-- changing the env for every mission.
alter table missions add column if not exists operative_seats  int;
alter table missions add column if not exists specialist_seats int;
-- Per-mission operative join fee (basis points). NULL = the global
-- MISSION_OPERATIVE_FEE_BPS. Lets an admin tune the fee for one mission.
alter table missions add column if not exists operative_fee_bps int;
create index if not exists missions_status_idx on missions(status, created_at desc);

-- The fragments a mission's brief asks for, with the captured ground truth. The
-- service columns name the x402 endpoint that can MAKE the fragment (null for
-- scout `action` fragments). `truth` is what the grader checks against and what
-- the platform specialists are seeded to hold.
create table if not exists mission_fragments (
  contest_id      bigint not null,
  fragment_id     text not null,
  kind            text not null,          -- 'intel' | 'signal' | 'market' | 'action'
  ask             text not null,
  service_endpoint text,
  service_label   text,
  service_chain   text,
  truth           jsonb,
  created_at      timestamptz not null default now(),
  primary key (contest_id, fragment_id)
);

-- Platform-seeded specialist (intel-seller) agents. Each holds the captured intel
-- for a fragment and prices it; serves it over the A2A handshake on a paid BUY.
-- agent_id is on the reserved specialist range (MISSION_SPECIALIST_AGENT_ID_BASE)
-- and the address is its derived hot wallet.
create table if not exists mission_specialists (
  contest_id   bigint not null,
  agent_id     bigint not null,
  address      text not null,
  fragment_id  text not null,
  price_usdc_6 text not null default '0',
  intel        jsonb,
  created_at   timestamptz not null default now(),
  primary key (contest_id, agent_id, fragment_id)
);
-- Recent mission subjects (v2 diversity). One row per subject a mission used, so
-- the generator can avoid anything seen in the last 60 days and missions never
-- feel repeated. subject_key is the lowercased subject.
create table if not exists mission_subjects (
  subject_key text not null,
  contest_id  bigint not null,
  created_at  timestamptz not null default now(),
  primary key (subject_key, contest_id)
);
create index if not exists mission_subjects_recent_idx on mission_subjects(created_at desc);

-- Operative join fees (v2 economy). An operative pays a % of the pool to the
-- treasury when it enters a mission; recorded here so the fee can be refunded
-- from the treasury if the mission cancels with no qualifier. One row per
-- operator per mission (re-paying is idempotent on the key).
create table if not exists mission_operative_fees (
  contest_id   bigint not null,
  operator     text not null,
  amount_usdc_6 text not null,
  tx_hash      text,
  refunded     boolean not null default false,
  refund_tx    text,
  created_at   timestamptz not null default now(),
  primary key (contest_id, operator)
);
-- Why a fee was returned: 'cancel' (mission voided), 'withdraw' (operative left
-- the join window), or 'participation' (the operative put >= the configured
-- fraction of its float to work on real spend, so it earned the fee back at a
-- settled mission). NULL on rows never refunded. Additive for existing DBs.
alter table mission_operative_fees add column if not exists refund_reason text;

-- Operator-run specialists: an operator can enter a mission on the SUPPLY side,
-- registering one of their agents to sell intel for a fragment at their own
-- price. `owner` distinguishes them from the platform-seeded sellers; `operator`
-- is the wallet the A2A payment lands in when an operative buys. `claimed_by` is
-- set on a PLATFORM row once a specialist buys that piece, making it exclusive:
-- the platform no longer sells it (only the specialist resells). Added after the
-- create so existing DBs gain the columns.
alter table mission_specialists add column if not exists owner      text not null default 'platform';
alter table mission_specialists add column if not exists operator   text;
alter table mission_specialists add column if not exists claimed_by text;

-- The scarce-intel market ledger (v2). One row per piece a specialist buys from
-- the platform shelf at the base price `b`, then resells at `resale_price_6`. The
-- (contest_id, fragment_id) primary key enforces exclusivity: a piece has at most
-- one buyer. Refunded from the treasury if the mission cancels.
create table if not exists mission_intel_buys (
  contest_id     bigint not null,
  fragment_id    text not null,
  operator       text not null,
  agent_id       bigint not null,
  base_price_6   text not null,
  resale_price_6 text not null,
  tx_hash        text,
  refunded       boolean not null default false,
  refund_tx      text,
  created_at     timestamptz not null default now(),
  primary key (contest_id, fragment_id)
);
create index if not exists mission_intel_buys_op_idx on mission_intel_buys(contest_id, operator);
create index if not exists mission_specialists_contest_idx on mission_specialists(contest_id);

-- An operative who entered a mission and changed their mind WITHIN the join
-- window (mission still open) can withdraw. We cannot undo their on-chain
-- registerEntry, so the withdrawal is recorded here and every read of the
-- operative field — grading (fetchField), the concurrency guard, the my-role
-- lock, and the operative seat count — excludes a withdrawn operator. The join
-- fee (if any was paid) is returned from the treasury; fee_refund_tx records it.
-- Keyed by (contest_id, operator); one withdrawal per operative per mission.
create table if not exists mission_withdrawals (
  contest_id    bigint not null,
  operator      text not null,
  agent_id      bigint,
  fee_refunded  boolean not null default false,
  fee_refund_tx text,
  created_at    timestamptz not null default now(),
  primary key (contest_id, operator)
);
create index if not exists mission_withdrawals_contest_idx on mission_withdrawals(contest_id);

-- Agent-to-agent trades: the on-chain USDC payment from an operative (buyer) to a
-- specialist (seller) for a fragment over the bounded handshake. This is the A2A
-- rail's settlement record; tx_hash is the real USDC Transfer.
create table if not exists a2a_trades (
  id            bigserial primary key,
  contest_id    bigint not null,
  buyer_agent_id  bigint not null,
  seller_agent_id bigint not null,
  fragment_id   text not null,
  price_usdc_6  text not null default '0',
  tx_hash       text,
  status        text not null default 'pending',  -- 'pending' | 'settled' | 'failed' | 'declined'
  created_at    timestamptz not null default now()
);
-- The NEGOTIATE pillar. A trade now records what the seller ASKED as well as what
-- was PAID, plus the handshake that got them there, so a bargain is provable after
-- the fact instead of being a claim. quoted_usdc_6 = price_usdc_6 when the ask was
-- firm (an operator listing) or nothing was conceded.
-- Added as ALTER ... IF NOT EXISTS rather than in the create above, so an existing
-- deployment migrates in place. schema.sql runs as ONE query, so a statement that
-- throws kills the whole migrate job: keep every statement here idempotent.
alter table a2a_trades add column if not exists quoted_usdc_6 text;
alter table a2a_trades add column if not exists rounds integer not null default 0;
alter table a2a_trades add column if not exists transcript jsonb;
create index if not exists a2a_trades_contest_idx on a2a_trades(contest_id);
create index if not exists a2a_trades_buyer_idx on a2a_trades(buyer_agent_id);
create index if not exists a2a_trades_recent_idx on a2a_trades(created_at desc);

-- Per-operative make/buy/skip decision log, one row per fragment the operative
-- considered. `tx_hash` is the on-chain proof the grader's credit gate checks:
-- an x402 tx (make), an a2a_trades tx (buy), or a DeFi action tx (scout).
create table if not exists mission_decisions (
  contest_id          bigint not null,
  agent_id            bigint not null,
  fragment_id         text not null,
  choice              text not null,      -- 'make' | 'buy' | 'skip'
  reason              text,
  settled             boolean not null default false,
  tx_hash             text,
  spent_usdc_6        text not null default '0',
  specialist_agent_id bigint,
  created_at          timestamptz not null default now(),
  primary key (contest_id, agent_id, fragment_id)
);
create index if not exists mission_decisions_contest_idx on mission_decisions(contest_id, agent_id);

-- SCOUT-domain missions execute an on-chain DeFi ACTION fragment (real swaps on
-- the Scout rails) instead of a make/buy. This is the proof row the grader's
-- credit gate re-verifies for an `action` decision, exactly as it verifies
-- a2a_trades for a buy and nanopayments for a make: an action counts only when a
-- settled row here carries the same tx_hash. volume_usdc_6 is what the scout
-- quality score is normalized against.
create table if not exists mission_actions (
  contest_id     bigint not null,
  agent_id       bigint not null,
  fragment_id    text not null,
  tx_hash        text,
  volume_usdc_6  text not null default '0',
  ops            int not null default 0,
  status         text not null default 'pending',  -- 'pending' | 'settled' | 'failed'
  created_at     timestamptz not null default now(),
  primary key (contest_id, agent_id, fragment_id)
);
create index if not exists mission_actions_contest_idx on mission_actions(contest_id, agent_id);

-- The operative's submitted deliverable and its grade. score is the deterministic
-- value fed into the merkle payout; `judged` holds the judge.ts verdict detail.
create table if not exists mission_submissions (
  contest_id   bigint not null,
  agent_id     bigint not null,
  operator     text not null,
  deliverable  text,
  elapsed_ms   int not null default 0,
  score        numeric,
  judged       jsonb,
  created_at   timestamptz not null default now(),
  primary key (contest_id, agent_id)
);

-- Autonomous agents: an agent that OWNS ITSELF. Its Circle Developer-Controlled
-- Wallet holds the ERC-8004 identity NFT, so on chain the agent is its own
-- operator and can register its own contest entries. This is the only shape that
-- works: ContestEngine.registerEntry requires msg.sender == ownerOfAgent(agentId)
-- and allows one entry per owner per contest, so an agent entered by a human
-- shares that human's single seat. A self-owned agent has its own.
create table if not exists autonomous_agents (
  id            bigserial primary key,
  agent_id      bigint unique,               -- null until createAgent() lands
  wallet_id     text not null unique,        -- Circle DCW wallet id
  address       text not null unique,        -- the wallet, and the agent's owner
  label         text not null,
  budget_usdc_6 numeric not null default 0,  -- hard ceiling it may ever spend
  spent_usdc_6  numeric not null default 0,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Every autonomous decision, with the model's own stated reason. The point is to
-- be able to show WHY an agent acted, not merely that it did.
--
-- NOT called agent_decisions: that name is already taken by the Analyst runner's
-- prediction-market tick log (see above). Reusing it made `create table if not
-- exists` a silent no-op, and the index below then failed on a column the older
-- table does not have, which broke the migrate job on deploy.
create table if not exists autonomy_decisions (
  id          bigserial primary key,
  agent_id    bigint,
  address     text not null,
  kind        text not null,                 -- enter | skip | upgrade | error
  contest_id  bigint,
  reason      text not null default '',
  cost_usdc_6 numeric not null default 0,
  tx_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists autonomy_decisions_agent_idx on autonomy_decisions (agent_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Agon Market foundation
--
-- These tables are isolated from the legacy ArcRun read model. Chain-derived
-- identifiers use numeric so uint256 values never cross a JavaScript float.
-- Addresses and hashes are stored as canonical lowercase hex. Raw chain events,
-- validated listing versions, and listing audits are append-only provenance.
-- ---------------------------------------------------------------------------

create table if not exists agon_profiles (
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  profile_registry_address    text not null check (profile_registry_address ~ '^0x[0-9a-f]{40}$'),
  identity_registry_address   text not null check (identity_registry_address ~ '^0x[0-9a-f]{40}$'),
  agent_id                    numeric(78, 0) not null check (agent_id > 0),
  owner_snapshot              text not null check (owner_snapshot ~ '^0x[0-9a-f]{40}$'),
  metadata_uri                text not null check (char_length(metadata_uri) between 1 and 2048),
  status                      text not null check (status in ('Active', 'Suspended', 'Archived')),
  suspension_reason           text check (suspension_reason is null or suspension_reason ~ '^0x[0-9a-f]{64}$'),
  source_block_number         numeric(78, 0) not null check (source_block_number >= 0),
  source_tx_hash              text not null check (source_tx_hash ~ '^0x[0-9a-f]{64}$'),
  source_log_index            integer not null check (source_log_index >= 0),
  created_at                  timestamptz not null,
  updated_at                  timestamptz not null,
  primary key (chain_id, profile_registry_address, agent_id)
);
create index if not exists agon_profiles_owner_idx
  on agon_profiles(chain_id, identity_registry_address, owner_snapshot);
create index if not exists agon_profiles_status_idx
  on agon_profiles(chain_id, status, updated_at desc);

create table if not exists agon_listings (
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  service_registry_address    text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                  numeric(78, 0) not null check (listing_id > 0),
  agent_id                    numeric(78, 0) not null check (agent_id > 0),
  service_key                 text not null check (service_key ~ '^0x[0-9a-f]{64}$'),
  category                    numeric(78, 0) not null check (category > 0),
  current_version             numeric(78, 0) not null check (current_version > 0),
  manifest_hash               text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  manifest_uri                text not null check (char_length(manifest_uri) > 0),
  payment_rail                text not null check (payment_rail in ('X402', 'Escrow')),
  provider_snapshot           text not null check (provider_snapshot ~ '^0x[0-9a-f]{40}$'),
  chain_status                text not null check (chain_status in ('Listed', 'Suspended', 'Delisted')),
  status                      text not null check (status in ('Listed', 'Suspended', 'Delisted')),
  verification                text not null check (
    verification in ('Unverified', 'Pending', 'Verified', 'Expired', 'Suspended', 'Revoked')
  ),
  quarantine_reason           text,
  source_block_number         numeric(78, 0) not null check (source_block_number >= 0),
  source_tx_hash              text not null check (source_tx_hash ~ '^0x[0-9a-f]{64}$'),
  source_log_index            integer not null check (source_log_index >= 0),
  created_at                  timestamptz not null,
  updated_at                  timestamptz not null,
  primary key (chain_id, service_registry_address, listing_id)
);
create unique index if not exists agon_listings_service_key_unique
  on agon_listings(chain_id, service_registry_address, agent_id, service_key);
create index if not exists agon_listings_discovery_idx
  on agon_listings(chain_id, status, verification, category, updated_at desc);
create index if not exists agon_listings_agent_idx
  on agon_listings(chain_id, agent_id, updated_at desc);

-- A row is the exact manifest/provider/version tuple that passed local
-- validation before activation. The projector compares chain anchors to this
-- table. Rows cannot be edited after insertion; a new manifest is a new version.
create table if not exists agon_listing_versions (
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  service_registry_address    text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                  numeric(78, 0) not null check (listing_id > 0),
  version                     numeric(78, 0) not null check (version > 0),
  manifest_hash               text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  manifest_uri                text not null check (char_length(manifest_uri) > 0),
  payment_rail                text not null check (payment_rail in ('X402', 'Escrow')),
  provider_snapshot           text not null check (provider_snapshot ~ '^0x[0-9a-f]{40}$'),
  validated_at                timestamptz not null,
  primary key (chain_id, service_registry_address, listing_id, version)
);
create index if not exists agon_listing_versions_hash_idx
  on agon_listing_versions(chain_id, manifest_hash);

create table if not exists agon_listing_events (
  id                          bigserial primary key,
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  service_registry_address    text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                  numeric(78, 0) not null check (listing_id > 0),
  version                     numeric(78, 0) check (version is null or version > 0),
  event_type                  text not null check (
    event_type in ('published', 'version_published', 'status_changed', 'verification_changed', 'quarantined')
  ),
  payload                     jsonb not null,
  tx_hash                     text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index                   integer not null check (log_index >= 0),
  block_number                numeric(78, 0) not null check (block_number >= 0),
  block_hash                  text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  observed_at                 timestamptz not null,
  unique (chain_id, tx_hash, log_index, event_type)
);
create index if not exists agon_listing_events_listing_idx
  on agon_listing_events(chain_id, service_registry_address, listing_id, id);
create index if not exists agon_listing_events_block_idx
  on agon_listing_events(chain_id, block_number, log_index);

create table if not exists agon_chain_events (
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  contract_address            text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash                     text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index                   integer not null check (log_index >= 0),
  block_number                numeric(78, 0) not null check (block_number >= 0),
  block_hash                  text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  event_name                  text not null,
  args                        jsonb not null,
  observed_at                 timestamptz not null,
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists agon_chain_events_contract_block_idx
  on agon_chain_events(chain_id, contract_address, block_number, log_index);

-- Wallet-neutral Agon writes are prepared before the user's own wallet signs
-- them, then confirmed only after the backend matches a successful canonical
-- contract event. This ledger makes both phases durable and idempotent.
create table if not exists agon_write_operations (
  operation_id        uuid primary key,
  actor_address       text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  operation_kind      text not null check (operation_kind in ('bind_profile', 'publish_listing', 'pause_listing')),
  payload_hash        text not null check (payload_hash ~ '^0x[0-9a-f]{64}$'),
  request_payload     jsonb not null,
  transaction_intent jsonb not null,
  state               text not null default 'prepared' check (state in ('prepared', 'confirmed')),
  tx_hash             text unique check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  result_reference    text,
  block_number        numeric(78, 0) check (block_number is null or block_number >= 0),
  log_index           integer check (log_index is null or log_index >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (actor_address, operation_kind, payload_hash),
  check (
    (state = 'prepared' and tx_hash is null and block_number is null and log_index is null)
    or
    (state = 'confirmed' and tx_hash is not null and block_number is not null and log_index is not null)
  )
);
create index if not exists agon_write_operations_actor_idx
  on agon_write_operations(actor_address, created_at desc);
alter table agon_write_operations drop constraint if exists agon_write_operations_operation_kind_check;
alter table agon_write_operations add constraint agon_write_operations_operation_kind_check
  check (operation_kind in ('bind_profile', 'publish_listing', 'pause_listing'));

-- MCP provider drafts are durable before a wallet review. The compiled
-- manifest is retained so publication always uses the exact reviewed bytes.
create table if not exists agon_mcp_provider_drafts (
  draft_id           text not null,
  actor_address      text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  draft              jsonb not null,
  compiled_manifest  jsonb,
  manifest_uri       text,
  state              text not null default 'draft' check (state in ('draft', 'compiled', 'prepared', 'confirmed', 'paused')),
  publication_kind   text not null default 'new' check (publication_kind in ('new', 'version')),
  listing_id         text,
  operation_id       text,
  reference          text,
  tx_hash            text check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  block_number       numeric(78, 0) check (block_number is null or block_number >= 0),
  log_index          integer check (log_index is null or log_index >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (draft_id, actor_address)
);
create index if not exists agon_mcp_provider_drafts_actor_idx
  on agon_mcp_provider_drafts(actor_address, updated_at desc);

-- The authenticated account owns this Circle-custodied publisher workflow.
-- Circle's idempotency keys derive from public_id and survive process restarts.
create table if not exists agon_mcp_managed_publishers (
  actor_address text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  draft_id text not null,
  public_id uuid not null unique,
  version bigint not null default 0 check (version >= 0),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_address, draft_id),
  foreign key (draft_id, actor_address) references agon_mcp_provider_drafts(draft_id, actor_address)
);
-- Each public service file is stored under its agent, version, and content hash.
-- A later edit creates a new URL; the bytes at an existing URL never change.
create table if not exists agon_hosted_manifests (
  chain_id       numeric(78, 0) not null check (chain_id > 0),
  agent_id       numeric(78, 0) not null check (agent_id >= 0),
  service_key    text not null check (service_key ~ '^0x[0-9a-f]{64}$'),
  version        numeric(78, 0) not null check (version > 0),
  manifest_hash  text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  actor_address  text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  canonical_json text not null,
  byte_length    integer not null check (byte_length between 1 and 65536),
  created_at     timestamptz not null default now(),
  primary key (chain_id, agent_id, service_key, version, manifest_hash)
);
create index if not exists agon_hosted_manifests_actor_idx
  on agon_hosted_manifests(actor_address, created_at desc);
alter table agon_mcp_provider_drafts add column if not exists publication_kind text not null default 'new';
alter table agon_mcp_provider_drafts add column if not exists listing_id text;
alter table agon_mcp_provider_drafts add column if not exists tx_hash text;
alter table agon_mcp_provider_drafts add column if not exists block_number numeric(78, 0);
alter table agon_mcp_provider_drafts add column if not exists log_index integer;
alter table agon_mcp_provider_drafts drop constraint if exists agon_mcp_provider_drafts_tx_hash_check;
alter table agon_mcp_provider_drafts add constraint agon_mcp_provider_drafts_tx_hash_check
  check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$');

create table if not exists agon_verification_evidence (
  id              bigserial primary key,
  listing_id      numeric(78, 0) not null check (listing_id > 0),
  agent_id        numeric(78, 0) not null check (agent_id >= 0),
  passed          boolean not null,
  evidence_hash   text not null check (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  evidence        jsonb not null,
  verifier       text not null default 'agon-verifier-agent',
  created_at      timestamptz not null default now()
);
create index if not exists agon_verification_evidence_listing_idx
  on agon_verification_evidence(listing_id, created_at desc);

-- A playground run is durable evidence preparation, not a verification claim
-- by itself. The row is created before the agent executes so a timeout or
-- process crash remains visible. The result is immutable after completion and
-- idempotency is scoped to the authenticated actor.
create table if not exists agon_playground_runs (
  run_id          uuid primary key,
  actor_address   text check (actor_address is null or actor_address ~ '^0x[0-9a-f]{40}$'),
  request_id      uuid not null,
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 128),
  category        text not null check (category in ('development', 'research', 'analysis', 'verification', 'execution')),
  task_id         text not null check (task_id ~ '^[a-z0-9-]{1,64}$'),
  input_hash      text not null check (input_hash ~ '^0x[0-9a-f]{64}$'),
  input           jsonb not null,
  scope           jsonb,
  state           text not null default 'running' check (state in ('running', 'completed', 'failed')),
  result          jsonb,
  error_code      text,
  created_at      timestamptz not null default now(),
  lease_expires_at timestamptz not null default (now() + interval '60 seconds'),
  completed_at    timestamptz,
  unique (actor_address, idempotency_key),
  check ((state = 'running' and result is null and completed_at is null)
      or (state = 'completed' and result is not null and completed_at is not null)
      or (state = 'failed' and error_code is not null and completed_at is not null))
);
create index if not exists agon_playground_runs_actor_idx
  on agon_playground_runs(actor_address, created_at desc);
create index if not exists agon_playground_runs_state_idx
  on agon_playground_runs(state, created_at desc);

-- One hidden, idempotent certification job is scheduled for each immutable
-- listed service version. A worker may call the allowlisted provider and save
-- the resulting Playground evidence, but this table never authorizes Arena
-- writes, badge claims, or payments.
create table if not exists agon_certification_jobs (
  job_id                    uuid primary key,
  chain_id                  numeric(78, 0) not null check (chain_id > 0),
  service_registry_address  text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                numeric(78, 0) not null check (listing_id > 0),
  agent_id                  numeric(78, 0) not null check (agent_id > 0),
  listing_version           numeric(78, 0) not null check (listing_version > 0),
  service_key               text not null check (service_key ~ '^0x[0-9a-f]{64}$'),
  category                  text not null check (char_length(category) > 0),
  task_id                   text check (task_id is null or task_id ~ '^[a-z0-9-]{1,64}$'),
  listing_reference         text not null check (listing_reference ~ '^[1-9][0-9]*:0x[0-9a-f]{40}:[1-9][0-9]*$'),
  manifest_hash             text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  manifest_uri              text not null check (char_length(manifest_uri) between 1 and 2048),
  payment_rail              text not null check (payment_rail in ('X402', 'Escrow')),
  provider_snapshot         text not null check (provider_snapshot ~ '^0x[0-9a-f]{40}$'),
  state                     text not null default 'scheduled' check (state in ('scheduled', 'running', 'completed', 'failed', 'blocked')),
  attempts                  integer not null default 0 check (attempts >= 0),
  max_attempts              integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at           timestamptz not null default now(),
  lease_expires_at          timestamptz,
  blocked_reason            text,
  last_error_code           text,
  playground_run_id         uuid unique references agon_playground_runs(run_id),
  passed                    boolean,
  score                     integer check (score is null or score between 0 and 100),
  evidence_root             text check (evidence_root is null or evidence_root ~ '^0x[0-9a-f]{64}$'),
  response_hash             text check (response_hash is null or response_hash ~ '^0x[0-9a-f]{64}$'),
  task_commitment           text check (task_commitment is null or task_commitment ~ '^0x[0-9a-f]{64}$'),
  validation_request_hash   text check (validation_request_hash is null or validation_request_hash ~ '^0x[0-9a-f]{64}$'),
  evaluator_version_hash    text check (evaluator_version_hash is null or evaluator_version_hash ~ '^0x[0-9a-f]{64}$'),
  provider_host             text,
  created_at                timestamptz not null default now(),
  started_at                timestamptz,
  completed_at              timestamptz,
  updated_at                timestamptz not null default now(),
  unique (chain_id, service_registry_address, listing_id, listing_version)
);
create index if not exists agon_certification_jobs_due_idx
  on agon_certification_jobs(state, next_attempt_at, created_at);
create index if not exists agon_certification_jobs_listing_idx
  on agon_certification_jobs(chain_id, service_registry_address, listing_id, listing_version);

-- Continuous certification state is attached to the immutable listing-version
-- job. Every actual check is also appended below, so the summary can be rebuilt
-- and a provider cannot erase a default by retrying.
alter table agon_certification_jobs add column if not exists lifecycle_status text not null default 'pending';
alter table agon_certification_jobs drop constraint if exists agon_certification_jobs_lifecycle_status_check;
alter table agon_certification_jobs add constraint agon_certification_jobs_lifecycle_status_check
  check (lifecycle_status in ('pending','healthy','warning','suspended'));
alter table agon_certification_jobs add column if not exists consecutive_failures integer not null default 0;
alter table agon_certification_jobs add column if not exists check_sequence integer not null default 0;
alter table agon_certification_jobs add column if not exists last_checked_at timestamptz;
alter table agon_certification_jobs add column if not exists last_passed_at timestamptz;
alter table agon_certification_jobs add column if not exists last_failed_at timestamptz;
alter table agon_certification_jobs add column if not exists verification_action text;
alter table agon_certification_jobs add column if not exists verification_action_state text not null default 'idle';
alter table agon_certification_jobs add column if not exists verification_transaction_hash text;
alter table agon_certification_jobs add column if not exists verification_error text;
alter table agon_certification_jobs drop constraint if exists agon_certification_jobs_verification_action_check;
alter table agon_certification_jobs add constraint agon_certification_jobs_verification_action_check
  check (verification_action is null or verification_action in ('approve','suspend'));
alter table agon_certification_jobs drop constraint if exists agon_certification_jobs_verification_action_state_check;
alter table agon_certification_jobs add constraint agon_certification_jobs_verification_action_state_check
  check (verification_action_state in ('idle','pending','submitted','confirmed','unknown','failed'));
alter table agon_certification_jobs drop constraint if exists agon_certification_jobs_verification_transaction_hash_check;
alter table agon_certification_jobs add constraint agon_certification_jobs_verification_transaction_hash_check
  check (verification_transaction_hash is null or verification_transaction_hash ~ '^0x[0-9a-f]{64}$');

create table if not exists agon_certification_checks (
  check_id                   uuid primary key,
  job_id                     uuid not null references agon_certification_jobs(job_id),
  sequence                   integer not null check (sequence > 0),
  outcome                    text not null check (outcome in ('passed','failed')),
  reason_codes               text[] not null default '{}',
  playground_run_id          uuid references agon_playground_runs(run_id),
  endpoint_qa_evidence_hash  text check (endpoint_qa_evidence_hash is null or endpoint_qa_evidence_hash ~ '^0x[0-9a-f]{64}$'),
  checked_at                 timestamptz not null,
  next_check_at              timestamptz not null,
  created_at                 timestamptz not null default now(),
  unique (job_id, sequence)
);
create index if not exists agon_certification_checks_job_idx
  on agon_certification_checks(job_id, sequence desc);

-- Additive upgrade for installations created before run leases existed.
alter table agon_playground_runs
  add column if not exists lease_expires_at timestamptz;
update agon_playground_runs
   set lease_expires_at = coalesce(lease_expires_at, completed_at, created_at + interval '60 seconds')
 where lease_expires_at is null;
alter table agon_playground_runs
  alter column lease_expires_at set default (now() + interval '60 seconds');
alter table agon_playground_runs
  alter column lease_expires_at set not null;

-- Durable buyer-side x402 preparation. This is an authorization boundary, not
-- a payment ledger: the row is written before any future Circle call and is
-- intentionally stuck in `prepared` while the execution adapter is disabled.
-- The actor + idempotency key pair prevents duplicate intent creation and the
-- input hash makes a retry with changed economics or payload fail closed.
create table if not exists agon_x402_call_intents (
  intent_id                   uuid primary key,
  actor_address               text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  idempotency_key             text not null check (char_length(idempotency_key) between 8 and 128),
  listing_reference           text not null check (char_length(listing_reference) between 1 and 512),
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  service_registry_address    text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                  numeric(78, 0) not null check (listing_id > 0),
  agent_id                    numeric(78, 0) not null check (agent_id >= 0),
  listing_version             numeric(78, 0) not null check (listing_version > 0),
  method                      text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  input                       jsonb not null,
  input_hash                  text not null check (input_hash ~ '^0x[0-9a-f]{64}$'),
  max_amount_usdc             text not null check (max_amount_usdc ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'),
  target_url                  text check (target_url is null or (target_url ~ '^https://' and char_length(target_url) <= 2048)),
  state                       text not null default 'prepared' check (state = 'prepared'),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (actor_address, idempotency_key)
);
create index if not exists agon_x402_call_intents_actor_idx
  on agon_x402_call_intents(actor_address, created_at desc);
alter table agon_x402_call_intents add column if not exists target_url text;
alter table agon_x402_call_intents drop constraint if exists agon_x402_call_intents_target_url_check;
alter table agon_x402_call_intents add constraint agon_x402_call_intents_target_url_check
  check (target_url is null or (target_url ~ '^https://' and char_length(target_url) <= 2048));

-- MCP hire previews retain the exact terms shown to the buyer. The underlying
-- x402 intent owns the money boundary; this snapshot supports restart-safe
-- digest confirmation without rebuilding terms from a mutable service file.
create table if not exists agon_mcp_hire_previews (
  intent_id       uuid primary key references agon_x402_call_intents(intent_id),
  actor_address   text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  terms_digest    text not null check (terms_digest ~ '^0x[0-9a-f]{64}$'),
  terms           jsonb not null check (jsonb_typeof(terms) = 'object'),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);
create index if not exists agon_mcp_hire_previews_actor_idx
  on agon_mcp_hire_previews(actor_address, created_at desc);

-- Durable Circle/x402 receipt boundary. This records evidence and opaque
-- settlement references without storing raw EIP-3009 signatures or keys.
-- A settlement reference is not assumed to be an explorer transaction hash;
-- reconciliation must verify it before a receipt becomes final.
create table if not exists agon_x402_call_receipts (
  receipt_id                uuid primary key,
  intent_id                 uuid not null references agon_x402_call_intents(intent_id),
  state                     text not null check (state in (
    'prepared', 'approved', 'payment_required', 'authorization_ready', 'authorization_submitted',
    'settlement_submitted', 'service_delivered', 'reconciled', 'rejected',
    'failed', 'unknown'
  )),
  approved_amount_usdc      text check (approved_amount_usdc is null or approved_amount_usdc ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'),
  quote_hash                text check (quote_hash is null or quote_hash ~ '^0x[0-9a-f]{64}$'),
  quote_snapshot            jsonb,
  authorization_payload_hash text check (authorization_payload_hash is null or authorization_payload_hash ~ '^0x[0-9a-f]{64}$'),
  authorization_payload     jsonb,
  authorization_hash        text check (authorization_hash is null or authorization_hash ~ '^0x[0-9a-f]{64}$'),
  settlement_ref             text,
  provider_transfer_id       text,
  service_status             int check (service_status is null or service_status between 200 and 299),
  payment_response_hash      text check (payment_response_hash is null or payment_response_hash ~ '^0x[0-9a-f]{64}$'),
  charged_amount_usdc        text check (charged_amount_usdc is null or charged_amount_usdc ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'),
  failure_code               text,
  failure_message            text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (intent_id)
);
create index if not exists agon_x402_call_receipts_state_idx
  on agon_x402_call_receipts(state, updated_at desc);
alter table agon_x402_call_receipts add column if not exists quote_snapshot jsonb;
alter table agon_x402_call_receipts add column if not exists authorization_payload_hash text;
alter table agon_x402_call_receipts add column if not exists authorization_payload jsonb;
alter table agon_x402_call_receipts add column if not exists provider_transfer_id text;

-- Append-only evidence returned by the Circle facilitator verify call. This
-- deliberately stores no raw EIP-3009 signature or wallet key. A verification
-- proves only that the exact authorization was accepted by the pinned
-- facilitator; it does not submit a payment or mark service delivery.
create table if not exists agon_x402_facilitator_verifications (
  verification_id uuid primary key,
  intent_id       uuid not null references agon_x402_call_intents(intent_id),
  receipt_id      uuid not null references agon_x402_call_receipts(receipt_id),
  approval_hash   text not null check (approval_hash ~ '^0x[0-9a-f]{64}$'),
  network         text not null check (network = 'eip155:5042002'),
  payer_address   text check (payer_address is null or payer_address ~ '^0x[0-9a-f]{40}$'),
  evidence_hash   text not null check (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  verified_at     timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (intent_id, approval_hash)
);
create index if not exists agon_x402_facilitator_verifications_intent_idx
  on agon_x402_facilitator_verifications(intent_id, verified_at desc);

-- Human execution approvals are append-only evidence. They bind one explicit
-- approval to the exact prepared plan and authorization hash without enabling
-- settlement or storing the raw signature.
create table if not exists agon_x402_execution_approvals (
  approval_hash             text primary key check (approval_hash ~ '^0x[0-9a-f]{64}$'),
  intent_id                 uuid not null references agon_x402_call_intents(intent_id),
  actor_address             text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  plan_hash                 text not null check (plan_hash ~ '^0x[0-9a-f]{64}$'),
  authorization_hash        text not null check (authorization_hash ~ '^0x[0-9a-f]{64}$'),
  approval_idempotency_key  text not null check (char_length(approval_idempotency_key) between 8 and 128),
  approved_at               timestamptz not null,
  expires_at                timestamptz not null check (expires_at > approved_at),
  created_at                timestamptz not null default now(),
  unique (intent_id, approval_idempotency_key)
);
create index if not exists agon_x402_execution_approvals_intent_idx
  on agon_x402_execution_approvals(intent_id, approved_at desc);

-- Provider delivery evidence is append-only and separate from the payment
-- receipt. A successful HTTP response is not payment proof, and a payment
-- receipt is not service proof. The receipt lifecycle is advanced atomically
-- with the first matching evidence row by the repository.
create table if not exists agon_x402_delivery_evidence (
  delivery_id             uuid primary key,
  intent_id               uuid not null references agon_x402_call_intents(intent_id),
  receipt_id              uuid not null references agon_x402_call_receipts(receipt_id),
  provider_address        text not null check (provider_address ~ '^0x[0-9a-f]{40}$'),
  listing_reference        text not null check (char_length(listing_reference) between 1 and 512),
  service_status          int not null check (service_status between 200 and 299),
  latency_ms              int not null check (latency_ms between 0 and 900000),
  response_hash            text not null check (response_hash ~ '^0x[0-9a-f]{64}$'),
  result_attestation_hash  text check (result_attestation_hash is null or result_attestation_hash ~ '^0x[0-9a-f]{64}$'),
  charged_amount_usdc      text check (charged_amount_usdc is null or charged_amount_usdc ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'),
  evidence_hash            text not null check (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  delivered_at             timestamptz not null,
  created_at               timestamptz not null default now(),
  unique (intent_id, evidence_hash)
);
create index if not exists agon_x402_delivery_evidence_intent_idx
  on agon_x402_delivery_evidence(intent_id, delivered_at desc);

-- Durable buyer-agent wallet policy and spend boundaries. These tables are
-- policy records only; no provider SDK, wallet signer, or RPC client is
-- constructed by migration or persistence code. Unknown outcomes remain
-- cap-consuming until independently reconciled.
create table if not exists agon_x402_agent_wallet_policies (
  agent_id                  text primary key check (agent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  wallet_id                 text,
  wallet_address            text check (wallet_address is null or wallet_address ~ '^0x[0-9a-f]{40}$'),
  network                   text not null check (network = 'eip155:5042002'),
  enabled                   boolean not null default false,
  per_call_cap_base_units  numeric(78, 0) not null check (per_call_cap_base_units >= 0),
  daily_cap_base_units     numeric(78, 0) not null check (daily_cap_base_units >= 0),
  allowed_recipients        jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table if not exists agon_x402_agent_spends (
  agent_id                  text not null references agon_x402_agent_wallet_policies(agent_id),
  idempotency_key           text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  spend_day                 date not null,
  amount_base_units         numeric(78, 0) not null check (amount_base_units > 0),
  recipient_address         text not null check (recipient_address ~ '^0x[0-9a-f]{40}$'),
  state                     text not null check (state in ('reserved','submitted','unknown','confirmed','failed')),
  provider_transfer_id      text,
  transaction_hash          text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  created_at                timestamptz not null,
  updated_at                timestamptz not null,
  primary key (agent_id, idempotency_key)
);
create index if not exists agon_x402_agent_spends_day_idx
  on agon_x402_agent_spends(agent_id, spend_day, state);

-- Durable Agon escrow preparation. This is an ownership and authorization
-- boundary only: no provider, wallet, RPC, or PrizeEscrow call is made by
-- creating or reading this row. Terms are stored as columns so retries can
-- compare exact economics without trusting mutable client JSON.
create table if not exists agon_escrow_intents (
  intent_id                 uuid primary key,
  actor_address             text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  idempotency_key            text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  listing_reference          text not null check (listing_reference ~ '^[1-9][0-9]*:0x[0-9a-f]{40}:[1-9][0-9]*$'),
  terms_hash                text not null check (terms_hash ~ '^0x[0-9a-f]{64}$'),
  network                   text not null check (network = 'eip155:5042002'),
  asset                     text not null check (asset = '0x3600000000000000000000000000000000000000'),
  buyer_address             text not null check (buyer_address ~ '^0x[0-9a-f]{40}$'),
  beneficiary_address       text not null check (beneficiary_address ~ '^0x[0-9a-f]{40}$'),
  service_registry_address  text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                numeric(78, 0) not null check (listing_id > 0),
  agent_id                  numeric(78, 0) not null check (agent_id > 0),
  listing_version           numeric(78, 0) not null check (listing_version > 0),
  manifest_hash             text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  amount_base_units         numeric(78, 0) not null check (amount_base_units > 0),
  fee_bps                   integer not null check (fee_bps between 0 and 1000),
  expires_at                timestamptz not null,
  state                     text not null default 'prepared' check (state in ('prepared','funding','funded','release_pending','released','refund_pending','refunded','unknown','failed')),
  provider_reference        text,
  transaction_hash          text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  pool_contract_address     text check (pool_contract_address is null or pool_contract_address ~ '^0x[0-9a-f]{40}$'),
  pool_controller_address   text check (pool_controller_address is null or pool_controller_address ~ '^0x[0-9a-f]{40}$'),
  pool_id                   numeric(78, 0) check (pool_id is null or pool_id >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (actor_address, idempotency_key)
);
alter table agon_escrow_intents add column if not exists pool_contract_address text;
alter table agon_escrow_intents add column if not exists pool_controller_address text;
alter table agon_escrow_intents add column if not exists pool_id numeric(78, 0);
create index if not exists agon_escrow_intents_actor_idx
  on agon_escrow_intents(actor_address, created_at desc);
create index if not exists agon_escrow_intents_state_idx
  on agon_escrow_intents(state, updated_at desc);

-- Human escrow transaction approvals are append-only evidence. They bind an
-- approval to the exact preflighted calldata intent; they never authorize a
-- signer or enable a wallet/provider write.
create table if not exists agon_escrow_transaction_approvals (
  approval_hash            text primary key check (approval_hash ~ '^0x[0-9a-f]{64}$'),
  intent_id                uuid not null references agon_escrow_intents(intent_id),
  actor_address            text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  operation                text not null check (operation in ('fund','release','refund')),
  intent_hash              text not null check (intent_hash ~ '^0x[0-9a-f]{64}$'),
  approval_idempotency_key text not null check (approval_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  approved_at              timestamptz not null,
  expires_at               timestamptz not null check (expires_at > approved_at),
  created_at               timestamptz not null default now(),
  unique (intent_id, approval_idempotency_key)
);
create index if not exists agon_escrow_transaction_approvals_intent_idx
  on agon_escrow_transaction_approvals(intent_id, approved_at desc);

-- Durable intent state for the deployed AgonJobEscrow contract. This table is
-- intentionally separate from agon_escrow_intents, which models the legacy
-- PrizeEscrow pool lifecycle. Reconciliation is read-only and only persists a
-- state after the independently read job matches every pinned term.
create table if not exists agon_job_escrow_intents (
  intent_id                 uuid primary key,
  actor_address             text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  idempotency_key            text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  listing_reference          text not null check (listing_reference ~ '^[1-9][0-9]*:0x[0-9a-f]{40}:[1-9][0-9]*$'),
  network                   text not null check (network = 'eip155:5042002'),
  asset                     text not null check (asset = '0x3600000000000000000000000000000000000000'),
  escrow_contract_address   text not null check (escrow_contract_address ~ '^0x[0-9a-f]{40}$'),
  buyer_address             text not null check (buyer_address ~ '^0x[0-9a-f]{40}$'),
  provider_address          text not null check (provider_address ~ '^0x[0-9a-f]{40}$'),
  service_registry_address  text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                numeric(78, 0) not null check (listing_id > 0),
  agent_id                  numeric(78, 0) not null check (agent_id > 0),
  listing_version           numeric(78, 0) not null check (listing_version > 0),
  manifest_hash             text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  terms_hash                text not null check (terms_hash ~ '^0x[0-9a-f]{64}$'),
  amount_base_units         numeric(78, 0) not null check (amount_base_units > 0),
  fee_bps                   integer not null check (fee_bps between 0 and 1000),
  review_hours              integer not null check (review_hours between 1 and 720),
  expires_at                timestamptz not null,
  client_reference          text not null check (client_reference ~ '^0x[0-9a-f]{64}$'),
  state                     text not null default 'prepared' check (state in ('prepared','submitted','unknown','created','accepted','job_submitted','complete','rejected','disputed','failed')),
  settlement                text not null default 'none' check (settlement in ('none','provider_paid','buyer_refunded')),
  onchain_job_id            numeric(78, 0),
  transaction_hash          text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  deliverable_hash          text check (deliverable_hash is null or deliverable_hash ~ '^0x[0-9a-f]{64}$'),
  reason_hash               text check (reason_hash is null or reason_hash ~ '^0x[0-9a-f]{64}$'),
  last_reconciled_at        timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (actor_address, idempotency_key),
  unique (actor_address, client_reference)
);
create index if not exists agon_job_escrow_intents_actor_idx
  on agon_job_escrow_intents(actor_address, created_at desc);
create index if not exists agon_job_escrow_intents_state_idx
  on agon_job_escrow_intents(state, updated_at desc);
create index if not exists agon_job_escrow_intents_job_idx
  on agon_job_escrow_intents(onchain_job_id)
  where onchain_job_id is not null;

-- Durable Arena verification intent. Playground output is treated as evidence
-- input, never as an on-chain verification claim. Transaction hashes and
-- evaluation ids are user-submitted markers until an independent read adapter
-- reconciles the deployed Arena state.
create table if not exists agon_arena_evaluations (
  intent_id                    uuid primary key,
  actor_address                text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  idempotency_key              text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  listing_reference             text not null check (listing_reference ~ '^[1-9][0-9]*:0x[0-9a-f]{40}:[1-9][0-9]*$'),
  network                      text not null check (network = 'eip155:5042002'),
  arena_contract_address       text not null check (arena_contract_address ~ '^0x[0-9a-f]{40}$'),
  validation_registry_address  text not null check (validation_registry_address ~ '^0x[0-9a-f]{40}$'),
  participant_address          text not null check (participant_address ~ '^0x[0-9a-f]{40}$'),
  service_registry_address     text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                   numeric(78, 0) not null check (listing_id > 0),
  agent_id                     numeric(78, 0) not null check (agent_id > 0),
  listing_version              numeric(78, 0) not null check (listing_version > 0),
  category                     text not null check (char_length(category) > 0),
  manifest_hash                text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  capability_hash              text not null check (capability_hash ~ '^0x[0-9a-f]{64}$'),
  evaluator_version_hash       text not null check (evaluator_version_hash ~ '^0x[0-9a-f]{64}$'),
  task_commitment              text not null check (task_commitment ~ '^0x[0-9a-f]{64}$'),
  validation_request_hash      text not null check (validation_request_hash ~ '^0x[0-9a-f]{64}$'),
  evidence_root                text not null check (evidence_root ~ '^0x[0-9a-f]{64}$'),
  playground_run_id            uuid not null references agon_playground_runs(run_id),
  expires_at                   timestamptz not null,
  state                        text not null default 'prepared' check (state in ('prepared','request_submitted','evidence_ready','evidence_submitted','verified','rejected','expired','revoked','unknown')),
  evaluation_id                numeric(78, 0),
  request_transaction_hash     text check (request_transaction_hash is null or request_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  start_transaction_hash       text check (start_transaction_hash is null or start_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  evidence_transaction_hash    text check (evidence_transaction_hash is null or evidence_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  marketplace_verification_state text not null default 'not_started' check (marketplace_verification_state in ('not_started','pending','submitted','confirmed','failed','unknown')),
  marketplace_verification_transaction_hash text check (marketplace_verification_transaction_hash is null or marketplace_verification_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  marketplace_verification_error text,
  marketplace_verified_at      timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (actor_address, idempotency_key),
  unique (validation_request_hash),
  unique (playground_run_id)
);
alter table agon_arena_evaluations
  add column if not exists start_transaction_hash text;
alter table agon_arena_evaluations
  add column if not exists marketplace_verification_state text not null default 'not_started';
alter table agon_arena_evaluations
  add column if not exists marketplace_verification_transaction_hash text;
alter table agon_arena_evaluations
  add column if not exists marketplace_verification_error text;
alter table agon_arena_evaluations
  add column if not exists marketplace_verified_at timestamptz;
alter table agon_arena_evaluations drop constraint if exists agon_arena_evaluations_marketplace_verification_state_check;
alter table agon_arena_evaluations add constraint agon_arena_evaluations_marketplace_verification_state_check
  check (marketplace_verification_state in ('not_started','pending','submitted','confirmed','failed','unknown'));
alter table agon_arena_evaluations drop constraint if exists agon_arena_evaluations_state_check;
alter table agon_arena_evaluations add constraint agon_arena_evaluations_state_check
  check (state in ('prepared','request_submitted','evidence_ready','evidence_submitted','verified','rejected','expired','revoked','unknown'));
create index if not exists agon_arena_evaluations_actor_idx
  on agon_arena_evaluations(actor_address, created_at desc);
create index if not exists agon_arena_evaluations_state_idx
  on agon_arena_evaluations(state, updated_at desc);

-- Durable evaluator contribution and prize-claim intents. These records are
-- unsigned transaction plans until the connected operator or beneficiary
-- submits a wallet transaction and records its hash.
create table if not exists agon_syndicate_contributions (
  intent_id                 uuid primary key,
  actor_address             text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  idempotency_key           text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  registry_contract_address text not null check (registry_contract_address ~ '^0x[0-9a-f]{40}$'),
  syndicate_id              numeric(78, 0) not null check (syndicate_id > 0),
  agent_id                  numeric(78, 0) not null check (agent_id > 0),
  contribution_key          text not null check (contribution_key ~ '^0x[0-9a-f]{64}$'),
  score                     numeric(78, 0) not null check (score > 0),
  evidence_hash             text not null check (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  state                     text not null default 'prepared' check (state in ('prepared','submitted','confirmed','unknown')),
  transaction_hash         text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (actor_address, idempotency_key),
  unique (registry_contract_address, syndicate_id, contribution_key)
);
alter table agon_syndicate_contributions drop constraint if exists agon_syndicate_contributions_state_check;
alter table agon_syndicate_contributions add constraint agon_syndicate_contributions_state_check
  check (state in ('prepared','submitted','confirmed','unknown'));
create index if not exists agon_syndicate_contributions_actor_idx
  on agon_syndicate_contributions(actor_address, created_at desc);
create index if not exists agon_syndicate_contributions_state_idx
  on agon_syndicate_contributions(state, updated_at desc);

create table if not exists agon_prize_claim_intents (
  intent_id                 uuid primary key,
  actor_address             text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  idempotency_key           text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  vault_contract_address    text not null check (vault_contract_address ~ '^0x[0-9a-f]{40}$'),
  pool_key                  text not null check (pool_key ~ '^0x[0-9a-f]{64}$'),
  claim_index               numeric(78, 0) not null check (claim_index >= 0),
  beneficiary_address       text not null check (beneficiary_address ~ '^0x[0-9a-f]{40}$'),
  amount_base_units         numeric(78, 0) not null check (amount_base_units > 0),
  proof                     jsonb not null check (jsonb_typeof(proof) = 'array'),
  leaf_hash                 text not null check (leaf_hash ~ '^0x[0-9a-f]{64}$'),
  state                     text not null default 'prepared' check (state in ('prepared','submitted','confirmed','unknown')),
  transaction_hash         text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (actor_address, idempotency_key),
  unique (vault_contract_address, pool_key, claim_index)
);
alter table agon_prize_claim_intents drop constraint if exists agon_prize_claim_intents_state_check;
alter table agon_prize_claim_intents add constraint agon_prize_claim_intents_state_check
  check (state in ('prepared','submitted','confirmed','unknown'));
create index if not exists agon_prize_claim_intents_actor_idx
  on agon_prize_claim_intents(actor_address, created_at desc);
create index if not exists agon_prize_claim_intents_state_idx
  on agon_prize_claim_intents(state, updated_at desc);

-- AGON support workspace. Staff credentials and sessions are isolated from
-- wallet authentication and from the ADMIN_TOKEN operator console. The owner
-- token provisions accounts; daily support work uses named, revocable staff
-- sessions so every handoff and reply has an attributable audit trail.
create table if not exists agon_support_staff (
  staff_id                 uuid primary key,
  email                    text not null unique check (email = lower(email) and char_length(email) between 3 and 254),
  display_name             text not null check (char_length(display_name) between 2 and 80),
  password_hash            text not null check (password_hash like 'scrypt$v1$%'),
  role                     text not null check (role in ('support','technical')),
  status                   text not null default 'active' check (status in ('active','disabled')),
  must_change_password     boolean not null default true,
  failed_login_attempts    integer not null default 0 check (failed_login_attempts >= 0),
  locked_until             timestamptz,
  last_login_at            timestamptz,
  created_by               text not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists agon_support_staff_status_idx on agon_support_staff(status, display_name);

create table if not exists agon_support_sessions (
  token_hash               text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  staff_id                 uuid not null references agon_support_staff(staff_id) on delete cascade,
  created_at               timestamptz not null default now(),
  last_seen_at             timestamptz not null default now(),
  expires_at               timestamptz not null,
  revoked_at               timestamptz,
  check (expires_at > created_at)
);
create index if not exists agon_support_sessions_staff_idx on agon_support_sessions(staff_id, expires_at desc);

create table if not exists agon_support_tickets (
  ticket_id                uuid primary key,
  reference                text not null unique check (reference ~ '^AGN-[A-Z0-9-]{8,40}$'),
  requester_name           text not null check (char_length(requester_name) between 2 and 80),
  requester_email          text not null check (requester_email = lower(requester_email) and char_length(requester_email) between 3 and 254),
  access_token_hash        text not null check (access_token_hash ~ '^[0-9a-f]{64}$'),
  subject                  text not null check (char_length(subject) between 4 and 140),
  category                 text not null default 'general' check (category in ('general','listing','hiring','payment','verification','wallet','security')),
  status                   text not null default 'ai_triage' check (status in ('ai_triage','open','in_progress','waiting_user','resolved','closed')),
  priority                 text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_staff_id        uuid references agon_support_staff(staff_id),
  ai_enabled               boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  last_message_at          timestamptz not null default now(),
  resolved_at              timestamptz
);
create index if not exists agon_support_tickets_queue_idx on agon_support_tickets(status, priority, last_message_at desc);
create index if not exists agon_support_tickets_assignee_idx on agon_support_tickets(assigned_staff_id, status, last_message_at desc);

create table if not exists agon_support_messages (
  message_id               uuid primary key,
  ticket_id                uuid not null references agon_support_tickets(ticket_id) on delete cascade,
  author_type              text not null check (author_type in ('user','assistant','staff','system')),
  author_staff_id          uuid references agon_support_staff(staff_id),
  author_name              text not null check (char_length(author_name) between 1 and 80),
  body                     text not null check (char_length(body) between 1 and 4000),
  visibility               text not null default 'public' check (visibility in ('public','internal')),
  metadata                 jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at               timestamptz not null default now(),
  check ((author_type = 'staff') = (author_staff_id is not null))
);
create index if not exists agon_support_messages_ticket_idx on agon_support_messages(ticket_id, created_at asc);

create table if not exists agon_support_ticket_events (
  event_id                 uuid primary key,
  ticket_id                uuid not null references agon_support_tickets(ticket_id) on delete cascade,
  staff_id                 uuid references agon_support_staff(staff_id),
  event_type               text not null check (event_type in ('created','assigned','status_changed','priority_changed','staff_disabled')),
  detail                   jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at               timestamptz not null default now()
);
create index if not exists agon_support_ticket_events_ticket_idx on agon_support_ticket_events(ticket_id, created_at asc);

create table if not exists agon_support_rate_limits (
  limit_key                text primary key check (limit_key ~ '^[0-9a-f]{64}$'),
  request_count            integer not null default 1 check (request_count > 0),
  window_started_at        timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists agon_support_ai_usage (
  call_id                  uuid primary key,
  ticket_id                uuid not null references agon_support_tickets(ticket_id) on delete cascade,
  model                    text not null,
  input_tokens             integer not null check (input_tokens >= 0),
  output_tokens            integer not null check (output_tokens >= 0),
  cost_usd                 numeric(12, 6) not null check (cost_usd >= 0),
  created_at               timestamptz not null default now()
);
create index if not exists agon_support_ai_usage_day_idx on agon_support_ai_usage(created_at desc);

create table if not exists agon_indexer_state (
  stream_name                 text not null check (char_length(stream_name) > 0),
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  contract_address            text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  last_block                  numeric(78, 0) not null check (last_block >= 0),
  last_block_hash             text not null check (last_block_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at                  timestamptz not null default now(),
  primary key (stream_name, chain_id, contract_address)
);

create or replace function agon_reject_append_only_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'agon_listing_versions_append_only'
      and tgrelid = 'agon_listing_versions'::regclass
  ) then
    create trigger agon_listing_versions_append_only
      before update or delete on agon_listing_versions
      for each row execute function agon_reject_append_only_mutation();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'agon_listing_events_append_only'
      and tgrelid = 'agon_listing_events'::regclass
  ) then
    create trigger agon_listing_events_append_only
      before update or delete on agon_listing_events
      for each row execute function agon_reject_append_only_mutation();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'agon_chain_events_append_only'
      and tgrelid = 'agon_chain_events'::regclass
  ) then
    create trigger agon_chain_events_append_only
      before update or delete on agon_chain_events
      for each row execute function agon_reject_append_only_mutation();
  end if;
end;
$$;

-- Playground seasons. A season is one category on one network. Forecasts are
-- signed by agents and committed as one merkle root per round on
-- AgonSeasonCommits; these tables hold the published leaves and the results
-- used to score them. Nothing here moves money.
create table if not exists agon_seasons (
  season_id        bigint primary key check (season_id > 0),
  network          text not null check (network in ('arc-testnet', 'arc')),
  commits_address  text not null check (commits_address ~ '^0x[0-9a-f]{40}$'),
  category         text not null default 'polymarket-forecasting' check (category = 'polymarket-forecasting'),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  round_hours      integer not null default 6 check (round_hours between 1 and 24),
  created_at       timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists agon_season_entries (
  season_id          bigint not null references agon_seasons(season_id),
  agent_address      text not null check (agent_address ~ '^0x[0-9a-f]{40}$'),
  erc8004_agent_id   numeric(78, 0),
  display_name       text not null check (char_length(display_name) between 1 and 48),
  house              boolean not null default false,
  forecast_endpoint  text check (forecast_endpoint is null or forecast_endpoint ~ '^https://'),
  entered_round      bigint not null check (entered_round >= 0),
  created_at         timestamptz not null default now(),
  primary key (season_id, agent_address)
);

create table if not exists agon_season_rounds (
  season_id          bigint not null references agon_seasons(season_id),
  round              bigint not null check (round >= 0),
  opened_at          timestamptz not null,
  intake_closes_at   timestamptz not null,
  state              text not null default 'open' check (state in ('open', 'committing', 'committed', 'skipped')),
  commit_root        text check (commit_root is null or commit_root ~ '^0x[0-9a-f]{64}$'),
  commit_count       integer check (commit_count is null or commit_count > 0),
  commit_tx          text check (commit_tx is null or commit_tx ~ '^0x[0-9a-f]{64}$'),
  commit_block_time  timestamptz,
  circle_tx_id       text,
  primary key (season_id, round),
  check ((state = 'committed') = (commit_root is not null and commit_tx is not null and commit_block_time is not null))
);
create index if not exists agon_season_rounds_due_idx on agon_season_rounds(state, intake_closes_at);

create table if not exists agon_season_round_markets (
  season_id     bigint not null,
  round         bigint not null,
  market_id     text not null check (market_id ~ '^0x[0-9a-f]{64}$'),
  question      text not null,
  slug          text not null default '',
  end_at        timestamptz not null,
  baseline_bps  integer not null check (baseline_bps between 0 and 10000),
  primary key (season_id, round, market_id),
  foreign key (season_id, round) references agon_season_rounds(season_id, round)
);
create index if not exists agon_season_round_markets_end_idx on agon_season_round_markets(end_at);

create table if not exists agon_season_forecasts (
  season_id        bigint not null,
  round            bigint not null,
  market_id        text not null,
  agent_address    text not null check (agent_address ~ '^0x[0-9a-f]{40}$'),
  probability_bps  integer not null check (probability_bps between 0 and 10000),
  salt             text not null check (salt ~ '^0x[0-9a-f]{64}$'),
  signature        text not null check (signature ~ '^0x[0-9a-f]+$'),
  leaf             text not null check (leaf ~ '^0x[0-9a-f]{64}$'),
  created_at       timestamptz not null default now(),
  primary key (season_id, round, market_id, agent_address),
  foreign key (season_id, round, market_id) references agon_season_round_markets(season_id, round, market_id),
  foreign key (season_id, agent_address) references agon_season_entries(season_id, agent_address)
);

create table if not exists agon_season_market_results (
  market_id    text primary key check (market_id ~ '^0x[0-9a-f]{64}$'),
  status       text not null check (status in ('pending', 'resolved', 'void')),
  outcome      smallint check (outcome in (0, 1)),
  checked_at   timestamptz not null,
  check ((status = 'resolved') = (outcome is not null))
);
