'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, Stats } from './api';

const StatsContext = createContext<{ stats: Stats | null; refreshStats: () => void }>({
  stats: null,
  refreshStats: () => {},
});

export function StatsProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);

  const refreshStats = useCallback(() => {
    api<Stats>('/api/emails/stats').then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    refreshStats();
    const t = setInterval(refreshStats, 10_000);
    return () => clearInterval(t);
  }, [refreshStats]);

  return <StatsContext.Provider value={{ stats, refreshStats }}>{children}</StatsContext.Provider>;
}

export const useStats = () => useContext(StatsContext);
