import { defineConfig } from "tsdown";

// Packages with native binaries or that are only used in dev mode.
// These must stay external — they're never called in production (NODE_ENV=production).
const NATIVE_OR_DEV_ONLY = [
  "@ast-grep/napi",
  "vite",
  "rolldown-vite",
  "rolldown",
  "lightningcss",
  "@rolldown/binding",
  "@tailwindcss/oxide",
  "fsevents",
  "unrun",
];

export default defineConfig({
  entry: "server/server.ts",
  platform: "node",
  tsconfig: "tsconfig.server.json",
  // Bundle all npm deps into the output (no node_modules needed at runtime).
  noExternal: /.*/,
  // Except native/dev-only packages — mark them as truly external so rolldown
  // doesn't try to follow their import chains into native binaries.
  external: NATIVE_OR_DEV_ONLY.flatMap((pkg) => [
    pkg,
    new RegExp(`^${pkg.replace("/", "\\/")}/`),
  ]),
  outExtensions: () => ({
    js: ".js",
  }),
});
