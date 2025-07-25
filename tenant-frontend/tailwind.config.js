/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}", // <-- 确保这行存在且正确
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}