import { agonCall } from "./stage";
import type { ConnectLevel } from "./connect-view";

export type ConnectRequest = { clientName: string; logoUri: string | null; verified: boolean; clientHost: string | null; redirectHost: string; level: ConnectLevel; termsAccepted: boolean; expiresAt: string };
export type Connection = { id: string; clientName: string; level: ConnectLevel; createdAt: string; lastUsedAt: string | null };

export const getConnectRequest = (id: string) => agonCall<ConnectRequest>(`/oauth/requests/${encodeURIComponent(id)}`);

export const decideConnect = (id: string, input: { approve: boolean; level: ConnectLevel; acceptTerms?: boolean; termsVersion?: string }) =>
  agonCall<{ redirectTo: string }>(`/oauth/requests/${encodeURIComponent(id)}/decision`, { body: input });

export const listConnections = () => agonCall<{ connections: Connection[] }>("/agon/app/connections");

export const disconnectConnection = (id: string) => agonCall<{ disconnected: true }>(`/agon/app/connections/${encodeURIComponent(id)}/disconnect`, { body: {} });
