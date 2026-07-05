/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./agent_swarm/web/static/index.html"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: '#161616' },
        border: '#262626',
        accent: { DEFAULT: '#6c5ce7', dim: '#5a4bd1' },
        green: '#00d26a',
        red: '#f93a3a',
      }
    }
  },
  plugins: [],
}
