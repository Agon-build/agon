import type { CallParams } from "./client.js";

/// The Messages API body for one call. No temperature: Claude 5.5 rejects it as
/// deprecated (400 seen live on 5 Nov 2026), the same rule bedrock.ts follows.
export function anthropicRequest(params: CallParams, model: string) {
  return {
    model,
    max_tokens: params.maxTokens,
    system: params.systemPrompt,
    messages: [{ role: "user" as const, content: params.userPrompt }],
    ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {}),
  };
}
