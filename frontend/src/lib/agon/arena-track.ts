import type { TrackBoard, TrackRound } from "./arena-track-view.ts";
import { AGON_PREVIEW_MODE } from "./client";
import { STAGE_API_URL } from "./stage";

/// The Arena tracks beside the forecast season. A preview build has no track data, so it shows the track as closed.
const CLOSED: TrackBoard = { id: "research", label: "Research", categoryId: "1", open: false, season: null, ranked: false, rows: [], rounds: [] };

async function read<T>(path: string): Promise<T> {
  const res = await fetch(`${STAGE_API_URL}/agon/arena${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`arena ${res.status}`);
  return (await res.json()) as T;
}

/// A track's season, board and latest rounds. A server without the Arena answers 404, which reads as closed.
export async function getTrack(track: string): Promise<TrackBoard> {
  if (AGON_PREVIEW_MODE) return CLOSED;
  const res = await fetch(`${STAGE_API_URL}/agon/arena/tracks/${encodeURIComponent(track)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return { ...CLOSED, id: track };
  if (!res.ok) throw new Error(`arena ${res.status}`);
  return (await res.json()) as TrackBoard;
}

/// One round: who is in it, and once it is committed, its tasks and every answer.
export function getTrackRound(track: string, round: number): Promise<TrackRound> {
  return read<TrackRound>(`/tracks/${encodeURIComponent(track)}/rounds/${round}`);
}
