import { defineConfig } from "tsdown";
import { writeBrowserStub } from "./write-stub";

export default defineConfig([
  {
    name: "server",
    entry: "packages/backend/index.ts",
    outDir: "dist/server",
    platform: "node",
    minify: true,
    dts: true,
    sourcemap: false,
    clean: true,
    onSuccess: (config) => writeBrowserStub(config.outDir),
  },
  {
    name: "react",
    entry: "packages/frontend/index.ts",
    outDir: "dist/react",
    platform: "browser",
    minify: true,
    dts: true,
    sourcemap: false,
    clean: true,
  },
]);
