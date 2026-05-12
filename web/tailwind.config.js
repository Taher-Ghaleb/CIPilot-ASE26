/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#4f7cff',
          600: '#2d5cff',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        success: {
          light: '#1a7f37',
          dark: '#32d583',
        },
        danger: {
          light: '#cf222e',
          dark: '#ff5a6a',
        },
        warning: {
          light: '#bf8700',
          dark: '#f59e0b',
        },
      },
      backgroundColor: {
        glass: {
          light: 'rgba(255, 255, 255, 0.6)',
          dark: 'rgba(255, 255, 255, 0.04)',
        }
      },
      backdropBlur: {
        glass: '12px',
      },
      borderRadius: {
        'glass': '16px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
