import type { Config } from 'tailwindcss';

// Colors resolve to CSS variables in src/theme/tokens.css so a rebrand never touches components.
const token = (name: string) => `rgb(var(--hb-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: token('brand'),
          strong: token('brand-strong'),
          soft: token('brand-soft'),
        },
        accent: token('accent'),
        surface: {
          DEFAULT: token('surface'),
          muted: token('surface-muted'),
          sunken: token('surface-sunken'),
        },
        ink: {
          DEFAULT: token('ink'),
          muted: token('ink-muted'),
          subtle: token('ink-subtle'),
          inverse: token('ink-inverse'),
        },
        line: token('line'),
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        info: { DEFAULT: token('info'), soft: token('info-soft') },
      },
      fontFamily: {
        sans: ['var(--hb-font-sans)'],
        mono: ['var(--hb-font-mono)'],
      },
      borderRadius: {
        sm: 'var(--hb-radius-sm)',
        DEFAULT: 'var(--hb-radius)',
        lg: 'var(--hb-radius-lg)',
      },
      boxShadow: {
        card: 'var(--hb-shadow-card)',
      },
    },
  },
  plugins: [],
} satisfies Config;
