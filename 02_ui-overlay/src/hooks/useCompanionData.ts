import { useEffect, useState } from 'react';
import { fetchCompanionState, type CompanionState } from '../services/companionClient';

const POLL_MS = 5000;

// Polls the Companion App for live panel data (news / ai / spotify / memos).
// Returns `null` data while offline so panels keep their mock fallbacks.
export function useCompanionData() {
  const [data, setData] = useState<CompanionState | null>(null);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await fetchCompanionState();
      if (!alive) return;
      setData(s);
      setOnline(s !== null);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return { data, online };
}
