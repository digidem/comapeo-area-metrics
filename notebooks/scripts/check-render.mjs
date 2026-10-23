#!/usr/bin/env node
// Serves the built site and renders each notebook in headless Chrome, failing if the
// build still references observablehq.com or any cell renders an error.
// Usage: node notebooks/scripts/check-render.mjs <notebook.html>...  (after npm run notebooks:build)
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { preview } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, ".observable/dist");
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Virtual time: the runtime schedules work with requestAnimationFrame, so the budget is
// what the slowest notebook needs to settle, not wall-clock seconds.
const budget = Number(process.env.RENDER_BUDGET_MS ?? 60000);

let failed = false;
const fail = (message) => {
  failed = true;
  console.error(`✗ ${message}`);
};

for (const file of readdirSync(dist, { recursive: true })) {
  const path = join(dist, file);
  if (/\.(js|html)$/.test(file) && readFileSync(path, "utf8").includes("api.observablehq.com"))
    fail(`${path} imports from api.observablehq.com`);
}

const server = await preview({ root, configFile: false, preview: { port: 0, open: false }, build: { outDir: dist }, logLevel: "silent" });
const origin = server.resolvedUrls.local[0];
const profile = mkdtempSync(join(tmpdir(), "check-render-"));
try {
  for (const notebook of process.argv.slice(2)) {
    const { stdout } = await promisify(execFile)(
      chrome,
      ["--headless=new", "--disable-gpu", `--user-data-dir=${profile}`, `--virtual-time-budget=${budget}`, "--dump-dom", new URL(relative(root, resolve(notebook)), origin).href],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const errors = [...stdout.matchAll(/class="[^"]*observablehq--error[^"]*"[^>]*>([\s\S]{0,300}?)<\/div>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim(),
    );
    if (!/observablehq--cell/.test(stdout)) fail(`${notebook}: no cells rendered`);
    for (const error of errors) fail(`${notebook}: ${error}`);
    if (!errors.length) console.log(`✓ ${notebook}`);
  }
} finally {
  await server.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
