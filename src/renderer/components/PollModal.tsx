import { useState } from 'react';
import { api } from '../lib/api';
import { pushToast } from './Toaster';
import type { PollAnswer } from '../../shared/domain';
import { IconX, IconPlus } from '@tabler/icons-react';

const DURATIONS: { hours: number; label: string }[] = [
  { hours: 1, label: '1 hour' },
  { hours: 4, label: '4 hours' },
  { hours: 8, label: '8 hours' },
  { hours: 24, label: '1 day' },
  { hours: 24 * 3, label: '3 days' },
  { hours: 24 * 7, label: '1 week' },
  { hours: 24 * 14, label: '2 weeks' },
];

export function PollModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<PollAnswer[]>([{ text: '' }, { text: '' }]);
  const [durationHours, setDurationHours] = useState(24);
  const [allowMultiselect, setAllowMultiselect] = useState(false);
  const [busy, setBusy] = useState(false);

  const updateAnswer = (i: number, text: string) => {
    setAnswers(prev => prev.map((a, idx) => idx === i ? { ...a, text } : a));
  };
  const addAnswer = () => {
    if (answers.length >= 10) return;
    setAnswers(prev => [...prev, { text: '' }]);
  };
  const removeAnswer = (i: number) => {
    if (answers.length <= 2) return;
    setAnswers(prev => prev.filter((_, idx) => idx !== i));
  };

  const valid = question.trim().length > 0 && answers.every(a => a.text.trim().length > 0);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    const res = await api.messages.sendPoll(channelId, {
      question: question.trim(),
      answers: answers.map(a => ({ text: a.text.trim() })),
      durationHours,
      allowMultiselect,
    });
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', `Couldn't post poll: ${res.error.message}`);
      return;
    }
    pushToast('ok', 'Poll posted');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-bg-subtle border border-border rounded-lg w-[32rem] max-w-[90vw] max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Create a poll</h2>
          <button className="text-fg-muted hover:text-fg" onClick={onClose} title="Close">
            <IconX size={18} stroke={2} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div>
            <label className="block text-[11px] uppercase font-semibold text-fg-dim mb-1">Question</label>
            <input
              autoFocus
              maxLength={300}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question…"
              className="w-full bg-bg-input border border-border rounded px-3 py-2 text-fg text-sm outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase font-semibold text-fg-dim mb-1">Answers</label>
            <div className="space-y-2">
              {answers.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    maxLength={55}
                    value={a.text}
                    onChange={(e) => updateAnswer(i, e.target.value)}
                    placeholder={`Answer ${i + 1}`}
                    className="flex-1 bg-bg-input border border-border rounded px-3 py-2 text-fg text-sm outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => removeAnswer(i)}
                    disabled={answers.length <= 2}
                    className="text-fg-dim hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed p-1"
                    title="Remove"
                  >
                    <IconX size={16} stroke={2} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addAnswer}
              disabled={answers.length >= 10}
              className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover disabled:opacity-40"
            >
              <IconPlus size={14} stroke={2} /> Add answer
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase font-semibold text-fg-dim mb-1">Duration</label>
              <select
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value))}
                className="w-full bg-bg-input border border-border rounded px-3 py-2 text-fg text-sm outline-none focus:border-accent"
              >
                {DURATIONS.map(d => <option key={d.hours} value={d.hours}>{d.label}</option>)}
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 cursor-pointer text-sm text-fg select-none">
              <input
                type="checkbox"
                checked={allowMultiselect}
                onChange={(e) => setAllowMultiselect(e.target.checked)}
                className="accent-accent"
              />
              Multiple selections
            </label>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-bg-sunken">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded text-fg hover:bg-hover text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="px-4 py-2 rounded bg-accent text-white text-sm hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? 'Posting…' : 'Post poll'}
          </button>
        </div>
      </div>
    </div>
  );
}
