/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          // фон сторінки
          bg: '#0D0F12',
          // поверхні (картки, панелі)
          surface: '#171A20',
          // трохи світліша поверхня (hover, другорядні елементи)
          raised: '#1E2330',
          // бордери
          line: '#2A2F3B',
          // основний текст
          text: '#F2F4F8',
          // вторинний текст
          muted: '#9CA4B2',
          // акцент
          accent: '#6C8CFF',
          'accent-strong': '#7E9BFF',
          danger: '#F87171',
          success: '#4ADE80',
          warn: '#FBBF24',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
};
