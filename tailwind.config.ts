import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        // #eaeff3 を基調にした、Apple風の落ち着いたスレート（青みグレー）
        brand: {
          50: "#f5f8fa",
          100: "#eaeff3", // 薄い選択ハイライト
          200: "#dce4ec", // 追加ボタン（少し濃いめ）
          300: "#c6d2dd",
          400: "#9fb0c0",
          500: "#6b8296", // 中間アクセント
          600: "#526676",
          700: "#3c4b59", // 濃いアクセント文字
        },
      },
    },
  },
  plugins: [],
};

export default config;
