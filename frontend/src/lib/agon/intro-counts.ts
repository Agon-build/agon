import { STAGE_API_URL } from "./stage.ts";

export type IntroCounts = {
  circle: { arcMainnet: number; byCategory: Record<string, number>; checkedAt: string } | null;
  discover: { arcMainnet: number | null; arcTestnet: number | null; readAt: string } | null;
};

const NONE: IntroCounts = { circle: null, discover: null };

/// Live counts for the intro's Circle and Discover cards. Any failure means no number.
export async function getIntroCounts(): Promise<IntroCounts> {
  try {
    const res = await fetch(`${STAGE_API_URL}/agon/sources/summary`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return NONE;
    const body = (await res.json()) as Partial<IntroCounts>;
    return { circle: body.circle ?? null, discover: body.discover ?? null };
  } catch {
    return NONE;
  }
}
