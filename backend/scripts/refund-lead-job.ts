/// Refunds a job of one of Agon's own agents by hand (the Lead, a specialist
/// such as Pitch or Rules Check, or a house forecaster), from the seller wallet
/// the hire paid, using `refund:<jobId>`, so it can never pay twice. Prints the
/// plan and stops unless --yes. Outside services are never refunded by Agon.
/// Usage: npx tsx scripts/refund-lead-job.ts --job 4598ef4b [--yes]
import "dotenv/config";
import { pool } from "../src/db/pool.js";
import { createPlatformUsdcTransfer, getTxState } from "../src/chain/circleDev.ts";
import { stableUuid } from "../src/agon/playground/seasons/committer.ts";
import { waitForCircleTx } from "../src/agon/payments/circle-poll.ts";
import { manualRefundPlan } from "../src/agon/payments/manual-refund.ts";
import { resolvePaymentSettings, type WalletHandle } from "../src/agon/payments/settings.ts";
import { PostgresPaymentsStore } from "../src/agon/payments/store.ts";
import { formatUsdc } from "../src/agon/payments/bargain.ts";

const argv = process.argv.slice(2);
const prefix = argv[argv.indexOf("--job") + 1] ?? "";
const confirmed = argv.includes("--yes");
if (!/^[0-9a-f-]{8,36}$/i.test(prefix)) throw new Error("pass --job <job id or its first 8 characters>");

const resolved = resolvePaymentSettings(process.env);
if (!resolved.enabled || !resolved.ok) throw new Error("payments are not configured on this server");
const { lead, houseSellers, specialistSellers, network } = resolved.settings;
const wallets = [lead, ...Object.values(houseSellers), ...Object.values(specialistSellers)].filter((w): w is WalletHandle => Boolean(w));
const walletOf = (address: string) => wallets.find((w) => w.address.toLowerCase() === address.toLowerCase())!;
const store = new PostgresPaymentsStore(pool);

try {
  const { rows } = await pool.query<{ job_id: string }>("select job_id::text from agon_jobs where job_id::text like $1 limit 2", [`${prefix.toLowerCase()}%`]);
  if (rows.length !== 1) throw new Error(rows.length === 0 ? `no job starts with ${prefix}` : `${prefix} matches more than one job; pass more characters`);
  const job = (await store.getJob(rows[0]!.job_id))!;
  const sellers = wallets.map((w) => w.address);
  const plan = manualRefundPlan(job, await store.listJobPayments(job.rootId), sellers);
  if (!plan.ok) {
    console.log(`no refund: ${plan.reason} (job ${job.jobId}, state ${job.state})`);
    process.exitCode = plan.reason === "already_refunded" ? 0 : 1;
  } else {
    const from = walletOf(plan.from);
    console.log(`refund ${formatUsdc(plan.amount)} USDC on ${network.label} from ${job.providerLabel}'s wallet ${from.address} to ${plan.to} (job ${job.jobId}, key ${plan.key})`);
    if (!confirmed) {
      console.log("dry run: add --yes to send");
    } else {
      // A fresh Circle idempotency key: an earlier automatic attempt may have
      // been refused by Circle before any transaction existed. The refund key
      // above is what prevents a second payment, and it is checked again here.
      const recheck = manualRefundPlan(job, await store.listJobPayments(job.rootId), sellers);
      if (!recheck.ok) throw new Error(`stopped: ${recheck.reason}`);
      const t = await createPlatformUsdcTransfer({ walletId: from.walletId, destinationAddress: plan.to, amountBaseUnits: plan.amount, idempotencyKey: stableUuid(`${plan.key}:manual`), refId: plan.key, blockchain: network.circleChain });
      const txHash = await waitForCircleTx({ id: t.id, label: plan.key, getTxState });
      const at = new Date();
      await store.upsertJobPayment({
        idempotencyKey: plan.key, jobId: job.jobId, kind: "refund", payer: from.address, payee: plan.to, amount: plan.amount, network: network.id,
        status: "settled", txHash, detail: "manual refund by operator", authNonce: null, authValidBefore: null, createdAt: at, updatedAt: at,
      });
      await store.updateJob(job.jobId, { state: "refunded" });
      console.log(`refunded: ${network.explorer}/tx/${txHash}`);
    }
  }
} finally {
  await pool.end();
}
