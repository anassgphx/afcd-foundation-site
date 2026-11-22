/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.html', './assets/main.js', './studio/src/server/modules/pages/blocks.ts'],  // Studio page-builder blocks
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
      colors: {
        ink: { DEFAULT: '#0B0B0B', pure: '#000000', charcoal: '#171717', dark: '#404040', mid: '#737373', light: '#D4D4D4', faint: '#F5F5F5', off: '#FAFAFA' },
      },
      maxWidth: { site: '1600px' },
      letterSpacing: { tightest: '-0.045em', label: '0.14em' },
    },
  },
  plugins: [],
};
