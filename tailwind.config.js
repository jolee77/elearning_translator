/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#162B52',
          50: '#E8ECF2',
          100: '#C5D0E0',
          200: '#9FB0CC',
          300: '#7890B8',
          400: '#5A78A9',
          500: '#3D609B',
          600: '#2E4F7F',
          700: '#243F66',
          800: '#1C3252',
          900: '#162B52',
        },
        accent: {
          DEFAULT: '#4B40E0',
          50: '#EEEDFC',
          100: '#D5D2F8',
          200: '#ABA5F1',
          300: '#8178EA',
          400: '#665CE4',
          500: '#4B40E0',
          600: '#3B32B3',
          700: '#2C2586',
          800: '#1D1959',
          900: '#0E0C2C',
        },
      },
    },
  },
  plugins: [],
}
