/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Production builds get a Content-Security-Policy that forbids network requests from scripts
 * (connect-src 'none'): the app has no backend and must never upload anything. The inline
 * theme script is allowed by its hash. Dev mode skips this so Vite's HMR websocket works.
 */
function csp(): Plugin {
  return {
    name: "schichtlohn-csp",
    apply: "build",
    transformIndexHtml(html) {
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`
      );
      const policy = [
        "default-src 'self'",
        `script-src 'self' ${inline.join(" ")}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "worker-src 'self' blob:",
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
        "object-src 'none'",
      ].join("; ");
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig({
  plugins: [react(), csp()],
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
