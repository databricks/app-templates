import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // Required for SSE streaming - prevents proxy from buffering responses
        configure: (proxy) => {
          // Flush headers immediately to start streaming
          proxy.on('proxyReq', (proxyReq, req) => {
            // Check if this might be a streaming request
            if (req.url?.includes('/api/chat')) {
              proxyReq.flushHeaders();
            }
          });
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            // Disable buffering for SSE responses
            const contentType = proxyRes.headers['content-type'] || '';
            if (contentType.includes('text/event-stream')) {
              // Ensure no buffering
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('X-Accel-Buffering', 'no');
              // Flush the response headers immediately
              res.flushHeaders?.();
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
