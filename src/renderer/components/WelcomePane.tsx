import { IconHash, IconMessage, IconMouse, IconServer2 } from '@tabler/icons-react';

export function WelcomePane({ hasGuild }: { hasGuild: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 animate-fade-in select-none">
      <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-5">
        {hasGuild
          ? <IconHash size={32} stroke={1.5} className="text-accent" />
          : <IconServer2 size={32} stroke={1.5} className="text-accent" />}
      </div>

      <h2 className="text-fg text-lg font-semibold mb-1">
        {hasGuild ? 'No channel selected' : 'Welcome to BotCord'}
      </h2>

      <p className="text-fg-muted text-sm max-w-[320px] leading-relaxed mb-8">
        {hasGuild
          ? 'Pick a channel from the sidebar to view messages, compose embeds, and manage your server.'
          : 'Select a server from the rail to get started, then choose a channel to begin.'}
      </p>

      <div className="flex flex-col gap-3 text-left">
        {hasGuild ? (
          <>
            <Hint icon={IconMouse} text="Click a channel in the sidebar" />
            <Hint icon={IconMessage} text="Send messages and embeds as your bot" />
          </>
        ) : (
          <>
            <Hint icon={IconServer2} text="Choose a server your bot has joined" />
            <Hint icon={IconHash} text="Browse channels and message history" />
            <Hint icon={IconMessage} text="Compose and send as your bot" />
          </>
        )}
      </div>
    </div>
  );
}

function Hint({ icon: Icon, text }: { icon: typeof IconHash; text: string }) {
  return (
    <div className="flex items-center gap-3 text-fg-dim text-[13px]">
      <Icon size={18} stroke={1.5} className="text-fg-dim/70 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
