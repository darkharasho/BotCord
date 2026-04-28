import { useState } from 'react';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const reset = async () => {
    if (!confirm('Reset bot token? You will need to re-paste it on next launch.')) return;
    setBusy(true);
    await api.bot.clearToken();
    setBusy(false);
    navigate('/onboarding', { replace: true });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-subtle border border-border rounded-lg p-6 w-96 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Settings</h2>
        <div className="space-y-2">
          <button
            className="w-full px-3 py-2 rounded border border-danger/50 text-danger hover:bg-danger/10 disabled:opacity-50"
            onClick={reset}
            disabled={busy}
          >
            Reset bot token
          </button>
        </div>
        <button className="w-full px-3 py-2 rounded border border-border hover:bg-bg-sunken" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
