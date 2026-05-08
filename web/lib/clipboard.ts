async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Decode failed"));
      i.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    ctx.drawImage(img, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) throw new Error("toBlob returned null");
    return png;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchAsPng(url: string): Promise<Blob> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
  return blobToPng(await r.blob());
}

export function copyImageToClipboard(url: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return Promise.reject(
      new Error("Clipboard image API не поддерживается этим браузером"),
    );
  }
  // Safari requires `clipboard.write` to be called synchronously inside the
  // user gesture — any `await` before it kills the activation. Solution:
  // pass a `Promise<Blob>` to ClipboardItem (Safari awaits it internally).
  // Chrome/Firefox now support this pattern too.
  return navigator.clipboard.write([
    new ClipboardItem({ "image/png": fetchAsPng(url) }),
  ]);
}
