/** @type {import('tailwindcss').Config} */

// Все значения берутся из CSS-переменных src/styles/tokens.css (светлая и тёмная темы).
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

// Фирменная шкала navy (#12304F = 700). Нужна страницам, которые ещё используют
// числовые оттенки primary-*/blue-*; новые компоненты используют семантические токены ниже.
const brandNavy = {
  50:  '#eef4f8',
  100: '#dbe9f3',
  200: '#b8d1e4',
  300: '#8fb6d4',
  400: '#5e93bd',
  500: '#356f9b',
  600: '#1f5079',
  700: '#12304f',
  800: '#0e2741',
  900: '#0a1d31',
  950: '#06121f',
}

const status = (name) => ({
  DEFAULT: token(name),
  subtle: token(`${name}-subtle`),
  solid: token(`${name}-solid`),
  on: token(`${name}-on`),
})

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    // Шкала из 7 размеров; line-height основного текста ≥ 1.4.
    fontSize: {
      xs:   ['0.75rem',  { lineHeight: '1.125rem' }],  // 12 / 18
      sm:   ['0.875rem', { lineHeight: '1.25rem' }],   // 14 / 20 — основной текст интерфейса
      base: ['1rem',     { lineHeight: '1.5rem' }],    // 16 / 24
      lg:   ['1.125rem', { lineHeight: '1.625rem' }],  // 18 / 26
      xl:   ['1.25rem',  { lineHeight: '1.75rem' }],   // 20 / 28 — заголовки карточек
      '2xl': ['1.5rem',  { lineHeight: '2rem' }],      // 24 / 32 — заголовок страницы
      '3xl': ['1.875rem', { lineHeight: '2.375rem' }], // 30 / 38 — значения KPI
      // Совместимость со старыми страницами до миграции (не использовать в новом коде)
      '4xl': ['1.875rem', { lineHeight: '2.375rem' }],
      '5xl': ['1.875rem', { lineHeight: '2.375rem' }],
    },
    extend: {
      fontFamily: {
        sans: ['"Google Sans"', 'ui-sans-serif', 'system-ui', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        display: ['"Google Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        canvas: token('canvas'),
        surface: {
          DEFAULT: token('surface'),
          muted: token('surface-muted'),
          hover: token('surface-hover'),
          raised: token('surface-raised'),
        },
        line: {
          DEFAULT: token('border'),
          strong: token('border-strong'),
        },
        fg: {
          DEFAULT: token('fg'),
          muted: token('fg-muted'),
          subtle: token('fg-subtle'),
          inverse: token('fg-inverse'),
        },
        primary: {
          ...brandNavy,
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          on: token('primary-on'),
          subtle: token('primary-subtle'),
          'subtle-fg': token('primary-subtle-fg'),
        },
        accent: {
          DEFAULT: token('accent'),
          subtle: token('accent-subtle'),
        },
        brand: {
          navy: token('brand-navy'),
          teal: token('brand-teal'),
          gold: token('brand-gold'),
        },
        'on-brand': token('on-brand'),
        success: status('success'),
        warning: status('warning'),
        danger: status('danger'),
        info: status('info'),
        neutral: status('neutral'),
        focus: token('focus'),
        chart: {
          1: token('chart-1'), 2: token('chart-2'), 3: token('chart-3'),
          4: token('chart-4'), 5: token('chart-5'), 6: token('chart-6'),
        },
        blue: brandNavy,
      },
      borderColor: {
        DEFAULT: token('border'),
      },
      // Радиусы: sm — чипы/чекбоксы, md — кнопки и поля, lg — карточки, xl — модалки
      borderRadius: {
        sm: '0.25rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
      },
      zIndex: {
        base: 'var(--z-base)',
        sticky: 'var(--z-sticky)',
        header: 'var(--z-header)',
        sidebar: 'var(--z-sidebar)',
        overlay: 'var(--z-overlay)',
        drawer: 'var(--z-drawer)',
        modal: 'var(--z-modal)',
        popover: 'var(--z-popover)',
        toast: 'var(--z-toast)',
        tooltip: 'var(--z-tooltip)',
        skiplink: 'var(--z-skiplink)',
      },
      spacing: {
        header: 'var(--header-h)',
        sidebar: 'var(--sidebar-w)',
        'sidebar-collapsed': 'var(--sidebar-w-collapsed)',
      },
      ringColor: {
        DEFAULT: token('focus'),
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 160ms ease-out',
        'slide-in-left': 'slide-in-left 200ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
}
