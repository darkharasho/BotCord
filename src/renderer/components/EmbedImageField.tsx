import { IconX } from '@tabler/icons-react';

const inputBase =
  'w-full bg-bg-input border border-white/[0.06] rounded-md px-3 py-2 text-[14px] text-fg ' +
  'placeholder:text-fg-dim outline-none transition-colors duration-150 focus:border-accent';
const labelCls = 'block text-[12px] font-semibold text-fg-muted mb-1.5 uppercase tracking-wide';

// One embed image field, switchable between a URL input and a local-file upload
// with a thumbnail preview. Stateless: the parent owns mode/url/upload.
export function EmbedImageField({
  label, slotKey, mode, url, upload, onModeChange, onUrlChange, onPickFile, onClear,
}: {
  label: string;
  slotKey: string;
  mode: 'url' | 'file';
  url: string;
  upload: { previewUrl: string; name: string } | null;
  onModeChange: (m: 'url' | 'file') => void;
  onUrlChange: (v: string) => void;
  onPickFile: (file: File) => void;
  onClear: () => void;
}) {
  const tab = (m: 'url' | 'file', text: string, ariaLabel: string) => (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => onModeChange(m)}
      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
        mode === m ? 'bg-accent/20 text-accent' : 'text-fg-dim hover:text-fg-muted'
      }`}
    >{text}</button>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className={labelCls}>{label}</label>
        <div className="flex items-center gap-1">
          {tab('url', 'URL', `URL ${label.toLowerCase()}`)}
          {tab('file', 'Upload', `Upload ${label.toLowerCase()}`)}
        </div>
      </div>

      {mode === 'url' ? (
        <input className={inputBase} value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="https://…" />
      ) : upload ? (
        <div className="flex items-center gap-2 bg-bg-input border border-white/[0.06] rounded-md px-2 py-1.5">
          <img src={upload.previewUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
          <span className="text-[12px] text-fg-muted truncate flex-1">{upload.name}</span>
          <button type="button" onClick={onClear} title="Remove image" className="text-fg-muted hover:text-danger p-1 shrink-0">
            <IconX size={14} stroke={2} />
          </button>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-2 bg-bg-input border border-dashed border-white/[0.12] rounded-md px-3 py-2.5 text-[13px] text-fg-muted hover:text-fg hover:border-white/[0.25] cursor-pointer transition-colors">
          Choose image…
          <input
            data-testid={`file-input-${slotKey}`}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ''; }}
          />
        </label>
      )}
    </div>
  );
}
