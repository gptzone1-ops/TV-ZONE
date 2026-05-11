/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        netflix: "#E50914",
        ink: "#161616",
      },
      fontFamily: {
        sans: [
          "Cairo",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 10px 28px rgba(15, 23, 42, 0.06)",
        premium: "0 18px 55px rgba(15, 23, 42, 0.08)",
        "premium-lg": "0 26px 80px rgba(15, 23, 42, 0.12)",
        red: "0 16px 36px rgba(229, 9, 20, 0.22)",
        "red-soft": "0 10px 24px rgba(229, 9, 20, 0.14)",
        shahid: "0 16px 36px rgba(6, 182, 212, 0.22)",
        "video-glow": "0 24px 80px rgba(15, 23, 42, 0.10), 0 0 0 1px rgba(229, 9, 20, 0.10), 0 0 36px rgba(229, 9, 20, 0.16)",
      },
      height: {
        13: "3.25rem",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(12px) scale(0.985)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "whatsapp-pulse": {
          "0%, 100%": { transform: "scale(1)", boxShadow: "0 16px 36px rgba(229, 9, 20, 0.22)" },
          "50%": { transform: "scale(1.045)", boxShadow: "0 20px 44px rgba(229, 9, 20, 0.32)" },
        },
      },
      animation: {
        rise: "rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "whatsapp-pulse": "whatsapp-pulse 2.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
