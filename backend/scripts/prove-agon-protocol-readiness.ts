import { inspectAgonProtocolReadiness } from "../src/agon/protocol-readiness.ts";
import { loadAgonDeployment } from "../src/config/deployments.ts";

const loaded = loadAgonDeployment("../contracts/deployments/agon-arc-testnet.json");
const readiness = inspectAgonProtocolReadiness(loaded.deployment);

console.log(JSON.stringify({
  status: readiness.ready ? "ready" : "blocked",
  chainId: readiness.chainId,
  missingContracts: readiness.missingContracts,
  unverifiedContracts: readiness.unverifiedContracts,
  externalRegistry: readiness.externalRegistry,
  reasons: readiness.reasons,
}, null, 2));

if (!readiness.ready) process.exitCode = 1;
