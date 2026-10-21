import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        hold: "#f59e0b",
        available: "#16a34a",
        rejected: "#dc2626",
        atjw: "#2563eb",
      },
    },
  },
  plugins: [],
} satisfies Config;
