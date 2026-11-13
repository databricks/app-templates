import { defineConfig, devices } from "@playwright/test";

const PORT = 8771;

/** Production build with mocked API calls at phone, tablet and desktop widths; no workspace needed. */
export default defineConfig({
  testDir: "tests/ui",
  outputDir: "test-results/ui",
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "phone-webkit", use: { ...devices["iPhone 15"] } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx vite build --outDir dist --emptyOutDir && npx vite preview --outDir dist --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
