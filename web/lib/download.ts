export async function downloadFile(url: string, filename: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed (${r.status}) for ${url}`);
  const blob = await r.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function photoFilename(ownerId: string, position: number, url: string): string {
  const m = url.match(/\.(\w+)(?:\?|$)/);
  const ext = m ? m[1] : "jpg";
  return `${ownerId}_${String(position).padStart(2, "0")}.${ext}`;
}
