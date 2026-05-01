import {
  IconUser,
  IconPlug,
  IconPalette,
  IconBell,
  IconHeadphones,
  IconSparkles,
  IconServer,
  IconInfoCircle,
  type Icon,
} from '@tabler/icons-react';

export type SectionId =
  | 'account'
  | 'connections'
  | 'appearance'
  | 'notifications'
  | 'voice'
  | 'autonomy'
  | 'servers'
  | 'about';

export type NavGroup = {
  label: string;
  items: { id: SectionId; label: string; icon: Icon }[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'User Settings',
    items: [
      { id: 'account', label: 'Account', icon: IconUser },
      { id: 'connections', label: 'Connections', icon: IconPlug },
    ],
  },
  {
    label: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance', icon: IconPalette },
      { id: 'notifications', label: 'Notifications', icon: IconBell },
      { id: 'voice', label: 'Voice & Video', icon: IconHeadphones },
      { id: 'autonomy', label: 'Autonomy', icon: IconSparkles },
      { id: 'servers', label: 'Servers', icon: IconServer },
      { id: 'about', label: 'About', icon: IconInfoCircle },
    ],
  },
];

export const DEFAULT_SECTION: SectionId = 'account';
