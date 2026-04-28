import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#313338', subtle: '#2b2d31', sunken: '#1e1f22', input: '#383a40' },
        fg: { DEFAULT: '#f2f3f5', muted: '#b5bac1', dim: '#80848e' },
        accent: { DEFAULT: '#5865f2', hover: '#4752c4' },
        danger: '#f23f43',
        warn: '#f0b232',
        ok: '#23a559',
        border: '#1e1f22',
        hover: '#35373c',
        selected: '#404249',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
