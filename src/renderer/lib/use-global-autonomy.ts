import { useEffect, useState } from 'react';
import { api } from './api';
import type { GlobalAutonomyConfig } from '../../shared/domain';

type Listener = (cfg: GlobalAutonomyConfig) => void;
const listeners = new Set<Listener>();
let cached: GlobalAutonomyConfig | null = null;

const broadcast = (cfg: GlobalAutonomyConfig) => {
  cached = cfg;
  for (const l of listeners) l(cfg);
};

export function useGlobalAutonomy(): {
  cfg: GlobalAutonomyConfig | null;
  set: (partial: Partial<GlobalAutonomyConfig>) => Promise<void>;
} {
  const [cfg, setCfg] = useState<GlobalAutonomyConfig | null>(cached);

  useEffect(() => {
    listeners.add(setCfg);
    if (!cached) {
      api.autonomy.getGlobalConfig().then(r => { if (r.ok) broadcast(r.data); });
    }
    return () => { listeners.delete(setCfg); };
  }, []);

  const set = async (partial: Partial<GlobalAutonomyConfig>) => {
    const res = await api.autonomy.setGlobalConfig(partial);
    if (res.ok) broadcast(res.data);
  };

  return { cfg, set };
}
