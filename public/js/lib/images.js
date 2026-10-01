// Image attachments for Spark AI: picking, pasting, dropping, and shrinking
// images in the browser before they are sent to the vision model.

export const MAX_ATTACH = 4;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const isImage = (f) => f && /^image\/(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(f.type);

// Downscales to `max` px on the long side and re-encodes as JPEG (white behind transparency).
export async function toDataUrl(file, { max = 1280, quality = 0.85 } = {}) {
  if (!isImage(file)) throw new Error('That file is not an image.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That image is too large (max 25 MB).');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Couldn't read that image.");
  });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

export function pickImages({ multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...(input.files || [])]), { once: true });
    input.click();
  });
}

export const imageFiles = (dataTransfer) =>
  [...(dataTransfer?.items || [])]
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter(isImage);

export async function toDataUrls(files, limit = MAX_ATTACH) {
  const out = [];
  for (const f of files.filter(isImage).slice(0, limit)) out.push(await toDataUrl(f));
  return out;
}
