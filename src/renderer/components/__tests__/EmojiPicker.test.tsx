import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EmojiPicker } from '../EmojiPicker';

describe('EmojiPicker', () => {
  afterEach(() => cleanup());

  const guildEmojis = [
    { id: '111', name: 'fire', animated: false, guildId: 'g1', url: 'https://cdn.discordapp.com/emojis/111.png' },
    { id: '222', name: 'dance', animated: true, guildId: 'g1', url: 'https://cdn.discordapp.com/emojis/222.gif' },
  ];

  it('renders Server tab when guild emojis present and emits the discord token format', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker guildEmojis={guildEmojis} onSelect={onSelect} onClose={() => {}} />);
    const fireButtons = screen.getAllByTitle(':fire:');
    fireEvent.click(fireButtons[0]!);
    expect(onSelect).toHaveBeenCalledWith('<:fire:111>');
  });

  it('emits animated token for animated custom emoji', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker guildEmojis={guildEmojis} onSelect={onSelect} onClose={() => {}} />);
    const danceButtons = screen.getAllByTitle(':dance:');
    fireEvent.click(danceButtons[0]!);
    expect(onSelect).toHaveBeenCalledWith('<a:dance:222>');
  });

  it('Standard tab emits unicode characters', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker guildEmojis={[]} onSelect={onSelect} onClose={() => {}} />);
    const fireButtons = screen.getAllByTitle(':fire:');
    fireEvent.click(fireButtons[0]!);
    expect(onSelect).toHaveBeenCalledWith('🔥');
  });

  it('search filters by name', () => {
    render(<EmojiPicker guildEmojis={[]} onSelect={() => {}} onClose={() => {}} />);
    const search = screen.getByPlaceholderText('Search…');
    fireEvent.change(search, { target: { value: 'pizza' } });
    expect(screen.getByTitle(':pizza:')).toBeTruthy();
    expect(screen.queryByTitle(':grin:')).toBeNull();
  });
});
