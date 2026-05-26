/**
 * Document Lifecycle Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/document.
 */

import type { DocumentSource } from '@mog-sdk/contracts/document';

/** Construct a path-based document source (desktop file on disk). */
export function documentSourceFromPath(path: string): DocumentSource {
  return { type: 'path', path };
}

/** Construct a bytes-based document source (web upload, recovery). */
export function documentSourceFromBytes(data: Uint8Array): DocumentSource {
  return { type: 'bytes', data };
}
