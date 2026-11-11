/// Runs the outside test agent against an Agon deployment.
///
///   AGON_API=https://api.agon.surf AGON_TOKEN=agon_pat_... node --experimental-strip-types scripts/outside-test-agent.ts
///
/// AGON_TOKEN is a budget token created in Account with a daily cap that allows exactly
/// HIRES - 1 hires of the Lead agent (for example 0.50 a hire and 1.00 a day at a 0.30 price,
/// with HIRES=4). Without AGON_TOKEN only discovery runs. The token is never printed.
import { runOutsideAgent } from "../src/agon/outside-agent.ts";

const report = await runOutsideAgent({
  api: process.env.AGON_API?.trim() || "https://api.agon.surf",
  ...(process.env.AGON_TOKEN?.trim() ? { token: process.env.AGON_TOKEN.trim() } : {}),
  ...(process.env.HIRES ? { hires: Number(process.env.HIRES) } : {}),
  ...(process.env.QUESTION?.trim() ? { question: process.env.QUESTION.trim() } : {}),
  log: (line) => console.log(line),
});
console.log(JSON.stringify({ discovery: report.discovery, hires: report.hires, passed: report.passed, reason: report.reason }, null, 2));
process.exit(report.passed ? 0 : 1);
