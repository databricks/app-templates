import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'server/server.ts',
  unbundle: true,
  external: (id) => /^[^./]/.test(id) || id.includes('/node_modules/'),
  tsconfig: 'tsconfig.server.json',
  outExtensions: () => ({
    js: '.js',
  }),
});
