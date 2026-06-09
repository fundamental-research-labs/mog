export type ColorScheme = 'light' | 'dark' | 'system';

export interface WebviewAssets {
  readonly wasmBaseUrl: string;
  readonly workerUrl: string;
  readonly fontBaseUrl: string;
  readonly staticBaseUrl: string;
}

export interface SaveResultPayload {
  readonly requestId: string;
  readonly saveRequestId: string;
  readonly workbookId: string;
  readonly epoch: number;
  readonly dirtyEpoch: number;
  readonly changeSequence: number;
  readonly bytes: number[];
  readonly bytesHash: string;
  readonly baseVersionId?: string;
}

export interface ByteResultPayload {
  readonly requestId: string;
  readonly bytes: number[];
  readonly bytesHash?: string;
}

export type ExtensionToWebview =
  | {
      readonly type: 'init';
      readonly documentId: string;
      readonly fileName: string;
      readonly bytes: number[];
      readonly assets: WebviewAssets;
      readonly colorScheme: ColorScheme;
    }
  | { readonly type: 'request-save'; readonly requestId: string }
  | { readonly type: 'request-backup'; readonly requestId: string }
  | { readonly type: 'request-export-xlsx'; readonly requestId: string }
  | { readonly type: 'save-ack'; readonly requestId: string; readonly versionId?: string }
  | { readonly type: 'save-failed'; readonly requestId: string; readonly message: string }
  | { readonly type: 'set-theme'; readonly colorScheme: ColorScheme }
  | { readonly type: 'dispose' };

export type WebviewToExtension =
  | { readonly type: 'ready' }
  | { readonly type: 'initialized'; readonly documentId: string }
  | { readonly type: 'dirty-change'; readonly dirty: boolean; readonly changeSequence: number }
  | ({ readonly type: 'save-result' } & SaveResultPayload)
  | ({ readonly type: 'backup-result' } & ByteResultPayload)
  | ({ readonly type: 'export-result' } & ByteResultPayload)
  | {
      readonly type: 'error';
      readonly operation: string;
      readonly message: string;
      readonly requestId?: string;
      readonly stack?: string;
    };

export function bytesToNumberArray(bytes: Uint8Array | ArrayBuffer): number[] {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view);
}

export function numberArrayToBytes(bytes: readonly number[]): Uint8Array {
  return Uint8Array.from(bytes);
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
}

export function isByteArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isDirtyChange(
  value: Record<string, unknown>,
): value is Extract<WebviewToExtension, { type: 'dirty-change' }> {
  return (
    typeof value.dirty === 'boolean' &&
    Number.isInteger(value.changeSequence) &&
    Number(value.changeSequence) >= 0
  );
}

function isSaveResult(value: Record<string, unknown>): boolean {
  return (
    isValidRequestId(value.requestId) &&
    typeof value.saveRequestId === 'string' &&
    typeof value.workbookId === 'string' &&
    Number.isInteger(value.epoch) &&
    Number.isInteger(value.dirtyEpoch) &&
    Number.isInteger(value.changeSequence) &&
    isByteArray(value.bytes) &&
    typeof value.bytesHash === 'string' &&
    optionalString(value.baseVersionId)
  );
}

function isByteResult(value: Record<string, unknown>): boolean {
  return (
    isValidRequestId(value.requestId) && isByteArray(value.bytes) && optionalString(value.bytesHash)
  );
}

export function parseWebviewMessage(value: unknown): WebviewToExtension | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'initialized':
      return typeof value.documentId === 'string'
        ? { type: 'initialized', documentId: value.documentId }
        : null;
    case 'dirty-change':
      return isDirtyChange(value) ? value : null;
    case 'save-result':
      return isSaveResult(value)
        ? {
            type: 'save-result',
            requestId: value.requestId as string,
            saveRequestId: value.saveRequestId as string,
            workbookId: value.workbookId as string,
            epoch: value.epoch as number,
            dirtyEpoch: value.dirtyEpoch as number,
            changeSequence: value.changeSequence as number,
            bytes: value.bytes as number[],
            bytesHash: value.bytesHash as string,
            baseVersionId: value.baseVersionId as string | undefined,
          }
        : null;
    case 'backup-result':
      return isByteResult(value)
        ? {
            type: 'backup-result',
            requestId: value.requestId as string,
            bytes: value.bytes as number[],
            bytesHash: value.bytesHash as string | undefined,
          }
        : null;
    case 'export-result':
      return isByteResult(value)
        ? {
            type: 'export-result',
            requestId: value.requestId as string,
            bytes: value.bytes as number[],
            bytesHash: value.bytesHash as string | undefined,
          }
        : null;
    case 'error':
      return typeof value.operation === 'string' && typeof value.message === 'string'
        ? {
            type: 'error',
            operation: value.operation,
            message: value.message,
            requestId: isValidRequestId(value.requestId) ? value.requestId : undefined,
            stack: typeof value.stack === 'string' ? value.stack : undefined,
          }
        : null;
    default:
      return null;
  }
}
