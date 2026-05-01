import { useEffect, useRef } from 'react';
import { api } from './api';

/**
 * Surface inbound DMs as OS notifications, with sensible suppression rules.
 *
 * - Suppressed entirely when `enabled` is false (user toggle in Settings).
 * - Suppressed when the DM is the active view AND the window is focused —
 *   the user is already looking at the message, so the OS toast is noise.
 * - Guild messages are always ignored here; this hook is DM-only.
 *
 * Clicking the notification calls `onClickGotoDM(channelId)` so the shell
 * can route to Home + select the DM. Refs are used to avoid re-subscribing
 * to the gateway every time a focus/active-channel state flips.
 */
export function useDMNotifications({
  enabled,
  isWindowFocused,
  isHomeViewActive,
  activeDMChannelId,
  onClickGotoDM,
}: {
  enabled: boolean;
  isWindowFocused: boolean;
  isHomeViewActive: boolean;
  activeDMChannelId: string | null;
  onClickGotoDM: (channelId: string) => void;
}) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const focusedRef = useRef(isWindowFocused);
  focusedRef.current = isWindowFocused;
  const homeRef = useRef(isHomeViewActive);
  homeRef.current = isHomeViewActive;
  const activeRef = useRef(activeDMChannelId);
  activeRef.current = activeDMChannelId;
  const onClickRef = useRef(onClickGotoDM);
  onClickRef.current = onClickGotoDM;

  useEffect(() => {
    return api.events.onMessageCreate(({ channelId, message }) => {
      if (!enabledRef.current) return;
      if (message.guildId) return;
      if (focusedRef.current && homeRef.current && activeRef.current === channelId) return;
      const title = message.authorDisplayName ?? message.authorTag;
      const body = message.content?.trim()
        ? message.content.slice(0, 200)
        : (message.hasAttachments ? '[attachment]' : message.hasEmbeds ? '[embed]' : '');
      try {
        const n = new Notification(title, {
          body,
          ...(message.authorAvatarUrl ? { icon: message.authorAvatarUrl } : {}),
        });
        n.onclick = () => { onClickRef.current(channelId); };
      } catch {
        /* notifications unavailable */
      }
    });
  }, []);
}
