import type { DocumentSource } from '@mog-sdk/contracts/document';

import { toPublicError } from './public-error';
import type { SpreadsheetDocumentSource, SpreadsheetSaveState } from './public-types';

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw toPublicError(
      new Error('SHA-256 digest is unavailable in this runtime'),
      'RuntimeError',
      false,
      {
        operation: 'hashBytes',
      },
    );
  }
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await subtle.digest('SHA-256', input.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function cloneBytes(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(bytes);
  }
  return new Uint8Array(bytes.slice(0));
}

export function toDocumentSource(source: SpreadsheetDocumentSource): DocumentSource | null {
  if (source.kind === 'blank') return null;
  return { type: 'bytes', data: cloneBytes(source.bytes) };
}

export function getSourceFileKind(source: SpreadsheetDocumentSource): 'xlsx' | 'csv' {
  return source.kind === 'csv-bytes' ? 'csv' : 'xlsx';
}

export function makeCleanState(
  workbookId: string,
  epoch: number,
  versionId?: string,
): SpreadsheetSaveState {
  return { status: 'clean', workbookId, epoch, versionId };
}
