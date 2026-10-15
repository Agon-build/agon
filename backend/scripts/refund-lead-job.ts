/// Refunds a Lead job by hand from the Lead wallet, using the Lead's own refund
/// key, so it can never pay twice. Prints the plan and stops unless --yes.
/// Usage: npx tsx scripts/refund-lead-job.ts --job 4598ef4b [--yes]
import "dotenv/config";
import { pool } from "../src/db/pool.js";
import { createPlatformUsdcTransfer, getTxState } from "../src/chain/circleDev.ts";
import { stableUuid } from "../src/agon/playground/seasons/committer.ts";
import { waitForCircleTx } from "../src/agon/payments/circle-poll.ts";
import { manualRefundPlan } from "../src/agon/payments/manual-refund.ts";
import { resolvePaymentSettings } from "../src/agon/payments/settings.ts";
import { PostgresPaymentsStore } from "../src/agon/payments/store.ts";
import { formatUsdc } from "../src/agon/payments/bargain.ts";

const argv = process.argv.slice(2);
const prefix = argv[argv.indexOf("--job") + 1] ?? "";
const confirmed = argv.includes("--yes");
if (!/^[0-9a-f-]{8,36}$/i.test(prefix)) throw new Error("pass --job <job id or its first 8 characters>");

const resolved = resolvePaymentSettings(process.env);
if (!resolved.enabled || !resolved.ok) throw new Error("payments are not configured on this server");
const { lead, network } = resolved.settings;
const store = new PostgresPaymentsStore(pool);

try {
  const { rows } = await pool.query<{ job_id: string }>("select job_id::text from agon_jobs where job_id::text like $1 limit 2", [`${prefix.toLowerCase()}%`]);
  if (rows.length !== 1) throw new Error(rows.length === 0 ? `no job starts with ${prefix}` : `${prefix} matches more than one job; pass more characters`);
  const job = (await store.getJob(rows[0]!.job_id))!;
  const plan = manualRefundPlan(job, await store.listJobPayments(job.rootId), lead.address);
  if (!plan.ok) {
    console.log(`no refund: ${plan.reason} (job ${job.jobId}, state ${job.state})`);
    process.exitCode = plan.reason === "already_refunded" ? 0 : 1;
  } else {
    console.log(`refund ${formatUsdc(plan.amount)} USDC on ${network.label} from the Lead wallet ${lead.address} to ${plan.to} (job ${job.jobId}, key ${plan.key})`);
    if (!confirmed) {
      console.log("dry run: add --yes to send");
    } else {
      // A fresh Circle idempotency key: the earlier attempt was refused by Circle
      // before any transaction existed. The refund key above is what prevents a
      // second payment, and it is checked again right before sending.
      const recheck = manualRefundPlan(job, await store.listJobPayments(job.rootId), lead.address);
      if (!recheck.ok) throw new Error(`stopped: ${recheck.reason}`);
      const t = await createPlatformUsdcTransfer({ walletId: lead.walletId, destinationAddress: plan.to, amountBaseUnits: plan.amount, idempotencyKey: stableUuid(`${plan.key}:manual`), refId: plan.key, blockchain: network.circleChain });
      const txHash = await waitForCircleTx({ id: t.id, label: plan.key, getTxState });
      const at = new Date();
      await store.upsertJobPayment({
        idempotencyKey: plan.key, jobId: job.jobId, kind: "refund", payer: lead.address, payee: plan.to, amount: plan.amount, network: network.id,
        status: "settled", txHash, detail: "manual refund by operator", authNonce: null, authValidBefore: null, createdAt: at, updatedAt: at,
      });
      await store.updateJob(job.jobId, { state: "refunded" });
      console.log(`refunded: ${network.explorer}/tx/${txHash}`);
    }
  }
} finally {
  await pool.end();
}
