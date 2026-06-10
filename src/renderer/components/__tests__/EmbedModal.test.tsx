// src/renderer/components/__tests__/EmbedModal.test.tsx
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmbedModal } from '../EmbedModal';

beforeAll(() => {
  // jsdom lacks object-URL APIs used by the image preview.
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
  // jsdom's File doesn't implement arrayBuffer(); provide a working shim.
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function () {
      return new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});

vi.mock('../../lib/api', () => ({
  api: {
    messages: {
      sendEmbed: vi.fn(async () => ({ ok: true, data: { id: 'm1' } })),
      editEmbed: vi.fn(async () => ({ ok: true, data: { id: 'm1' } })),
    },
    drafts: {
      list: vi.fn(async () => ({ ok: true, data: [] })),
      upsert: vi.fn(async () => ({ ok: true, data: {} })),
    },
  },
}));

// EmbedCard pulls in markdown/lightbox; stub it to a marker for these tests.
vi.mock('../EmbedCard', () => ({
  EmbedCard: ({ embed }: { embed: { title: string | null } }) => <div data-testid="preview">{embed.title}</div>,
}));

describe('<EmbedModal> create mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables Send until the embed is non-empty', () => {
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Embed title'), { target: { value: 'Hello' } });
    expect(send).toBeEnabled();
  });

  it('reflects the title in the live preview', () => {
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Embed title'), { target: { value: 'Hi there' } });
    expect(screen.getByTestId('preview')).toHaveTextContent('Hi there');
  });

  it('sends the built payload and closes on success', async () => {
    const onClose = vi.fn();
    const { api } = await import('../../lib/api');
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Embed title'), { target: { value: 'T' } });
    fireEvent.change(screen.getByPlaceholderText('Optional message text sent above the embed'), { target: { value: 'ping' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.messages.sendEmbed).toHaveBeenCalled());
    const call = (api.messages.sendEmbed as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('c1');
    expect(call[1]).toMatchObject({ title: 'T' });
    expect(call[2]).toBe('ping');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('adds and removes a field row', () => {
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add field/i }));
    expect(screen.getByPlaceholderText('Field name')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Remove field'));
    expect(screen.queryByPlaceholderText('Field name')).not.toBeInTheDocument();
  });

  it('loads an embed draft into the form', async () => {
    const { api } = await import('../../lib/api');
    (api.drafts.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 'd1', name: 'Promo', guildId: 'g1', channelId: 'c1', content: 'hey', embed: { title: 'Promo Title' }, createdAt: 1, updatedAt: 1 }],
    });
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    await waitFor(() => screen.getByRole('option', { name: 'Promo' }));
    fireEvent.change(screen.getByLabelText('Load draft'), { target: { value: 'd1' } });
    expect((screen.getByPlaceholderText('Embed title') as HTMLInputElement).value).toBe('Promo Title');
  });

  it('uploads a local image: sends attachment:// url + the file', async () => {
    const { api } = await import('../../lib/api');
    render(<EmbedModal channelId="c1" guildId="g1" channelName="general" onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Embed title'), { target: { value: 'T' } });
    // Switch the Image slot to Upload mode.
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    // Pick a file via the slot's hidden input.
    const input = screen.getByTestId('file-input-image') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => screen.getByText('image.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.messages.sendEmbed).toHaveBeenCalled());
    const call = (api.messages.sendEmbed as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1].image).toEqual({ url: 'attachment://image.png' });
    const atts = call[3];
    expect(atts).toHaveLength(1);
    expect(atts[0].name).toBe('image.png');
    expect(atts[0].bytes).toBeInstanceOf(Uint8Array);
  });
});
