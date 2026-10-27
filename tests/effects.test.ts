import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// An effect with an expression body returns that expression to React as its cleanup. Chrome's
// window.scrollTo now returns a Promise, so `useEffect(() => window.scrollTo(0, 0), [tab])`
// crashed the app on the first tab click. Effects must use a block body.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

describe("React effects", () => {
  it("never use an expression-bodied callback (its value would become the cleanup)", () => {
    const bad = files(path.resolve(__dirname, "../src")).flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${path.relative(process.cwd(), f)}:${i + 1}` }))
        .filter(({ line }) => /use(Layout)?Effect\(\s*\(\)\s*=>\s*[^{\s]/.test(line))
        .map(({ at, line }) => `${at}: ${line.trim()}`)
    );
    expect(bad).toEqual([]);
  });
});
