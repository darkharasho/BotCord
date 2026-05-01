import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SettingsOverlay } from '../SettingsOverlay';

vi.mock('../../../lib/api', () => ({
  api: {
    bot: { getStatus: vi.fn().mockResolvedValue({ kind: 'unconfigured' }), clearToken: vi.fn(), buildInviteUrl: vi.fn() },
    prefs: { get: vi.fn().mockResolvedValue({ ok: true, data: true }), set: vi.fn() },
    guilds: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }), listChannels: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    autonomy: { detect: vi.fn().mockResolvedValue({ found: true }), getGlobalConfig: vi.fn().mockResolvedValue({ ok: true, data: null }), getGuildConfig: vi.fn(), setGuildConfig: vi.fn(), setGlobalConfig: vi.fn() },
    system: { appVersion: vi.fn().mockResolvedValue('0.3.7'), openExternal: vi.fn() },
    events: {
      onBotStatus: () => () => {},
      onGatewayState: () => () => {},
      onGuildUpdate: () => () => {},
      onGlobalAutonomy: () => () => {},
    },
  },
}));

vi.mock('../../GlobalAutonomySettings', () => ({
  GlobalAutonomySettings: () => <div>global-autonomy-stub</div>,
}));

const renderOverlay = (onClose = vi.fn()) =>
  render(<MemoryRouter><SettingsOverlay onClose={onClose} /></MemoryRouter>);

describe('SettingsOverlay', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders Account by default', async () => {
    renderOverlay();
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('switches sections when sidebar items are clicked', async () => {
    renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(await screen.findByRole('heading', { name: 'About' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(await screen.findByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
  });

  it('closes on Esc keypress', () => {
    const onClose = vi.fn();
    renderOverlay(onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when X button is clicked', () => {
    const onClose = vi.fn();
    renderOverlay(onClose);
    fireEvent.click(screen.getByLabelText('Close settings'));
    expect(onClose).toHaveBeenCalled();
  });
});
