import type { MogEmbedConfig } from '../config';

export const PROTOCOL_VERSION = 1;
export const SUPPORTED_VERSIONS: readonly number[] = [1];
const PROTOCOL_FIELD = 'mog.embed';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

const HANDSHAKE_TYPES = ['hello', 'helloAck', 'versionMismatch'] as const;
const LIFECYCLE_TYPES = ['ready', 'error', 'dispose', 'heartbeat'] as const;
const LAYOUT_TYPES = ['resize', 'viewportChanged'] as const;
const SOURCE_AUTH_TYPES = [
  'sourceRef',
  'authRef',
  'tokenRefreshRequest',
  'tokenRefreshResponse',
] as const;
const CAPABILITY_TYPES = ['effectiveCapabilities', 'capabilityDenied', 'policyRefresh'] as const;
const NAVIGATION_TYPES = ['sheetSelect', 'rangeSelect', 'scrollTo', 'focusRequest'] as const;
const USER_EVENT_TYPES = [
  'selectionChange',
  'sheetChange',
  'dirtyChange',
  'commandResult',
] as const;
const SAVE_EXPORT_TYPES = [
  'saveRequested',
  'saveCompleted',
  'saveFailed',
  'exportRequested',
  'exportCompleted',
] as const;

const ALL_TYPES = [
  ...HANDSHAKE_TYPES,
  ...LIFECYCLE_TYPES,
  ...LAYOUT_TYPES,
  ...SOURCE_AUTH_TYPES,
  ...CAPABILITY_TYPES,
  ...NAVIGATION_TYPES,
  ...USER_EVENT_TYPES,
  ...SAVE_EXPORT_TYPES,
] as const;

export type MogEmbedMessageType = (typeof ALL_TYPES)[number];

const VALID_TYPES: ReadonlySet<string> = new Set(ALL_TYPES);

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface MogEmbedMessage {
  protocol: 'mog.embed';
  version: number;
  id: string;
  correlationId?: string;
  type: MogEmbedMessageType;
  payload?: unknown;
}

export interface MogEmbedBootstrapPayload {
  ref: string;
  config?: Partial<MogEmbedConfig>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMessage(
  type: MogEmbedMessageType,
  payload?: unknown,
  correlationId?: string,
): MogEmbedMessage {
  const msg: MogEmbedMessage = {
    protocol: PROTOCOL_FIELD,
    version: PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    type,
  };
  if (correlationId !== undefined) msg.correlationId = correlationId;
  if (payload !== undefined) msg.payload = payload;
  return msg;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CorrelationTimeoutError extends Error {
  readonly correlationId: string;
  constructor(correlationId: string, timeoutMs: number) {
    super(`Response for ${correlationId} timed out after ${timeoutMs}ms`);
    this.name = 'CorrelationTimeoutError';
    this.correlationId = correlationId;
  }
}

export class VersionMismatchError extends Error {
  readonly offeredVersions: number[];
  readonly supportedVersions: readonly number[];
  constructor(offered: number[], supported: readonly number[]) {
    super(`Version mismatch: offered [${offered.join(',')}], supported [${supported.join(',')}]`);
    this.name = 'VersionMismatchError';
    this.offeredVersions = offered;
    this.supportedVersions = supported;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidMessage(data: unknown): data is MogEmbedMessage {
  if (data === null || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.protocol === PROTOCOL_FIELD &&
    obj.version === PROTOCOL_VERSION &&
    typeof obj.id === 'string' &&
    obj.id.length > 0 &&
    typeof obj.type === 'string' &&
    VALID_TYPES.has(obj.type)
  );
}

export function validateMessagePayload(msg: unknown): MogEmbedMessage | null {
  if (msg === null || typeof msg !== 'object') return null;
  const obj = msg as Record<string, unknown>;
  if (obj.protocol !== PROTOCOL_FIELD) return null;
  if (typeof obj.version !== 'number') return null;
  if (typeof obj.id !== 'string' || obj.id.length === 0) return null;
  if (typeof obj.type !== 'string') return null;
  if (!VALID_TYPES.has(obj.type)) return null;
  if (!SUPPORTED_VERSIONS.includes(obj.version)) return null;
  return obj as unknown as MogEmbedMessage;
}

export function validateMessageEvent(
  event: MessageEvent,
  allowedOrigins: readonly string[],
  expectedSource: MessageEventSource | null,
): MogEmbedMessage | null {
  if (!validateOrigin(event, allowedOrigins)) return null;
  if (expectedSource !== null && event.source !== expectedSource) return null;
  return validateMessagePayload(event.data);
}

export function negotiateVersion(offered: number[]): number | null {
  for (let i = offered.length - 1; i >= 0; i--) {
    if (SUPPORTED_VERSIONS.includes(offered[i])) return offered[i];
  }
  return null;
}

// SECURITY: Always validate event.origin from the MessageEvent against a
// known allowlist. Never trust an origin field claimed inside the message
// payload — the browser's event.origin is the only authoritative source.
export function validateOrigin(event: MessageEvent, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.includes(event.origin);
}
