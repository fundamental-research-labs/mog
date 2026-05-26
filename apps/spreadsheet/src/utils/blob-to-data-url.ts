/**
 * Convert a Blob (image, file, etc.) to a data URL via FileReader.
 *
 * Used by paste-image flows and the InsertPictureDialog to convert
 * clipboard/file blobs into the `src` string accepted by the
 * floating-object picture API.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
