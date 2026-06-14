module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // SCOPE design system — matches SCOPE's actual Tailwind utility usage
        // Primary brand: blue-900 (#1e3a5f) / blue-800 / blue-600
        // Surfaces: slate-* scale
        // Semantic: emerald = success, red = danger, amber = warning, indigo = secondary
        brand: {
          primary:   '#1e3a8a',  // blue-900 — CTAs, borders, active states
          primaryHover: '#1e40af', // blue-800 — hover on primary
          primaryMid:   '#2563eb', // blue-600 — links, secondary accents
          surface:   '#eff6ff',  // blue-50  — tinted backgrounds
          surfaceMid:'#dbeafe',  // blue-100 — stronger tint
        },
        status: {
          online:  '#10B981',  // emerald-500
          offline: '#F43F5E',  // rose-500
          warning: '#F59E0B',  // amber-500
          missed:  '#ef4444',  // red-500
        },
        ui: {
          bg:            '#F8FAFC',  // slate-50 — page background
          surface:       '#FFFFFF',  // white — card surface
          textPrimary:   '#1E293B',  // slate-900
          textSecondary: '#64748B',  // slate-500
          border:        '#e2e8f0',  // slate-200
        }
      }
    },
  },
  plugins: [],
  // Note: install tailwindcss-animate and add require('tailwindcss-animate')
  // to plugins[] to activate animate-in/fade-in/zoom-in classes currently
  // referenced across the codebase but non-functional.
}