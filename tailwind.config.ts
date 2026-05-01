import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#1a1a1e', subtle: '#242429', sunken: '#121214', input: '#222327' },
        fg: { DEFAULT: '#f2f3f5', muted: '#b5bac1', dim: '#80848e' },
        accent: { DEFAULT: '#007f68', hover: '#00a085' },
        link: '#7da9d6',
        danger: '#f23f43',
        warn: '#f0b232',
        ok: '#23a559',
        border: '#0e0e10',
        hover: '#26262b',
        selected: '#2e2e34',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'fade-in':       { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-in-up':    { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in-down':  { '0%': { opacity: '0', transform: 'translateY(-6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pop-in':        { '0%': { opacity: '0', transform: 'scale(0.96)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'lightbox-in':   { '0%': { opacity: '0', transform: 'scale(0.985)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'shimmer':       { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        'skeleton-pulse':{ '0%, 100%': { opacity: '0.55' }, '50%': { opacity: '1' } },
      },
      animation: {
        'fade-in':         'fade-in 140ms ease-out both',
        'fade-in-up':      'fade-in-up 160ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in-down':    'fade-in-down 160ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'pop-in':          'pop-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'lightbox-in':     'lightbox-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'shimmer':         'shimmer 1.6s linear infinite',
        'skeleton-pulse':  'skeleton-pulse 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
