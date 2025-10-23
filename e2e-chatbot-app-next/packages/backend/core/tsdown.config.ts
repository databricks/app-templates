import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/**/*.ts'],
  unbundle: true,
  dts: false,
  format: ['esm', 'cjs'],
  target: 'esnext',
})
