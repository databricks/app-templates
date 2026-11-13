// Install shadcn registry items without the CLI. Usage: node frontend/scripts/registry-add.mjs <item> ...
// Writes files under frontend/src, skips existing files, prints npm deps and CSS.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const wanted = process.argv.slice(2);
const SHADCN = "https://ui.shadcn.com/r/styles/new-york-v4/";
const urlOf = (item) => (item.startsWith("http") ? item : `${SHADCN}${item}.json`);
const seen = new Map();

async function resolve(item) {
  const url = urlOf(item);
  if (seen.has(url)) return;
  seen.set(url, null);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`registry item ${url} returned ${response.status}`);
  const json = await response.json();
  seen.set(url, json);
  for (const dependency of json.registryDependencies ?? []) await resolve(dependency);
}

function targetOf(file) {
  const path = file.target || file.path;
  if (path.startsWith("components/") || path.startsWith("hooks/") || path.startsWith("lib/")) return join("src", path);
  if (file.type === "registry:ui") return join("src/components/ui", basename(path));
  if (file.type === "registry:hook") return join("src/hooks", basename(path));
  if (file.type === "registry:lib") return join("src/lib", basename(path));
  return null;
}

const rewrite = (content) =>
  content
    .replaceAll("@/registry/new-york-v4/ui/", "@/components/ui/")
    .replaceAll("@/registry/new-york-v4/lib/", "@/lib/")
    .replaceAll("@/registry/new-york-v4/hooks/", "@/hooks/");

for (const item of wanted) await resolve(item);
const dependencies = new Set();
const css = [];
for (const [url, json] of seen) {
  for (const dependency of json.dependencies ?? []) dependencies.add(dependency);
  if (json.css || json.cssVars) css.push(`${url}: ${JSON.stringify({ css: json.css, cssVars: json.cssVars })}`);
  for (const file of json.files ?? []) {
    const target = targetOf(file);
    if (!target) {
      console.log(`SKIP ${file.path} (${file.type}) from ${url}`);
      continue;
    }
    const full = join(root, target);
    if (existsSync(full)) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, rewrite(file.content));
    console.log(`WROTE ${target}`);
  }
}
console.log(`DEPENDENCIES ${[...dependencies].join(" ")}`);
for (const line of css) console.log(`CSS ${line}`);
