# AGON deployment contract

The canonical repository is `Agon-build/agon`, production branch `main`.
Vercel builds `frontend/` for agon.surf. BNB Mainnet (56) is the default;
BNB Testnet (97) and Arc Testnet (5042002) remain separate contexts.
The BNB-only export is the `bnb-market/` subtree, not the production source.

## What a push deploys

`.github/workflows/deploy.yml` checks both applications, real PostgreSQL
authentication and run-storage tests, chain boundaries, and production builds.
It builds the Arc and BNB API images in CI and transfers a checksummed release
bundle to the VPS. No build runs on the production host. The existing Vercel
Git integration deploys independently; a Vercel green check alone does not
prove that the API release is healthy.

The VPS release script runs migrations, starts only application services,
validates/reloads shared ingress, then checks Arc plus both BNB health routes.
Failed releases attempt to restore previous service images and ingress.
Database rollback is manual and uses the pre-release dumps; it is never a
destructive automatic restore. Existing database volumes and unrelated apps
are not removed.

Required GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
`VPS_HOST_FINGERPRINT`, and optional `VPS_SSH_PORT`. A missing host skips
deployment explicitly; incomplete credentials on a configured host fail it.
The Appleboy transfer clients negotiate ECDSA P-256 before Ed25519 when both
host keys are enabled, so pin the server's ECDSA SHA-256 fingerprint. Verify it
from an already trusted administrator connection before updating the secret;
never disable fingerprint checking to recover a failed deployment.
The host administrator installs `release.sh` as the root-owned
`/usr/local/sbin/agon-deploy` and `release.compose.yml` as
`/etc/agon/release.compose.yml`. Updating either requires an administrator,
not merely changing a file in an uploaded release bundle.

## Runtime boundaries

- Arc keeps its existing private database and environment.
- BNB uses its own restricted database role, database and `deploy/bnb.env`.
  Copy the key names from `bnb.env.example`; never commit values.
- No PostgreSQL port is exposed publicly. Both APIs use the internal network.
- Production AGON proxies `/api/bnb/*` to `https://api.agon.surf/api/bnb/*`.
  Only the active BNB session cookie is forwarded. Arc cookies and authorization
  headers are not forwarded. There is no Arc fallback on a BNB outage.
- Local/preview AGON and the standalone BNB app can run the shared API locally
  with `BNB_DATABASE_URL`. Set server-only `BNB_API_ORIGIN` on AGON when an
  explicit HTTPS upstream is needed. Never point preview writes at production.
- Existing `arcrun` container/volume names are compatibility identifiers,
  not the served product or a reason to delete data.

## Release checks

Check `/api/bnb/56/health` and `/api/bnb/97/health` on agon.surf and the API
host: storage and RPC must be reachable, login available. Check
`https://api.agon.surf/agon/health`: service must be `agon` and `ok` true.
Then perform wallet sign-in, network-switch isolation, listing ownership
refusal and a saved BNB Testnet LP analysis through the actual website.
Health does not prove wallet sign-in end to end or paid execution.

Payment, task execution and settlement remain unavailable until independently
implemented and verified. LP Guardian is read-only and testnet-only.

`backup.sh` backs up both databases plus their environment files. Retention
and off-box storage remain operator configuration. Restore into an isolated
database and verify it before trusting a recovery. Release bundles and image
archives have no automatic destructive pruning; monitor host disk capacity.
