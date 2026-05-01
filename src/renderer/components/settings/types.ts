// src/renderer/components/settings/types.ts
export type SectionId =
  | 'account'
  | 'connections'
  | 'appearance'
  | 'notifications'
  | 'autonomy'
  | 'servers'
  | 'about';

export type NavGroup = {
  label: string;
  items: { id: SectionId; label: string }[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'User Settings',
    items: [
      { id: 'account', label: 'Account' },
      { id: 'connections', label: 'Connections' },
    ],
  },
  {
    label: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance' },
      { id: 'notifications', label: 'Notifications' },
      { id: 'autonomy', label: 'Autonomy' },
      { id: 'servers', label: 'Servers' },
      { id: 'about', label: 'About' },
    ],
  },
];

export const DEFAULT_SECTION: SectionId = 'account';
