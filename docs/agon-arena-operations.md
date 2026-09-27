# Arena verification operations

Agon exposes Arena verification readiness from `GET /agon/health` so an operator or MCP client can tell whether a real evaluator can run before preparing an evaluation.

The response includes `capabilities.arenaEvaluatorReadiness`:

- `assigned`: the configured evaluator address currently has `EVALUATOR_ROLE` on the active Arena. Since 23 September 2026 that is `AgonArenaV2` at `0x05B81dF2F1615BBDEbd837991BAB199F65eCCB83`, linked to `AgonServiceRegistryV2`.
- `role_not_assigned`: the evaluator address is configured, but the chain read confirms the role is missing.
- `evaluator_not_configured`: Arena reads are enabled, but no evaluator address is configured.
- `read_failed`: the read-only RPC check could not establish the role state. Treat this as unknown.
- `disabled` or `unconfigured`: the read gate is off or the Arena integration is not wired.

The check calls only the contract's `hasRole` view. It never grants a role, signs a transaction, or broadcasts a verification write. The existing `AGON_ARENA_VALIDATION_ENABLED` gate remains the explicit switch for enabling the read path, and live spending or Arena writes remain separate controls.

Before a real evaluation, confirm:

1. The `AgonArenaV2` address and its linked `AgonServiceRegistryV2` are present in the deployment receipt.
2. `AGON_ARENA_VALIDATION_ENABLED=true` is set in the operator environment.
3. `AGON_ARENA_VALIDATOR_ADDRESS` is the approved evaluator wallet.
4. `/agon/health` reports `assigned`.
5. The operator separately reviews the prepared request and evidence transactions before submitting them with a wallet.
