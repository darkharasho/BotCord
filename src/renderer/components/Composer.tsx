import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useGuildEmojis } from '../lib/use-guild-emojis';
import { EmojiPicker } from './EmojiPicker';
import { AttachmentTray } from './AttachmentTray';
import { AutocompletePopover, type AutocompleteItem } from './AutocompletePopover';
import { STANDARD_EMOJI } from '../lib/emoji-data';
import { pushToast } from './Toaster';
import type { GatewayState, GuildEmoji, MemberSummary } from '../../shared/domain';
import { IconCirclePlus, IconMoodSmile, IconSend2, IconUpload, IconChartBar } from '@tabler/icons-react';
import { PollModal } from './PollModal';

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;
const AUTOCOMPLETE_LIMIT = 8;

type AutocompleteState =
  | { kind: 'mention'; query: string; start: number; end: number; selectedIdx: number; members: MemberSummary[] }
  | { kind: 'emoji'; query: string; start: number; end: number; selectedIdx: number }
  | null;

// Find an active @ or : trigger immediately to the left of the cursor.
function detectTrigger(text: string, cursor: number): { kind: 'mention' | 'emoji'; query: string; start: number; end: number } | null {
  // Walk backwards from cursor for up to 32 chars looking for @ or : preceded by start-of-text or whitespace.
  const max = Math.max(0, cursor - 32);
  for (let i = cursor - 1; i >= max; i--) {
    const ch = text[i];
    if (!ch) break;
    if (ch === '@' || ch === ':') {
      const before = i === 0 ? ' ' : text[i - 1] ?? ' ';
      if (!/\s/.test(before)) return null;
      const query = text.slice(i + 1, cursor);
      // The query allows letters, digits, underscores, periods. If it contains anything else (whitespace, etc) — abort.
      if (!/^[\w.\-]*$/.test(query)) return null;
      return { kind: ch === '@' ? 'mention' : 'emoji', query, start: i, end: cursor };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

export function Composer({ channelId, guildId }: { channelId: string | null; guildId: string | null }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gateway, setGateway] = useState<GatewayState>({ status: 'connecting' });
  const [dragOver, setDragOver] = useState(false);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState>(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Always load guild emojis when available so `:` autocomplete works without opening the picker.
  const guildEmojis = useGuildEmojis(guildId);

  useEffect(() => {
    api.bot.getStatus().then(s => { if (s.kind === 'configured') setGateway(s.gateway); });
    return api.events.onGatewayState(setGateway);
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 240) + 'px';
  }, [text]);

  // Reset autocomplete state when channel or guild changes.
  useEffect(() => { setAutocomplete(null); }, [channelId, guildId]);

  // Whenever text changes, redetect a trigger and refresh suggestions.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const trig = detectTrigger(text, ta.selectionStart);
    if (!trig) { setAutocomplete(null); return; }

    if (trig.kind === 'mention') {
      if (!guildId) { setAutocomplete(null); return; }
      let cancelled = false;
      api.guilds.searchMembers(guildId, trig.query, AUTOCOMPLETE_LIMIT).then(res => {
        if (cancelled) return;
        const members = res.ok ? res.data : [];
        if (members.length === 0) { setAutocomplete(null); return; }
        setAutocomplete({ kind: 'mention', query: trig.query, start: trig.start, end: trig.end, selectedIdx: 0, members });
      });
      return () => { cancelled = true; };
    }

    // Emoji trigger — purely local.
    if (trig.kind === 'emoji') {
      const filteredAny = filterEmoji(trig.query, guildEmojis);
      if (filteredAny.length === 0) { setAutocomplete(null); return; }
      setAutocomplete({ kind: 'emoji', query: trig.query, start: trig.start, end: trig.end, selectedIdx: 0 });
      return;
    }
  }, [text, guildId, guildEmojis]);

  const emojiResults = useMemo(() => {
    if (autocomplete?.kind !== 'emoji') return [];
    return filterEmoji(autocomplete.query, guildEmojis);
  }, [autocomplete, guildEmojis]);

  const items: AutocompleteItem[] = useMemo(() => {
    if (!autocomplete) return [];
    if (autocomplete.kind === 'mention') {
      return autocomplete.members.map((m) => ({
        key: m.id,
        label: (
          <>
            {m.avatarUrl
              ? <img src={m.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
              : <span className="w-5 h-5 rounded-full bg-bg-input inline-block" />}
            <span className="font-medium" style={m.roleColor ? { color: m.roleColor } : undefined}>{m.displayName}</span>
            <span className="text-fg-dim text-xs">@{m.username}</span>
          </>
        ),
      }));
    }
    return emojiResults.map((e) => ({
      key: e.key,
      label: (
        <>
          {e.kind === 'custom'
            ? <img src={e.url} alt="" className="w-5 h-5" />
            : <span className="text-base inline-block w-5 text-center">{e.char}</span>}
          <span>:{e.name}:</span>
        </>
      ),
    }));
  }, [autocomplete, emojiResults]);

  const acLength = items.length;

  const applyAutocomplete = (idx: number) => {
    if (!autocomplete || idx < 0 || idx >= acLength) return;
    let token: string;
    if (autocomplete.kind === 'mention') {
      const m = autocomplete.members[idx]!;
      token = `<@${m.id}>`;
    } else {
      const e = emojiResults[idx]!;
      token = e.kind === 'custom' ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : e.char;
    }
    const before = text.slice(0, autocomplete.start);
    const after = text.slice(autocomplete.end);
    const next = before + token + ' ' + after;
    setText(next);
    setAutocomplete(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = (before + token + ' ').length;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos;
    });
  };

  const addFiles = (incoming: File[]) => {
    const allowed: File[] = [];
    for (const f of incoming) {
      if (f.size > MAX_BYTES) { pushToast('warn', `${f.name} is over 25MB`); continue; }
      allowed.push(f);
    }
    setFiles(prev => {
      const merged = [...prev, ...allowed];
      if (merged.length > MAX_FILES) {
        pushToast('warn', `Max ${MAX_FILES} attachments`);
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
  };

  const onPick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => { if (input.files) addFiles(Array.from(input.files)); };
    input.click();
  };

  const insertAtCursor = (token: string) => {
    const ta = taRef.current;
    if (!ta) { setText(t => t + token); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setText(t => t.slice(0, start) + token + t.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + token.length;
    });
  };

  const send = async () => {
    if (!channelId) return;
    const content = text.trim();
    if (content.length === 0 && files.length === 0) return;
    setBusy(true);
    let res;
    if (files.length > 0) {
      const attachments = await Promise.all(files.map(async f => ({
        name: f.name,
        mimeType: f.type || 'application/octet-stream',
        bytes: new Uint8Array(await f.arrayBuffer()),
      })));
      res = await api.messages.sendWithAttachments(channelId, content, attachments);
    } else {
      res = await api.messages.send(channelId, content);
    }
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', `Send failed: ${res.error.message}`);
      return;
    }
    setText('');
    setFiles([]);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete && acLength > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAutocomplete(s => s ? ({ ...s, selectedIdx: (s.selectedIdx + 1) % acLength }) : s); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAutocomplete(s => s ? ({ ...s, selectedIdx: (s.selectedIdx - 1 + acLength) % acLength }) : s); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyAutocomplete(autocomplete.selectedIdx); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setAutocomplete(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files) addFiles(Array.from(e.dataTransfer.files));
  };

  const offline = gateway.status !== 'ready';

  return (
    <div
      className="bg-bg relative px-4 pt-2 pb-6"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent rounded-lg flex items-center justify-center z-40 pointer-events-none m-2">
          <span className="text-fg font-semibold">Drop to attach</span>
        </div>
      )}
      {offline && (
        <div className="mb-2 px-3 py-1 text-xs text-warn bg-warn/10 rounded">Bot is not connected — sending disabled.</div>
      )}
      <div className="bg-bg-input rounded-lg relative">
        {autocomplete && (
          <AutocompletePopover
            title={autocomplete.kind === 'mention' ? 'Members matching @' + autocomplete.query : 'Emoji matching :' + autocomplete.query}
            items={items}
            selectedIdx={autocomplete.selectedIdx}
            onPick={applyAutocomplete}
          />
        )}
        <AttachmentTray files={files} onRemove={(i) => setFiles(prev => prev.filter((_, idx) => idx !== i))} />
        <div className="flex items-end gap-1 px-2">
          <div className="relative shrink-0">
            <button
              onClick={() => setPlusMenuOpen(o => !o)}
              disabled={offline || busy}
              className="text-fg-muted hover:text-fg w-10 h-11 flex items-center justify-center disabled:opacity-40"
              title="Add"
            ><IconCirclePlus size={22} stroke={1.75} /></button>
            {plusMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setPlusMenuOpen(false)} />
                <div className="absolute bottom-full left-0 mb-2 w-56 bg-bg-subtle border border-border rounded-lg shadow-2xl z-40 overflow-hidden">
                  <button
                    onClick={() => { setPlusMenuOpen(false); onPick(); }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-fg hover:bg-hover"
                  >
                    <IconUpload size={18} stroke={1.75} className="text-fg-muted" />
                    Upload a file
                  </button>
                  <button
                    onClick={() => { setPlusMenuOpen(false); setPollOpen(true); }}
                    disabled={!channelId}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-fg hover:bg-hover disabled:opacity-40"
                  >
                    <IconChartBar size={18} stroke={1.75} className="text-fg-muted" />
                    Create a poll
                  </button>
                </div>
              </>
            )}
          </div>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => setTimeout(() => setAutocomplete(null), 100)}
            disabled={offline || busy}
            placeholder={channelId ? 'Message…' : 'Select a channel'}
            rows={1}
            className="flex-1 bg-transparent text-fg placeholder:text-fg-dim text-[15px] py-3 resize-none disabled:opacity-50 outline-none"
          />
          <div className="relative shrink-0">
            <button
              onClick={() => setEmojiOpen(o => !o)}
              disabled={offline || busy}
              className="text-fg-muted hover:text-fg w-10 h-11 flex items-center justify-center disabled:opacity-40"
              title="Emoji"
            ><IconMoodSmile size={22} stroke={1.75} /></button>
            {emojiOpen && (
              <EmojiPicker
                guildEmojis={guildEmojis}
                onSelect={(token) => { insertAtCursor(token); }}
                onClose={() => setEmojiOpen(false)}
              />
            )}
          </div>
          {(text.trim().length > 0 || files.length > 0) && (
            <button
              onClick={send}
              disabled={offline || busy || !channelId}
              className="text-accent hover:text-accent-hover w-10 h-11 flex items-center justify-center disabled:opacity-40 shrink-0"
              title="Send"
            ><IconSend2 size={22} stroke={1.75} /></button>
          )}
        </div>
      </div>
      {pollOpen && channelId && <PollModal channelId={channelId} onClose={() => setPollOpen(false)} />}
    </div>
  );
}

type EmojiCandidate =
  | { key: string; kind: 'custom'; name: string; id: string; animated: boolean; url: string }
  | { key: string; kind: 'standard'; name: string; char: string };

function filterEmoji(query: string, guildEmojis: GuildEmoji[]): EmojiCandidate[] {
  const q = query.toLowerCase();
  const out: EmojiCandidate[] = [];

  for (const e of guildEmojis) {
    if (q.length === 0 || e.name.toLowerCase().includes(q)) {
      out.push({ key: 'g:' + e.id, kind: 'custom', name: e.name, id: e.id, animated: e.animated, url: e.url });
      if (out.length >= AUTOCOMPLETE_LIMIT) return out;
    }
  }
  for (const e of STANDARD_EMOJI) {
    if (q.length === 0 || e.name.includes(q) || e.keywords.includes(q)) {
      out.push({ key: 's:' + e.name, kind: 'standard', name: e.name, char: e.char });
      if (out.length >= AUTOCOMPLETE_LIMIT) return out;
    }
  }
  return out;
}
