/**
 * Picture Export Utility
 *
 * Pure DOM utility for downloading a picture as a file.
 * Moved from kernel/object-utils — this is UI-level code, not kernel business.
 */

import type { PictureObject } from '@mog-sdk/contracts/floating-objects';

export interface ExportPictureParams {
  /** The picture object to export */
  picture: PictureObject;
  /** Optional filename (defaults to picture name or "image.png") */
  filename?: string;
}

/**
 * Export a picture floating object as a downloadable file.
 *
 * Creates a temporary download link from the picture's src (data URL or blob URL)
 * and triggers a download to the user's device.
 */
export function exportPictureAsFile(params: ExportPictureParams): void {
  const { picture, filename } = params;

  const defaultFilename = picture.name ? `${picture.name}.png` : 'image.png';
  const finalFilename = filename ?? defaultFilename;

  const link = document.createElement('a');
  link.href = picture.src;
  link.download = finalFilename;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
