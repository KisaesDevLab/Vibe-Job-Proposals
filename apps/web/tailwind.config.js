/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#161413',
        paper: '#f4f1ea',
        card: '#fbfaf6',
        line: '#d9d2c4',
        copper: { DEFAULT: '#c2622b', deep: '#9c4a1d', soft: '#f0d9c5' },
        amber: '#e0a020',
        muted: '#7d756a',
        green: { DEFAULT: '#3f7d4f', soft: '#dce8dc' },
        red: { DEFAULT: '#b23b2e', soft: '#f2dcd7' },
        blue: { DEFAULT: '#3a6079', soft: '#d9e4ea' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(22,20,19,.06),0 8px 24px rgba(22,20,19,.06)',
        lg: '0 2px 4px rgba(22,20,19,.08),0 18px 50px rgba(22,20,19,.14)',
      },
    },
  },
  plugins: [],
};
