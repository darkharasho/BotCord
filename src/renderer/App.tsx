import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { api } from './lib/api';
import type { BotStatus } from '../shared/domain';
import { OnboardingRoute } from './routes/onboarding/OnboardingRoute';
import { ShellRoute } from './routes/shell/ShellRoute';
import { ComposeRoute } from './routes/compose/ComposeRoute';

function StatusGate() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    api.bot.getStatus().then(s => { if (mounted) setStatus(s); });
    const unsub = api.events.onBotStatus((s) => setStatus(s));
    return () => { mounted = false; unsub(); };
  }, []);

  useEffect(() => {
    if (!status) return;
    if (status.kind === 'unconfigured') navigate('/onboarding', { replace: true });
    else navigate('/shell', { replace: true });
  }, [status, navigate]);

  return <div className="p-6 text-fg-muted">Loading…</div>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<StatusGate />} />
          <Route path="/onboarding" element={<OnboardingRoute />} />
          <Route path="/shell" element={<ShellRoute />} />
          <Route path="/compose" element={<ComposeRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
