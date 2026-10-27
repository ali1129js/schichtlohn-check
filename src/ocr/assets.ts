/** URL on the app's own origin (the app may be served from a sub-path). Never a third-party host. */
export function ownAsset(rel: string, base: string = document.baseURI): string {
  const u = new URL(rel, base);
  if (u.origin !== new URL(base).origin) throw new Error("OCR assets must come from this site");
  return u.href;
}
