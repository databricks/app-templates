import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const devEmail = process.env.APP_DEV_EMAIL;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "../app/static", emptyOutDir: true },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        headers: devEmail ? { "x-forwarded-email": devEmail } : {},
      },
    },
  },
});
