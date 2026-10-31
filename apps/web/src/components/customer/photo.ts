/** Long side of an A4 page at 300 dpi: more pixels would not print better. */
const MAX_SIDE = 2480;
/** Smaller photos are sent as they are. */
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

export function fitWithin(
  width: number,
  height: number,
  maxSide = MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function jpegName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name || 'photo'}.jpg`;
}

/**
 * Phone photos are often 4–12 MB: on a weak 4G link they are resized in the browser (EXIF
 * orientation applied) and re-encoded as JPEG before upload. Anything else is sent unchanged,
 * and so is a photo whose shrunk version would not be smaller.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  const isPhoto = file.type === 'image/jpeg' || file.type === 'image/png';
  if (!isPhoto || file.size <= SHRINK_ABOVE_BYTES || typeof createImageBitmap !== 'function') {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.fillStyle = '#ffffff'; // transparent PNG areas print white
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
