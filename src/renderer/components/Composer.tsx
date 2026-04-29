import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useGuildEmojis } from '../lib/use-guild-emojis';
import { EmojiPicker } from './EmojiPicker';
import { AttachmentTray } from './AttachmentTray';
import { AutocompletePopover, type AutocompleteItem } from './AutocompletePopover';
import { STANDARD_EMOJI } from '../lib/emoji-data';
import { pushToast } from './Toaster';
import type { GatewayState, GuildEmoji, MemberSummary } from '../../shared/domain';
import { IconCirclePlus, IconMoodSmile, IconSend2, IconUpload, IconChartBar, IconX } from '@tabler/icons-react';
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

export function Composer({
  channelId, guildId, replyTo, onCancelReply,
}: {
  channelId: string | null;
  guildId: string | null;
  replyTo?: { messageId: string; authorDisplayName: string } | null;
  onCancelReply?: () => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gateway, setGateway] = useState<GatewayState>({ status: 'connecting' });
  const [dragOver, setDragOver] = useState(false);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState>(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  // displayName → user id, populated when an @ autocomplete is accepted.
  // Resolved back to <@id> at send time.
  const mentionMap = useRef<Map<string, string>>(new Map());
  // Monotonic request id so a slow IPC search response can't override
  // newer state (e.g. after the user has already accepted a suggestion).
  const acRequestRef = useRef(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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

  const refreshAutocomplete = (value: string, cursor: number) => {
    const trig = detectTrigger(value, cursor);
    if (!trig) { setAutocomplete(null); return; }

    // Suppress when the @… we're standing in is already a resolved mention.
    // Read the full word starting at the trigger, not just up to the cursor.
    if (trig.kind === 'mention') {
      let wordEnd = trig.end;
      while (wordEnd < value.length && !/\s/.test(value[wordEnd]!)) wordEnd++;
      const fullWord = value.slice(trig.start + 1, wordEnd);
      if (mentionMap.current.has(fullWord)) { setAutocomplete(null); return; }
    }

    if (trig.kind === 'mention') {
      if (!guildId) { setAutocomplete(null); return; }
      const reqId = ++acRequestRef.current;
      const opts: { limit: number; channelId?: string } = { limit: AUTOCOMPLETE_LIMIT };
      if (channelId) opts.channelId = channelId;
      api.guilds.searchMembers(guildId, trig.query, opts).then(res => {
        if (reqId !== acRequestRef.current) return; // stale response — ignore
        const members = res.ok ? res.data : [];
        if (members.length === 0) { setAutocomplete(null); return; }
        setAutocomplete({ kind: 'mention', query: trig.query, start: trig.start, end: trig.end, selectedIdx: 0, members });
      });
      return;
    }
    if (trig.kind === 'emoji') {
      const filtered = filterEmoji(trig.query, guildEmojis);
      if (filtered.length === 0) { setAutocomplete(null); return; }
      setAutocomplete({ kind: 'emoji', query: trig.query, start: trig.start, end: trig.end, selectedIdx: 0 });
    }
  };

  const onTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    refreshAutocomplete(e.target.value, e.target.selectionStart);
  };

  const onTextSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    refreshAutocomplete(ta.value, ta.selectionStart);
  };

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
    // Recompute the trigger boundaries from the CURRENT text + cursor, not
    // the snapshot stored when the async search resolved. Otherwise a fast
    // typist will lose the chars they typed after the search fired.
    const ta = taRef.current;
    const cursor = ta?.selectionStart ?? text.length;
    const fresh = detectTrigger(text, cursor);
    const start = fresh ? fresh.start : autocomplete.start;
    const end = fresh ? fresh.end : autocomplete.end;

    let token: string;
    if (autocomplete.kind === 'mention') {
      const m = autocomplete.members[idx]!;
      token = `@${m.displayName}`;
      mentionMap.current.set(m.displayName, m.id);
    } else {
      const e = emojiResults[idx]!;
      token = e.kind === 'custom' ? `:${e.name}:` : e.char;
    }
    const before = text.slice(0, start);
    const after = text.slice(end);
    const next = before + token + ' ' + after;
    setText(next);
    setAutocomplete(null);
    acRequestRef.current += 1; // invalidate any in-flight search
    requestAnimationFrame(() => {
      const target = taRef.current;
      if (!target) return;
      const pos = (before + token + ' ').length;
      target.focus();
      target.selectionStart = target.selectionEnd = pos;
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

  const resolveEmojiShortcuts = (raw: string): string => {
    if (guildEmojis.length === 0) return raw;
    return raw.replace(/:([A-Za-z0-9_]+):/g, (match, name: string) => {
      const e = guildEmojis.find(x => x.name === name);
      if (!e) return match;
      return `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
    });
  };

  const resolveMentionShortcuts = (raw: string): string => {
    if (mentionMap.current.size === 0) return raw;
    // Apply longest names first so `@John Smith` wins over `@John`.
    const names = Array.from(mentionMap.current.keys()).sort((a, b) => b.length - a.length);
    let out = raw;
    for (const name of names) {
      const id = mentionMap.current.get(name);
      if (!id) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`@${escaped}\\b`, 'g'), `<@${id}>`);
    }
    return out;
  };

  const send = async () => {
    if (!channelId) return;
    const content = resolveMentionShortcuts(resolveEmojiShortcuts(text.trim()));
    if (content.length === 0 && files.length === 0) return;
    setBusy(true);
    const sendOpts = replyTo ? { replyToMessageId: replyTo.messageId } : undefined;
    let res;
    if (files.length > 0) {
      const attachments = await Promise.all(files.map(async f => ({
        name: f.name,
        mimeType: f.type || 'application/octet-stream',
        bytes: new Uint8Array(await f.arrayBuffer()),
      })));
      res = await api.messages.sendWithAttachments(channelId, content, attachments, sendOpts);
    } else {
      res = await api.messages.send(channelId, content, sendOpts);
    }
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', `Send failed: ${res.error.message}`);
      return;
    }
    setText('');
    setFiles([]);
    mentionMap.current.clear();
    onCancelReply?.();
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete && acLength > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAutocomplete(s => s ? ({ ...s, selectedIdx: (s.selectedIdx + 1) % acLength }) : s); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAutocomplete(s => s ? ({ ...s, selectedIdx: (s.selectedIdx - 1 + acLength) % acLength }) : s); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyAutocomplete(autocomplete.selectedIdx); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setAutocomplete(null); return; }
    }
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      onCancelReply?.();
      return;
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

  // Highlight runs for the overlay div.
  const highlightFragments = buildHighlightFragments(text, mentionMap.current);

  const onTextScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.scrollTop = e.currentTarget.scrollTop;
    overlay.scrollLeft = e.currentTarget.scrollLeft;
  };

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
      {replyTo && (
        <div className="flex items-center justify-between text-xs text-fg-muted bg-bg-input rounded-t-lg px-3 py-1.5 -mb-1 border-b border-bg">
          <span>
            Replying to <span className="text-fg font-medium">{replyTo.authorDisplayName}</span>
          </span>
          <button
            onClick={onCancelReply}
            className="text-fg-dim hover:text-fg p-0.5"
            title="Cancel reply (Esc)"
          >
            <IconX size={14} stroke={2} />
          </button>
        </div>
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
              className="text-fg-muted hover:text-fg w-10 h-[46px] flex items-center justify-center disabled:opacity-40"
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
          <div className="relative flex-1 min-w-0">
            <div
              ref={overlayRef}
              aria-hidden
              className="absolute inset-0 py-3 text-[15px] leading-[22px] whitespace-pre-wrap break-words pointer-events-none overflow-hidden"
            >
              {highlightFragments.map((f, i) =>
                f.kind === 'mention'
                  ? <span key={i} className="bg-accent/30 text-[#8593ce]">{f.text}</span>
                  : <span key={i} className="text-fg">{f.text}</span>
              )}
              {/* trailing space so cursor at EOL has measurable height */}
              {'​'}
            </div>
            <textarea
              ref={taRef}
              value={text}
              onChange={onTextChange}
              onSelect={onTextSelect}
              onScroll={onTextScroll}
              onKeyDown={onKey}
              onBlur={() => setTimeout(() => setAutocomplete(null), 100)}
              disabled={offline || busy}
              placeholder={channelId ? 'Message…' : 'Select a channel'}
              rows={1}
              className="relative w-full bg-transparent placeholder:text-fg-dim text-[15px] leading-[22px] py-3 resize-none disabled:opacity-50 outline-none"
              style={{ color: 'transparent', caretColor: 'rgb(242,243,245)' }}
            />
          </div>
          <div className="relative shrink-0">
            <button
              onClick={() => setEmojiOpen(o => !o)}
              disabled={offline || busy}
              className="text-fg-muted hover:text-fg w-10 h-[46px] flex items-center justify-center disabled:opacity-40"
              title="Emoji"
            ><IconMoodSmile size={22} stroke={1.75} /></button>
            {emojiOpen && (
              <EmojiPicker
                guildEmojis={guildEmojis}
                onSelect={(token) => {
                  // Convert <:name:id> → :name: shorthand for the textarea; resolved on send.
                  const m = /^<a?:([A-Za-z0-9_]+):\d+>$/.exec(token);
                  insertAtCursor(m ? `:${m[1]}:` : token);
                }}
                onClose={() => setEmojiOpen(false)}
              />
            )}
          </div>
          {(text.trim().length > 0 || files.length > 0) && (
            <button
              onClick={send}
              disabled={offline || busy || !channelId}
              className="text-accent hover:text-accent-hover w-10 h-[46px] flex items-center justify-center disabled:opacity-40 shrink-0"
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

type HighlightFragment = { kind: 'text' | 'mention'; text: string };

function buildHighlightFragments(text: string, mentions: Map<string, string>): HighlightFragment[] {
  if (mentions.size === 0) return [{ kind: 'text', text }];
  // Match @ followed by any of the known names (longest first so 'John Smith' wins over 'John').
  const names = Array.from(mentions.keys()).sort((a, b) => b.length - a.length);
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(?:${escaped.join('|')})\\b`, 'g');
  const out: HighlightFragment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) out.push({ kind: 'text', text: text.slice(lastIndex, m.index) });
    out.push({ kind: 'mention', text: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) out.push({ kind: 'text', text: text.slice(lastIndex) });
  return out;
}

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
