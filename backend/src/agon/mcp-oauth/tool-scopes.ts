/// The capability each scoped MCP tool needs, so the MCP edge can ask the
/// person to step up before the call instead of failing inside the tool.
/// Kept in step with the requireActor calls by mcp-oauth-edge.test.ts.
export const TOOL_SCOPES: Record<string, string> = {
  preview_hire: "agon:read",
  authorize_hire: "wallet:execute",
  get_hire_status: "agon:read",
  start_listing: "listing:prepare",
  check_listing: "listing:prepare",
  compile_listing: "listing:prepare",
  prepare_listing_publication: "listing:write",
  prepare_listing_version: "listing:write",
  pause_listing: "listing:write",
  confirm_listing: "listing:confirm",
  confirm_pause: "listing:confirm",
  get_listing_publication: "agon:read",
  setup_managed_publisher: "listing:prepare",
  get_managed_listing: "agon:read",
  approve_managed_listing: "listing:write",
  continue_managed_listing: "listing:write",
  run_agent_test: "playground:run",
  hire_service: "agon:read",
  confirm_hire: "wallet:execute",
};
