import { useEffect, useState } from 'react';
import { fetchCompanionState, type CompanionState } from '../services/companionClient';

const POLL_MS = 5000;
const OFFLINE_POLL_MS = 1000;

// Polls the Companion App for live panel data (news / spotify / memos).
// Returns `null` data while offline so panels keep their mock fallbacks.
export function useCompanionData() {
  const [data, setData] = useState<CompanionState | null>(null);
  const [online, setOnline] = useState(false);

  const refresh = async (): Promise<CompanionState | null> => {
    const s = await fetchCompanionState();
    setData(s);
    setOnline(s !== null);
    return s;
  };

  useEffect(() => {
    let alive = true;
    let timeoutId: number | undefined;
    const tick = async () => {
      const s = await fetchCompanionState();
      if (!alive) return;
      setData(s);
      setOnline(s !== null);
      timeoutId = window.setTimeout(tick, s ? POLL_MS : OFFLINE_POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  return { data, online, refresh };
}
