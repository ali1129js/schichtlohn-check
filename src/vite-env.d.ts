/// <reference types="vite/client" />

declare module "pdfjs-dist/legacy/build/pdf.min.mjs" {
  export * from "pdfjs-dist/legacy/build/pdf.mjs";
}

/** package.json version, injected by vite.config.ts */
declare const __APP_VERSION__: string;
