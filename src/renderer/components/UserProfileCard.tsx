import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import type { MemberDetail, PresenceStatus } from '../../shared/domain';

const STATUS_COLOR: Record<PresenceStatus, string> = {
  online: 'bg-ok',
  idle: 'bg-warn',
  dnd: 'bg-danger',
  offline: 'bg-fg-dim',
};

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Card width — matches Discord's ~340px profile popup.
const CARD_W = 340;
const CARD_MAX_H = 480;

export function UserProfileCard({
  guildId,
  userId,
  anchorRect,
  onClose,
}: {
  guildId: string;
  userId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [error, setError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api.guilds.getMember(guildId, userId).then(res => {
      if (!active) return;
      if (res.ok) setMember(res.data);
      else setError(true);
    });
    return () => { active = false; };
  }, [guildId, userId]);

  // Click-outside dismiss + Escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer so the click that opened us doesn't immediately close.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Position: prefer right of the avatar, fall back left if no room.
  // Vertically center on the anchor, clamp to viewport.
  const style = (() => {
    const gap = 12;
    let left = anchorRect.right + gap;
    if (left + CARD_W > window.innerWidth - 16) {
      left = anchorRect.left - CARD_W - gap;
    }
    let top = anchorRect.top - 40; // offset up a bit so banner aligns
    if (top + CARD_MAX_H > window.innerHeight - 16) {
      top = window.innerHeight - CARD_MAX_H - 16;
    }
    if (top < 16) top = 16;
    return { left, top };
  })();

  return createPortal(
    <div
      ref={rootRef}
      className="fixed z-50 animate-pop-in"
      style={{ left: style.left, top: style.top, width: CARD_W }}
    >
      <div className="bg-bg-subtle rounded-lg border border-white/[0.08] shadow-2xl overflow-hidden">
        {/* Banner area */}
        <div
          className="h-[60px] relative"
          style={{ backgroundColor: member?.bannerColor ?? '#007f68' }}
        />

        {/* Avatar overlapping banner */}
        <div className="relative px-4">
          <div className="absolute -top-[38px] left-4">
            <div className="relative">
              <Avatar
                src={member?.avatarUrl}
                alt=""
                className="w-[76px] h-[76px] rounded-full ring-[5px] ring-bg-subtle"
                fallback={
                  <div className="w-[76px] h-[76px] rounded-full ring-[5px] ring-bg-subtle bg-bg-input flex items-center justify-center text-xl font-semibold text-fg">
                    {member?.displayName?.slice(0, 2).toUpperCase() ?? '?'}
                  </div>
                }
              />
              {member && (
                member.status === 'idle' ? (
                  <svg aria-hidden className="absolute bottom-0 right-0 w-[20px] h-[20px]" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="10" className="fill-bg-subtle" />
                    <mask id="profile-idle-mask">
                      <rect width="20" height="20" fill="white" />
                      <circle cx="7" cy="6.5" r="5" fill="black" />
                    </mask>
                    <circle cx="10" cy="10" r="7" className="fill-warn" mask="url(#profile-idle-mask)" />
                  </svg>
                ) : (
                  <span
                    className={`absolute bottom-0 right-0 w-[18px] h-[18px] rounded-full ${STATUS_COLOR[member.status]} ring-[3px] ring-bg-subtle`}
                    title={STATUS_LABEL[member.status]}
                  />
                )
              )}
            </div>
          </div>

          {member?.isBot && (
            <div className="flex justify-end pt-2">
              <span className="bg-accent text-white text-[10px] font-semibold uppercase px-1.5 py-[1px] rounded">Bot</span>
            </div>
          )}
          {!member?.isBot && <div className="h-[14px]" />}
        </div>

        {/* Body */}
        <div className="px-4 pt-6 pb-4">
          {!member && !error && (
            <div className="space-y-2 animate-pulse">
              <div className="h-5 w-32 bg-white/10 rounded" />
              <div className="h-3 w-24 bg-white/10 rounded" />
            </div>
          )}
          {error && (
            <div className="text-fg-dim text-sm">Could not load profile</div>
          )}
          {member && (
            <div className="space-y-3">
              {/* Name */}
              <div>
                <div
                  className="text-[18px] font-semibold leading-tight"
                  style={member.roleColor ? { color: member.roleColor } : undefined}
                >
                  {member.displayName}
                </div>
                <div className="text-[13px] text-fg-muted">{member.username}</div>
              </div>

              {!member.isBot && (
                <button
                  type="button"
                  className="w-full bg-accent hover:bg-accent-hover text-white text-sm font-medium py-1.5 rounded transition-colors"
                  onClick={async () => {
                    const res = await api.dms.openWithUser(userId);
                    if (!res.ok) {
                      console.warn('[UserProfileCard] openWithUser failed', res.error);
                      return;
                    }
                    window.dispatchEvent(new CustomEvent('botcord:open-dm', { detail: { channelId: res.data.channelId } }));
                    onClose();
                  }}
                >
                  Message
                </button>
              )}

              <div className="border-t border-white/[0.08]" />

              {/* Dates */}
              <div className="space-y-2">
                {member.joinedAt && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted mb-0.5">Member Since</div>
                    <div className="text-[13px] text-fg-muted">{formatDate(member.joinedAt)}</div>
                  </div>
                )}
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted mb-0.5">Discord Member Since</div>
                  <div className="text-[13px] text-fg-muted">{formatDate(member.createdAt)}</div>
                </div>
              </div>

              {/* Roles */}
              {member.roles.length > 0 && (
                <>
                  <div className="border-t border-white/[0.08]" />
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted mb-1.5">
                      Roles — {member.roles.length}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {member.roles.map(r => (
                        <span
                          key={r.id}
                          className="inline-flex items-center gap-1 bg-bg/60 border border-white/[0.08] rounded px-1.5 py-[1px] text-[12px] text-fg-muted"
                        >
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: r.color ?? '#99aab5' }}
                          />
                          {r.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
