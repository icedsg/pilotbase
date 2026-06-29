/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--color-surface)',
          '50':  'var(--color-surface-50)',
          '100': 'var(--color-surface-100)',
          '200': 'var(--color-surface-200)',
          '300': 'var(--color-surface-300)',
        },
        accent: {
          DEFAULT: '#4f8ef7',
          hover:   '#6ba3f8',
          muted:   '#2d5fa8',
        },
      },
      fontFamily: {
        logo: ['"Cormorant Garamond"', 'Lora', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
