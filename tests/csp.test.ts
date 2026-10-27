import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cspPolicy } from "../vite.config";
import { OCR_CONFIG } from "@/ocr/config";

// Every source the policy allows must be this site itself (or local blob:/data: URLs and the
// hash of the inline theme script). No third-party origin, ever.
const ALLOWED = /^(?:'self'|'none'|'unsafe-inline'|'sha256-[A-Za-z0-9+/=]+'|blob:|data:)$/;

function check(policy: string) {
  const dirs = Object.fromEntries(
    policy
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...src]) => [name!, src])
  );
  for (const [name, src] of Object.entries(dirs)) for (const s of src) expect(s, `${name} ${s}`).toMatch(ALLOWED);
  return dirs;
}

describe("Content-Security-Policy", () => {
  it("allows no third-party origin in any directive", () => {
    const d = check(cspPolicy(["'sha256-abc='"]));
    expect(d["connect-src"]).toEqual(["'self'"]);
    expect(d["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(d["script-src"]).not.toContain("'unsafe-eval'");
    expect(d["default-src"]).toEqual(["'self'"]);
  });

  it("the built index.html carries that policy", () => {
    const html = new URL("../dist/index.html", import.meta.url);
    if (!existsSync(html)) return; // only after `npm run build`
    const m = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(html, "utf8"));
    expect(m).not.toBeNull();
    check(m![1]!);
  });

  it("OCR files are relative paths on this site", () => {
    for (const p of [...Object.values(OCR_CONFIG.engines.tesseract.assets), ...Object.values(OCR_CONFIG.engines.graniteDocling.assets)]) expect(p).not.toMatch(/^(?:[a-z]+:)?\/\//i);
  });

  it("vercel.json does not add third-party sources", () => {
    const v = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
    expect(v).not.toMatch(/https?:\/\//);
  });
});
