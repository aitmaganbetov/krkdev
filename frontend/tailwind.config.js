/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#eef5ff',
          100: '#d9e8ff',
          200: '#b9d4f7',
          300: '#8fb9e9',
          400: '#6298d3',
          500: '#3f78b4',
          600: '#285f99',
          700: '#1c4778',
          800: '#173c66',
          900: '#123254',
        },
      },
    },
  },
  plugins: [],
}
