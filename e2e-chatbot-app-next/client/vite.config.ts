import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@chat-template/ai-sdk-integration': path.resolve(__dirname, '../packages/frontend/ai-sdk-integration/src/index.ts'),
      // '@chat-template/ai-sdk-providers': path.resolve(__dirname, '../packages/backend/ai-sdk-providers/src/index.ts'),
      // '@chat-template/auth': path.resolve(__dirname, '../packages/backend/auth/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
