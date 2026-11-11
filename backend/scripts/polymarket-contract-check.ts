/// Reads live Polymarket through every call of Agon's data module and prints what came back.
/// Read-only and keyless. Exit code 1 when any read fails.
///
///   node --experimental-strip-types scripts/polymarket-contract-check.ts
import { createPolymarket, runContractCheck } from "../src/agon/polymarket/index.ts";

const result = await runContractCheck({ polymarket: createPolymarket() });
console.log(`Polymarket data check at ${result.checkedAt}${result.market ? ` on ${result.market}` : ""}`);
for (const line of result.lines) console.log(`${line.ok ? "ok  " : "FAIL"}  ${line.name.padEnd(14)} ${line.detail}`);
console.log(result.ok ? "all reads passed" : "one or more reads failed");
process.exit(result.ok ? 0 : 1);
