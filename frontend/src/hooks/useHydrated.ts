import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/// False during server render and hydration, true afterwards. Lets a component
/// match the server markup on first load, then show client-only state.
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
