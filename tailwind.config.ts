import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#1a1a1e', subtle: '#242429', sunken: '#121214', input: '#222327' },
        fg: { DEFAULT: '#f2f3f5', muted: '#b5bac1', dim: '#80848e' },
        accent: { DEFAULT: '#5865f2', hover: '#4752c4' },
        danger: '#f23f43',
        warn: '#f0b232',
        ok: '#23a559',
        border: '#0e0e10',
        hover: '#26262b',
        selected: '#2e2e34',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
