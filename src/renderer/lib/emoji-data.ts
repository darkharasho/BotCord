import dataByGroup from 'unicode-emoji-json/data-by-group.json';

export type StandardEmoji = { char: string; name: string; category: string; keywords: string };

// Friendly labels for the Unicode CLDR group names. Order here is the order
// emoji are shown in the picker.
const GROUP_LABEL: Record<string, string> = {
  'Smileys & Emotion': 'Smileys',
  'People & Body':     'People',
  'Animals & Nature':  'Animals',
  'Food & Drink':      'Food',
  'Travel & Places':   'Travel',
  'Activities':        'Activities',
  'Objects':           'Objects',
  'Symbols':           'Symbols',
  'Flags':             'Flags',
};

type RawGroup = { name: string; slug: string; emojis: { emoji: string; name: string; slug: string }[] };

const orderedLabels: string[] = [];
const flat: StandardEmoji[] = [];

for (const group of dataByGroup as RawGroup[]) {
  const label = GROUP_LABEL[group.name] ?? group.name;
  if (!orderedLabels.includes(label)) orderedLabels.push(label);
  for (const e of group.emojis) {
    flat.push({
      char: e.emoji,
      name: e.slug,
      category: label,
      // Use both human-readable name (e.g. "grinning face") and slug (e.g.
      // "grinning_face") as keywords so search hits common phrasings.
      keywords: `${e.name} ${e.slug.replace(/_/g, ' ')}`.toLowerCase(),
    });
  }
}

export const STANDARD_EMOJI: StandardEmoji[] = flat;
export const EMOJI_CATEGORIES: readonly string[] = orderedLabels;
