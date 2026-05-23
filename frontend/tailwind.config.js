// tailwind.config.js
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        scope: {
          bg: '#F8FAFC',           // background_main
          surface: '#FFFFFF',      // background_surface
          textPrimary: '#1E293B',  // text_primary
          textSecondary: '#64748B',// text_secondary
          accent: '#06B6D4',       // accent_telemetry (Cyan/Teal)
          online: '#10B981',       // status_online
          offline: '#F43F5E',      // status_offline
          warning: '#F59E0B'       // status_warning
        }
      }
    },
  },
  plugins: [],
}