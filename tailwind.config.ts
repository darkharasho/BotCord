import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#1a1b1f', subtle: '#23252b', sunken: '#141519' },
        fg: { DEFAULT: '#e7e8ea', muted: '#9aa0a6' },
        accent: { DEFAULT: '#7c5cff', hover: '#8e72ff' },
        danger: '#e5484d',
        warn: '#f5a524',
        ok: '#3dd68c',
        border: '#2c2e36',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
