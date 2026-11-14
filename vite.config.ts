import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 開発中は /api をサーバー（既定 3000）へ流す
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } }
  }
});
