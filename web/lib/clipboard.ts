async function blobToPng(blob: Blob): Promise<Blob> {
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
  const blob = await r.blob();
  return blob.type === "image/png" ? blob : await blobToPng(blob);
}

export async function copyImageToClipboard(url: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Clipboard image API не поддерживается этим браузером");
  }
  // Pass a Promise (not an awaited blob) so Safari keeps the user-activation
  // context. If we await the fetch first, Safari rejects with NotAllowedError.
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": fetchAsPng(url) }),
  ]);
}
