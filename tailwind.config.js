/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        background: '#09090b',
        foreground: '#e4e4e7',
        'muted-foreground': '#a1a1aa',
        primary: {
          DEFAULT: '#fafafa',
          foreground: '#09090b',
        },
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(0, 0, 0, 0.35)',
      },
      keyframes: {
        'menu-show': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(-4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'menu-hide': {
          from: { opacity: '1', transform: 'scale(1) translateY(0)' },
          to: { opacity: '0', transform: 'scale(0.96) translateY(-4px)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'zoom-in-95': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'menu-show': 'menu-show 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'menu-hide': 'menu-hide 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-in': 'fade-in 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'zoom-in-95': 'zoom-in-95 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
    },
  },
  plugins: [],
};

