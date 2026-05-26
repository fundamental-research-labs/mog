/**
 * Shared semantic configuration model for all embed products.
 *
 * @stability public-experimental
 * @remarks
 * This is the `@mog-sdk/embed/config` entrypoint. All symbols exported from
 * this path are classified `public-experimental` per public exposure tiers.
 * Only config types and helpers are exported; no runtime internals.
 *
 * The same meaning appears in iframe query/bootstrap payloads, web component
 * attributes/properties, React props, and app bootstrap config. Caller-supplied
 * mode, capability, save, and collaboration fields are requests or hints, not
 * effective grants. Effective state is resolved only by the trusted adapter or
 * iframe child and surfaced back as read-only effective state/events.
 */

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export type EmbedMode = 'readonly' | 'comment' | 'review' | 'protected-edit' | 'full-edit';

// ---------------------------------------------------------------------------
// Source reference
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export interface MogEmbedSourceRef {
  kind: 'document' | 'file' | 'snapshot' | 'host-callback' | 'live-session';
  /**
   * Issued source handle — not an arbitrary URL, path, callback name,
   * provider config, or storage address.
   */
  ref: string;
}

// ---------------------------------------------------------------------------
// Chrome options
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export interface MogEmbedChromeOptions {
  formulaBar?: boolean;
  sheetTabs?: boolean;
  headers?: boolean;
  gridlines?: boolean;
  scrollbars?: boolean;
  zoomControls?: boolean;
}

// ---------------------------------------------------------------------------
// Theme options
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export interface MogEmbedThemeOptions {
  workbookTheme?: 'from-document' | string;
  chromeTheme?: 'host' | string;
}

// ---------------------------------------------------------------------------
// Save policy
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export type MogEmbedSavePolicy = 'none' | 'export-only' | 'host-callback' | 'autosave';

// ---------------------------------------------------------------------------
// Collaboration mode
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export type MogEmbedCollaborationMode = 'none' | 'local-only' | 'live';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export interface MogEmbedConfig {
  source: MogEmbedSourceRef;
  requestedMode?: EmbedMode;
  sheet?: number | string;
  range?: string;
  chrome?: MogEmbedChromeOptions;
  theme?: MogEmbedThemeOptions;
  locale?: string;
  requestedCapabilities?: readonly string[];
  capabilityGrantRef?: string;
  requestedSavePolicy?: MogEmbedSavePolicy;
  requestedCollaboration?: MogEmbedCollaborationMode;
}

// ---------------------------------------------------------------------------
// Effective state (read-only, resolved by trusted side)
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export interface MogEmbedEffectiveState {
  readonly mode: EmbedMode;
  readonly capabilities: readonly string[];
  readonly deniedCapabilities: readonly string[];
  readonly savePolicy: MogEmbedSavePolicy;
  readonly collaboration: MogEmbedCollaborationMode;
  readonly dirty: boolean;
  readonly saveState: 'idle' | 'saving' | 'saved' | 'error';
}

/** @stability public-experimental */
export interface MogEmbedResolvedSource {
  /**
   * Host-authorized XLSX materialization for this embed session.
   *
   * These bytes are not accepted directly from public component props. They
   * must be returned by the host policy after validating the opaque source ref.
   */
  readonly bytes: Uint8Array | ArrayBuffer;
  readonly authorizationRef: string;
  readonly contentType?: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

/** @stability public-experimental */
export interface MogEmbedHostPolicy {
  resolveSource(config: MogEmbedConfig): Promise<MogEmbedResolvedSource> | MogEmbedResolvedSource;
  resolveEffectiveState(
    config: MogEmbedConfig,
  ): Promise<MogEmbedEffectiveState> | MogEmbedEffectiveState;
  requestSave?(state: MogEmbedEffectiveState): Promise<boolean> | boolean;
  requestExport?(format: string, state: MogEmbedEffectiveState): Promise<Blob | null> | Blob | null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export interface MogEmbedConfigValidationError {
  readonly field: string;
  readonly message: string;
}

const SOURCE_KINDS = ['document', 'file', 'snapshot', 'host-callback', 'live-session'] as const;
const EMBED_MODES = ['readonly', 'comment', 'review', 'protected-edit', 'full-edit'] as const;
const SAVE_POLICIES = ['none', 'export-only', 'host-callback', 'autosave'] as const;
const COLLABORATION_MODES = ['none', 'local-only', 'live'] as const;
const CHROME_KEYS = [
  'formulaBar',
  'sheetTabs',
  'headers',
  'gridlines',
  'scrollbars',
  'zoomControls',
] as const;
const FORBIDDEN_CONFIG_KEYS = new Set([
  'provider' + 'Config',
  'storage' + 'Credentials',
  'bearer' + 'Token',
  'refresh' + 'Token',
  'ws' + 'Endpoint',
  'Document' + 'Storage' + 'Config',
  'provider' + 'Array',
]);

/** @stability public-experimental */
export function validateMogEmbedConfig(value: unknown): MogEmbedConfigValidationError[] {
  const errors: MogEmbedConfigValidationError[] = [];

  if (!isPlainObject(value)) {
    return [{ field: '', message: 'config must be an object' }];
  }

  rejectForbiddenKeysDeep(value, '', errors);

  const source = value.source;
  if (!isPlainObject(source)) {
    errors.push({ field: 'source', message: 'source is required and must be an object' });
  } else {
    if (!isOneOf(source.kind, SOURCE_KINDS)) {
      errors.push({ field: 'source.kind', message: 'source.kind is not supported' });
    }
    if (typeof source.ref !== 'string' || source.ref.trim().length === 0) {
      errors.push({ field: 'source.ref', message: 'source.ref must be a non-empty issued handle' });
    }
    if ('url' in source) {
      errors.push({ field: 'source.url', message: 'raw source URLs are not accepted' });
    }
    if ('path' in source) {
      errors.push({ field: 'source.path', message: 'raw source paths are not accepted' });
    }
  }

  if (value.requestedMode !== undefined && !isOneOf(value.requestedMode, EMBED_MODES)) {
    errors.push({ field: 'requestedMode', message: 'requestedMode is not supported' });
  }
  if (
    value.sheet !== undefined &&
    typeof value.sheet !== 'string' &&
    !(typeof value.sheet === 'number' && Number.isFinite(value.sheet))
  ) {
    errors.push({ field: 'sheet', message: 'sheet must be a finite number or string' });
  }
  if (value.range !== undefined && typeof value.range !== 'string') {
    errors.push({ field: 'range', message: 'range must be a string' });
  }
  if (value.chrome !== undefined) {
    if (!isPlainObject(value.chrome)) {
      errors.push({ field: 'chrome', message: 'chrome must be an object' });
    } else {
      for (const key of CHROME_KEYS) {
        const chromeValue = value.chrome[key];
        if (chromeValue !== undefined && typeof chromeValue !== 'boolean') {
          errors.push({ field: `chrome.${key}`, message: 'chrome fields must be booleans' });
        }
      }
    }
  }
  if (value.theme !== undefined) {
    if (!isPlainObject(value.theme)) {
      errors.push({ field: 'theme', message: 'theme must be an object' });
    } else {
      for (const key of ['workbookTheme', 'chromeTheme'] as const) {
        const themeValue = value.theme[key];
        if (themeValue !== undefined && typeof themeValue !== 'string') {
          errors.push({ field: `theme.${key}`, message: 'theme fields must be strings' });
        }
      }
    }
  }
  if (value.locale !== undefined && typeof value.locale !== 'string') {
    errors.push({ field: 'locale', message: 'locale must be a string' });
  }
  if (value.requestedCapabilities !== undefined) {
    if (!Array.isArray(value.requestedCapabilities)) {
      errors.push({
        field: 'requestedCapabilities',
        message: 'requestedCapabilities must be an array',
      });
    } else {
      value.requestedCapabilities.forEach((capability, index) => {
        if (typeof capability !== 'string' || capability.length === 0) {
          errors.push({
            field: `requestedCapabilities.${index}`,
            message: 'requestedCapabilities entries must be non-empty strings',
          });
        }
      });
    }
  }
  if (value.capabilityGrantRef !== undefined && typeof value.capabilityGrantRef !== 'string') {
    errors.push({ field: 'capabilityGrantRef', message: 'capabilityGrantRef must be a string' });
  }
  if (
    value.requestedSavePolicy !== undefined &&
    !isOneOf(value.requestedSavePolicy, SAVE_POLICIES)
  ) {
    errors.push({ field: 'requestedSavePolicy', message: 'requestedSavePolicy is not supported' });
  }
  if (
    value.requestedCollaboration !== undefined &&
    !isOneOf(value.requestedCollaboration, COLLABORATION_MODES)
  ) {
    errors.push({
      field: 'requestedCollaboration',
      message: 'requestedCollaboration is not supported',
    });
  }

  return errors;
}

/** @stability public-experimental */
export function assertValidMogEmbedConfig(value: unknown): asserts value is MogEmbedConfig {
  const errors = validateMogEmbedConfig(value);
  if (errors.length === 0) return;
  throw new Error(
    `Invalid MogEmbedConfig: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function rejectForbiddenKeysDeep(
  value: Record<string, unknown>,
  prefix: string,
  errors: MogEmbedConfigValidationError[],
): void {
  for (const key of Object.keys(value)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_CONFIG_KEYS.has(key)) {
      errors.push({
        field,
        message: 'raw host/storage authority is not accepted in public embed config',
      });
    }
    const child = value[key];
    if (isPlainObject(child)) {
      rejectForbiddenKeysDeep(child, field, errors);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export type MogEmbedLifecycleState = 'initializing' | 'loading' | 'ready' | 'error' | 'disposed';

// ---------------------------------------------------------------------------
// Events emitted by all embed products
// ---------------------------------------------------------------------------

/** @stability public-experimental */
export interface MogEmbedEventMap {
  lifecycleChange: MogEmbedLifecycleState;
  effectiveStateChange: MogEmbedEffectiveState;
  sheetChange: { index: number; name: string; sheetId: string };
  selectionChange: { row: number; col: number };
  dirtyChange: boolean;
  saveStateChange: 'idle' | 'saving' | 'saved' | 'error';
  capabilityDenied: { capability: string; reason?: string };
  error: Error;
}
