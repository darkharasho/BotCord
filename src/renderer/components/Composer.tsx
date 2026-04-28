import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useGuildEmojis } from '../lib/use-guild-emojis';
import { EmojiPicker } from './EmojiPicker';
import { AttachmentTray } from './AttachmentTray';
import { pushToast } from './Toaster';
import type { GatewayState } from '../../shared/domain';

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;

export function Composer({ channelId, guildId }: { channelId: string | null; guildId: string | null }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gateway, setGateway] = useState<GatewayState>({ status: 'connecting' });
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const guildEmojis = useGuildEmojis(emojiOpen ? guildId : null);

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
    input.onchange = () => {
      if (input.files) addFiles(Array.from(input.files));
    };
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
      className="border-t border-border bg-bg relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent flex items-center justify-center z-40 pointer-events-none">
          <span className="text-fg font-semibold">Drop to attach</span>
        </div>
      )}
      <AttachmentTray files={files} onRemove={(i) => setFiles(prev => prev.filter((_, idx) => idx !== i))} />
      {offline && (
        <div className="px-3 py-1 text-xs text-warn bg-warn/10">Bot is not connected — sending disabled.</div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <button
          onClick={onPick}
          disabled={offline || busy}
          className="text-fg-muted hover:text-fg p-2 disabled:opacity-40"
          title="Attach files"
        >📎</button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={offline || busy}
          placeholder={channelId ? 'Message…' : 'Select a channel'}
          rows={1}
          className="flex-1 bg-bg-sunken border border-border rounded px-3 py-2 text-sm resize-none disabled:opacity-50"
        />
        <div className="relative">
          <button
            onClick={() => setEmojiOpen(o => !o)}
            disabled={offline || busy}
            className="text-fg-muted hover:text-fg p-2 disabled:opacity-40"
            title="Emoji"
          >😀</button>
          {emojiOpen && (
            <EmojiPicker
              guildEmojis={guildEmojis}
              onSelect={(token) => { insertAtCursor(token); }}
              onClose={() => setEmojiOpen(false)}
            />
          )}
        </div>
        <button
          onClick={send}
          disabled={offline || busy || (text.trim().length === 0 && files.length === 0) || !channelId}
          className="px-3 py-2 bg-accent text-white rounded text-sm disabled:opacity-40 hover:bg-accent-hover"
        >Send</button>
      </div>
    </div>
  );
}
