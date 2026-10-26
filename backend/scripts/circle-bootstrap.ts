import "dotenv/config";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  registerEntitySecretCiphertext,
  initiateDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";

import { circleErrorText } from "../src/chain/circle-error.ts";

/// One-time setup for ArcRun's Circle Developer-Controlled wallets.
///
/// Run with: npm run circle:bootstrap
///
/// Pre-req: CIRCLE_API_KEY is set in backend/.env (Circle Console key).
///
/// Steps:
///   1. Generate a 32-byte entity secret (lives in your .env, never leaves
///      this machine).
///   2. Register the ciphertext with Circle. This is a one-time,
///      non-idempotent call; the SDK writes a recovery file into the
///      `circle-recovery/` directory next to this script. STORE THAT FILE
///      somewhere safe (password manager, encrypted vault). If both the
///      .env entity secret and the recovery file are lost, every wallet
///      under this entity is unrecoverable.
///   3. Create a wallet set. ArcRun uses one wallet set; each user gets one
///      wallet inside it.
///   4. Print CIRCLE_ENTITY_SECRET and CIRCLE_WALLET_SET_ID lines to paste
///      into backend/.env.
///
/// Re-running this script after success creates a fresh entity that shares
/// NO wallets with the previous one. A sentinel file (`circle-recovery/
/// .bootstrapped`) is written to refuse accidental re-runs; delete it
/// deliberately if you really want to bootstrap again.

///
/// --live sets up the separate live entity for Arc mainnet (Circle refuses a
/// test key there): it reads CIRCLE_LIVE_API_KEY, keeps its own recovery folder
/// and sentinel, and prints CIRCLE_LIVE_ENTITY_SECRET and CIRCLE_LIVE_WALLET_SET_ID.

const LIVE = process.argv.includes("--live");
const PREFIX = LIVE ? "CIRCLE_LIVE_" : "CIRCLE_";
const RECOVERY_DIR = resolve(process.cwd(), LIVE ? "circle-recovery-live" : "circle-recovery");
const SENTINEL = join(RECOVERY_DIR, ".bootstrapped");

async function main() {
  const apiKey = process.env[`${PREFIX}API_KEY`]?.trim();
  if (!apiKey) {
    console.error(`${PREFIX}API_KEY is required. Set it in the environment and re-run.`);
    process.exit(1);
  }
  if (LIVE && !apiKey.startsWith("LIVE_API_KEY:")) {
    console.error("CIRCLE_LIVE_API_KEY must be a Circle LIVE_API key (it starts with LIVE_API_KEY:).");
    process.exit(1);
  }

  // The live entity already had a secret on 2026-10-26 (409, code 156015), and
  // it is not the testnet one (156013). With the live secret known (found, or
  // rotated in Circle Console), this creates only the live wallet set; it
  // registers nothing and never prints the secret.
  if (LIVE && process.argv.includes("--reuse-entity-secret")) {
    const entitySecret = (process.env.CIRCLE_LIVE_ENTITY_SECRET ?? process.env.CIRCLE_ENTITY_SECRET)?.trim();
    if (!entitySecret) {
      console.error("Set CIRCLE_LIVE_ENTITY_SECRET (the live entity's secret) and re-run.");
      process.exit(1);
    }
    const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
    const setRes = await client.createWalletSet({ name: "agon-live" });
    const walletSetId = setRes.data?.walletSet?.id;
    if (!walletSetId) {
      console.error("createWalletSet returned no id");
      process.exit(1);
    }
    console.log("the live entity secret works. Add this to the environment:");
    console.log(`CIRCLE_LIVE_WALLET_SET_ID=${walletSetId}`);
    return;
  }

  if (existsSync(SENTINEL)) {
    console.error(
      `Bootstrap already ran (sentinel ${SENTINEL} exists).\n` +
        "Refusing to run again. Re-bootstrap only if you accept that the previous entity's " +
        "wallets become inaccessible; in that case delete the sentinel and the recovery file.",
    );
    process.exit(1);
  }

  // Circle's SDK expects a DIRECTORY path for recoveryFileDownloadPath and
  // writes a file inside with its own name. The earlier version of this script
  // passed a full file path and Circle responded with "Invalid Directory".
  mkdirSync(RECOVERY_DIR, { recursive: true });

  console.log("step 1/3: generating 32-byte entity secret");
  const entitySecret = randomBytes(32).toString("hex");

  console.log("step 2/3: registering entity secret ciphertext with Circle");
  const before = listFiles(RECOVERY_DIR);
  const recovery = await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: RECOVERY_DIR,
  });
  if (!recovery) {
    console.error("registerEntitySecretCiphertext returned no recovery data");
    process.exit(1);
  }
  const newFiles = listFiles(RECOVERY_DIR).filter((f) => !before.includes(f));
  if (newFiles.length === 0) {
    console.warn("  warning: Circle did not write a new file into the recovery dir");
  } else {
    for (const f of newFiles) {
      console.log(`  recovery file: ${join(RECOVERY_DIR, f)}`);
    }
  }
  console.log("  STORE THE RECOVERY FILE(S) IN A PASSWORD MANAGER");

  console.log("step 3/3: creating wallet set");
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  const setRes = await client.createWalletSet({ name: LIVE ? "agon-live" : "arcrun-mainset" });
  const walletSetId = setRes.data?.walletSet?.id;
  if (!walletSetId) {
    console.error("createWalletSet returned no id");
    process.exit(1);
  }

  const envSnippet =
    `\n# Circle Developer-Controlled Wallets (added by circle-bootstrap.ts)\n` +
    `${PREFIX}ENTITY_SECRET=${entitySecret}\n` +
    `${PREFIX}WALLET_SET_ID=${walletSetId}\n`;
  const snippetPath = resolve(process.cwd(), LIVE ? "circle-bootstrap-live.env.snippet" : "circle-bootstrap.env.snippet");
  writeFileSync(snippetPath, envSnippet);
  writeFileSync(SENTINEL, new Date().toISOString());

  console.log("\ndone. paste these into backend/.env:");
  console.log(envSnippet);
  console.log(`(also saved to ${snippetPath})`);
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile());
  } catch {
    return [];
  }
}

main().catch((err) => {
  // Never the raw error: the SDK's error carries the request, including the API key.
  console.error("circle-bootstrap failed:", circleErrorText(err));
  process.exit(1);
});
