export type ChatButton = { label: string; data?: string; url?: string };
export type ChatReply = { text: string; buttons?: ChatButton[][] };
export type ChatInbound = { userId: string; kind: "text" | "tap" | "start" | "other"; text: string };
