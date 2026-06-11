export type BrowserSource =
  | { readonly kind: 'blank' }
  | {
      readonly kind: 'xlsx-bytes';
      readonly fileName: string;
      readonly bytesBase64: string;
      readonly versionId: string;
      readonly inputPath?: string;
    };

export interface BrowserBootstrap {
  readonly sessionId: string;
  readonly token: string;
  readonly source: BrowserSource;
  readonly assetBaseUrl: string;
  readonly wasmBaseUrl: string;
}

export interface BrowserStatus {
  readonly connected: boolean;
  readonly ready: boolean;
  readonly workbookId?: string;
  readonly workbookSessionId?: string;
  readonly attachmentId?: string;
  readonly activeSheetName?: string;
  readonly canvasCount?: number;
  readonly smokeStatus?: 'starting' | 'loading' | 'ready' | 'error' | 'closed';
  readonly error?: string;
  readonly updatedAt: number;
}

export type BrowserRpcRequest =
  | {
      readonly requestId: string;
      readonly type: 'cell_read';
      readonly sheet?: string;
      readonly address?: string;
      readonly range?: string;
    }
  | {
      readonly requestId: string;
      readonly type: 'cell_write';
      readonly sheet?: string;
      readonly address: string;
      readonly value: JsonValue;
    }
  | {
      readonly requestId: string;
      readonly type: 'selection_set';
      readonly sheet?: string;
      readonly range: string;
    }
  | {
      readonly requestId: string;
      readonly type: 'export_xlsx';
    }
  | {
      readonly requestId: string;
      readonly type: 'session_close';
    };

export type BrowserRpcResult =
  | { readonly requestId: string; readonly ok: true; readonly result: JsonValue }
  | {
      readonly requestId: string;
      readonly ok: false;
      readonly error: string;
      readonly stack?: string;
    };

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function bytesToBase64(bytes: Uint8Array): string {
  const maybeBuffer = (
    globalThis as { Buffer?: { from(input: Uint8Array): { toString(encoding: 'base64'): string } } }
  ).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const maybeBuffer = (
    globalThis as { Buffer?: { from(input: string, encoding: 'base64'): Uint8Array } }
  ).Buffer;
  if (maybeBuffer) {
    return Uint8Array.from(maybeBuffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function jsonSafe(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return bytesToBase64(value);
  if (Array.isArray(value)) return value.map((entry) => jsonSafe(entry));
  if (typeof value === 'object') {
    const output: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (typeof child !== 'function') {
        output[key] = jsonSafe(child);
      }
    }
    return output;
  }
  return String(value);
}
