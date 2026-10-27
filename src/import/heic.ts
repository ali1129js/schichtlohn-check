/**
 * HEIC/HEIF photos (the iPhone default). Decoded by the browser itself where it can (Safari on
 * iPhone, iPad and Mac): the photo is drawn into a canvas and handed to OCR as PNG. No converter
 * library is loaded: the available ones (heic2any, libheif-js) compile code at run time
 * (`new Function`), which the app's Content-Security-Policy (script-src 'self') does not allow,
 * and nothing may be fetched from another site. Other browsers get a clear message instead.
 */
export const HEIC_UNSUPPORTED =
  "This browser cannot open HEIC photos (iPhone format). Open the photo on the iPhone in Safari, or export it as JPG (Photos app: Share → Options → Most Compatible, or take a screenshot) and drop the JPG here.";

export class HeicError extends Error {
  constructor() {
    super(HEIC_UNSUPPORTED);
    this.name = "HeicError";
  }
}

export interface HeicResult {
  bytes: Uint8Array;
  mime: string;
}

/** Browser HEIC -> PNG via the built-in image decoder. Throws HeicError when it cannot decode. */
export async function convertHeicInBrowser(bytes: Uint8Array): Promise<HeicResult> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/heic" }), { imageOrientation: "from-image" });
  } catch {
    throw new HeicError();
  }
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new HeicError();
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!blob) throw new HeicError();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/png" };
}
