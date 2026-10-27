/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * Production builds get a Content-Security-Policy that allows requests only to this site
 * (connect-src 'self': the OCR worker, wasm core and language data in public/ocr/). The app has
 * no backend and never uploads anything; no third-party origin appears anywhere in the policy
 * (tests/csp.test.ts). The inline theme script is allowed by its hash. Dev mode skips this so
 * Vite's HMR websocket works.
 */
export function cspPolicy(inlineHashes: string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineHashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

function csp(): Plugin {
  return {
    name: "schichtlohn-csp",
    apply: "build",
    transformIndexHtml(html) {
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`
      );
      const policy = cspPolicy(inline);
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig({
  plugins: [react(), csp()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: "./",
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { port: 5191, strictPort: true },
  preview: { port: 4191, strictPort: true },
  build: { outDir: "dist", chunkSizeWarningLimit: 1200 },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
