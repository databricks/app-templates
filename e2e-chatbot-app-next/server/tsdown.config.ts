import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  target: 'node22',
  unbundle: false,
  // Explicitly mark what should be external (everything except workspace packages)
  external: [/^express/, /^cors/, /^dotenv/, /^zod/, /^ai/],
  // Force workspace packages to be bundled
  noExternal: [/@chat-template\/.*/],
  dts: false,
});
