import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import type { ProxyOptions } from 'vite';

export function simulateNetworkError(timeout: number): ProxyOptions["configure"] {
  return (proxy, _options) => {
    proxy.on('proxyReq', (proxyReq, req, res) => {
      setTimeout(() => {
        // Destroy the socket connection to the browser
        res.socket?.destroy(new Error("simulated network error"));

        // Also clean up the backend connection
        proxyReq.socket?.destroy();
      }, 2000);
    });
  };
}

const proxyTarget = 'http://localhost:3001';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api/chat': {
        target: proxyTarget,
        changeOrigin: true,
        // Uncomment this to test situations where the stream will time out.
        // configure: simulateNetworkError(2000),
      },
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
