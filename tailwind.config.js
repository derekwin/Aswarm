/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./agent_swarm/web/static/index.html"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: 'var(--surface)' },
        'bg': 'var(--bg)',
        'bg-deeper': 'var(--bg-deeper)',
        border: 'var(--border)',
        accent: { DEFAULT: 'var(--accent)' },
        green: 'var(--green)',
        red: 'var(--red)',
      }
    }
  },
  plugins: [],
}
