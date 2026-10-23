# Agon dev copy

The app runs on node-services; the laptop only runs a browser, an SSH tunnel
and a file watcher. Build, try it at http://localhost:3000, push only when it
works.

## Once

```bash
node dev/agon-dev.mjs setup
```

Copies `/opt/arcrun/deploy/.env` from host-service into `~/agon-dev/prod.env`
on node-services (mode 600, not printed), writes the dev overrides
(`dev.env`, from `make-env.sh`), pushes the code, copies the production
database into the dev Postgres and starts it.

Agents need Bedrock. Production uses the host-service server role, which
node-services does not have, so put a Bedrock-only key in
`~/agon-dev/aws.env` on node-services (`AWS_ACCESS_KEY_ID=...` and
`AWS_SECRET_ACCESS_KEY=...`, mode 600), then run the start command again.

## Every session

```bash
node dev/agon-dev.mjs
```

Pushes the code, starts the backend (`tsx watch`) and frontend (`next dev`),
opens the tunnel (laptop 3000 and 8082) and copies each saved file to the
server. Both servers reload on their own. Ctrl+C closes the tunnel; the copy
keeps running on node-services.

Other commands: `telegram` (points @arcrunBot at the dev copy through a
temporary Cloudflare tunnel), `test [files]` (backend tests and typecheck
inside the dev copy), `logs auth|web|tunnel`, `db` (fresh copy of the
production database), `down`.

## What the dev copy never touches

- The production database: dev has its own Postgres and Redis.
- @agonMarketBot: dev chat uses the legacy @arcrunBot.
- On-chain jobs: season commits, escrow, the mainnet outside runtime and the
  ops alert, certification, tests and scores workers are off.
- Email deliveries are off.

Dev hires still pay test USDC from the testnet wallets shared with
production, and show on Arc Testnet.

Release checks before a commit still run in a throwaway VPS folder.
