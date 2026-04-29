import { useState } from 'react';
import { api } from '../lib/api';
import { pushToast } from './Toaster';
import type { PollAnswer } from '../../shared/domain';
import { IconX, IconPlus, IconTrash, IconChevronDown, IconMoodSmile } from '@tabler/icons-react';
import { EmojiPicker } from './EmojiPicker';
import { useGuildEmojis } from '../lib/use-guild-emojis';

const DURATIONS: { hours: number; label: string }[] = [
  { hours: 1, label: '1 hour' },
  { hours: 4, label: '4 hours' },
  { hours: 8, label: '8 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 24 * 3, label: '3 days' },
  { hours: 24 * 7, label: '1 week' },
  { hours: 24 * 14, label: '2 weeks' },
];

const MAX_QUESTION = 300;
const MAX_ANSWER = 55;
const MAX_ANSWERS = 10;

// Renders a saved emoji token (unicode char or `<:name:id>`) at icon size.
function AnswerEmojiPreview({ token }: { token: string }) {
  const m = /^<(a?):([A-Za-z0-9_]+):(\d+)>$/.exec(token);
  if (m) {
    const ext = m[1] === 'a' ? 'gif' : 'png';
    return <img src={`https://cdn.discordapp.com/emojis/${m[3]}.${ext}`} alt={m[2]} className="w-5 h-5" />;
  }
  return <span className="text-[18px] leading-none">{token}</span>;
}

const inputBase =
  'w-full bg-bg-input border border-white/[0.06] rounded-md px-3 py-2.5 text-[14px] text-fg ' +
  'placeholder:text-fg-dim outline-none transition-colors duration-150 ' +
  'focus:border-accent focus:bg-bg-input';

export function PollModal({ channelId, guildId, onClose }: { channelId: string; guildId: string | null; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<PollAnswer[]>([{ text: '' }, { text: '' }]);
  const [durationHours, setDurationHours] = useState(24);
  const [allowMultiselect, setAllowMultiselect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerForIdx, setPickerForIdx] = useState<number | null>(null);
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);
  const guildEmojis = useGuildEmojis(pickerForIdx === null ? null : guildId);

  const updateAnswer = (i: number, text: string) => {
    setAnswers(prev => prev.map((a, idx) => (idx === i ? { ...a, text } : a)));
  };
  const addAnswer = () => {
    if (answers.length >= MAX_ANSWERS) return;
    setAnswers(prev => [...prev, { text: '' }]);
  };
  const removeAnswer = (i: number) => {
    if (answers.length <= 2) return;
    setAnswers(prev => prev.filter((_, idx) => idx !== i));
    if (pickerForIdx === i) setPickerForIdx(null);
  };
  const setAnswerEmoji = (i: number, token: string) => {
    setAnswers(prev => prev.map((a, idx) => (idx === i ? { ...a, emoji: token } : a)));
    setPickerForIdx(null);
  };
  const clearAnswerEmoji = (i: number) => {
    setAnswers(prev => prev.map((a, idx) => {
      if (idx !== i) return a;
      const { emoji: _drop, ...rest } = a;
      void _drop;
      return rest;
    }));
  };

  const trimmedQuestion = question.trim();
  const filledAnswers = answers.filter(a => a.text.trim().length > 0);
  const valid = trimmedQuestion.length > 0 && filledAnswers.length >= 2;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    const res = await api.messages.sendPoll(channelId, {
      question: trimmedQuestion,
      answers: filledAnswers.map(a => {
        const out: PollAnswer = { text: a.text.trim() };
        if (a.emoji) out.emoji = a.emoji;
        return out;
      }),
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        className="bg-bg-subtle border border-white/[0.06] rounded-xl w-[36rem] max-w-[92vw] max-h-[90vh] flex flex-col shadow-2xl animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-fg">Create a Poll</h2>
          <button
            className="text-fg-muted hover:text-fg p-1 rounded transition-colors"
            onClick={onClose}
            title="Close"
          >
            <IconX size={18} stroke={2} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-2 space-y-5 overflow-y-auto">
          {/* Question */}
          <div>
            <label className="block text-[14px] font-semibold text-fg mb-1.5">Question</label>
            <input
              autoFocus
              maxLength={MAX_QUESTION}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What question do you want to ask?"
              className={inputBase}
            />
            <div className="mt-1 text-[11px] text-fg-dim text-right tabular-nums">
              {question.length} / {MAX_QUESTION}
            </div>
          </div>

          {/* Answers */}
          <div>
            <label className="block text-[14px] font-semibold text-fg mb-1.5">Answers</label>
            <div className="space-y-2">
              {answers.map((a, i) => (
                <div key={i} className="relative">
                  {/* Emoji slot — left side. Click toggles picker; if an emoji
                      is set, click clears (matches Discord). */}
                  <button
                    type="button"
                    onClick={(e) => {
                      if (a.emoji) { clearAnswerEmoji(i); return; }
                      if (pickerForIdx === i) { setPickerForIdx(null); return; }
                      setPickerRect(e.currentTarget.getBoundingClientRect());
                      setPickerForIdx(i);
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded flex items-center justify-center text-fg-muted hover:text-fg hover:bg-hover/60 transition-colors"
                    title={a.emoji ? 'Clear emoji' : 'Add emoji'}
                  >
                    {a.emoji
                      ? <AnswerEmojiPreview token={a.emoji} />
                      : <IconMoodSmile size={18} stroke={1.75} />}
                  </button>

                  <input
                    maxLength={MAX_ANSWER}
                    value={a.text}
                    onChange={(e) => updateAnswer(i, e.target.value)}
                    placeholder="Type your answer"
                    className={`${inputBase} pl-11 pr-11`}
                  />

                  <button
                    onClick={() => removeAnswer(i)}
                    disabled={answers.length <= 2}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded flex items-center justify-center text-fg-muted hover:text-danger hover:bg-danger/10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-fg-muted transition-colors"
                    title="Remove answer"
                  >
                    <IconTrash size={15} stroke={1.75} />
                  </button>

                  {pickerForIdx === i && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setPickerForIdx(null)} />
                      <EmojiPicker
                        guildEmojis={guildEmojis}
                        onSelect={(token) => setAnswerEmoji(i, token)}
                        onClose={() => setPickerForIdx(null)}
                        anchorRect={pickerRect}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <button
                onClick={addAnswer}
                disabled={answers.length >= MAX_ANSWERS}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-white/[0.10] text-[13px] text-fg-muted hover:text-fg hover:border-white/[0.20] hover:bg-hover/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <IconPlus size={14} stroke={2} /> Add another answer
              </button>
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-[14px] font-semibold text-fg mb-1.5">Duration</label>
            <div className="relative">
              <select
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value))}
                className={`${inputBase} appearance-none pr-9 cursor-pointer`}
              >
                {DURATIONS.map(d => <option key={d.hours} value={d.hours}>{d.label}</option>)}
              </select>
              <IconChevronDown
                size={16}
                stroke={2}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 mt-2 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-[14px] text-fg select-none">
            <input
              type="checkbox"
              checked={allowMultiselect}
              onChange={(e) => setAllowMultiselect(e.target.checked)}
              className="accent-accent w-4 h-4"
            />
            Allow Multiple Answers
          </label>
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="px-5 py-2 rounded-md bg-accent text-white text-[14px] font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}
