export const MOG_SDK_SUPPORTED_VERSION_STORE_KINDS = [
  'memory',
  'in-memory',
  'memory-durable-snapshot',
  'indexeddb',
  'browser',
] as const;

export const MOG_SDK_UNSUPPORTED_VERSION_STORE_KINDS = [
  'node-file',
  'nodeFile',
  'filesystem',
] as const;

export type MogSdkSupportedVersionStoreKind =
  (typeof MOG_SDK_SUPPORTED_VERSION_STORE_KINDS)[number];
export type MogSdkUnsupportedVersionStoreKind =
  (typeof MOG_SDK_UNSUPPORTED_VERSION_STORE_KINDS)[number];
export type MogSdkVersionStoreRuntime = 'node' | 'wasm';

export interface MogSdkVersionStoreScopeOptions {
  /**
   * Optional workspace scope for the version graph. Omit for document-local
   * single-workspace SDK usage.
   */
  readonly workspaceId?: string;
  /** Optional principal partition for multi-principal version histories. */
  readonly principalScope?: string;
  /** Open the selected version store read-only. */
  readonly readOnly?: boolean;
}

export interface MogSdkMemoryVersionStoreConfig extends MogSdkVersionStoreScopeOptions {
  readonly kind: 'memory' | 'in-memory';
  /**
   * Plain in-memory version stores are intentionally ephemeral. Use
   * `memory-durable-snapshot` for the registry's durable snapshot test double.
   */
  readonly requireDurablePersistence?: false;
}

export interface MogSdkMemoryDurableSnapshotVersionStoreConfig extends MogSdkVersionStoreScopeOptions {
  readonly kind: 'memory-durable-snapshot';
  readonly requireDurablePersistence?: boolean;
}

export interface MogSdkIndexedDbVersionStoreConfig extends MogSdkVersionStoreScopeOptions {
  readonly kind: 'indexeddb';
  readonly requireDurablePersistence?: boolean;
}

export interface MogSdkBrowserVersionStoreConfig extends MogSdkVersionStoreScopeOptions {
  readonly kind: 'browser';
  /** Browser-backed SDK version history currently maps to IndexedDB. */
  readonly provider?: 'indexeddb';
  readonly requireDurablePersistence?: boolean;
}

export interface MogSdkNodeFileVersionStoreConfig extends MogSdkVersionStoreScopeOptions {
  readonly kind: MogSdkUnsupportedVersionStoreKind;
  /**
   * Raw Node filesystem paths are intentionally not materialized by the SDK
   * version-store slice yet. This shape is public so callers get an explicit
   * unsupported diagnostic instead of an implicit memory fallback.
   */
  readonly path: string;
  readonly requireDurablePersistence?: true;
}

export type MogSdkVersionStoreConfigObject =
  | MogSdkMemoryVersionStoreConfig
  | MogSdkMemoryDurableSnapshotVersionStoreConfig
  | MogSdkIndexedDbVersionStoreConfig
  | MogSdkBrowserVersionStoreConfig
  | MogSdkNodeFileVersionStoreConfig;

export type MogSdkVersionStoreConfig =
  | MogSdkSupportedVersionStoreKind
  | MogSdkVersionStoreConfigObject;

export type MogSdkVersionStoreDiagnosticCode =
  | 'MOG_SDK_VERSION_STORE_INVALID_CONFIG'
  | 'MOG_SDK_VERSION_STORE_UNSUPPORTED';

export interface MogSdkVersionStoreDiagnostic {
  readonly code: MogSdkVersionStoreDiagnosticCode;
  readonly severity: 'error';
  readonly runtime: MogSdkVersionStoreRuntime;
  readonly requestedKind?: string;
  readonly supportedKinds: readonly MogSdkSupportedVersionStoreKind[];
  readonly safeMessage: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

type DisallowedVersionStoreConfigField = {
  readonly category: 'provider-identity' | 'storage-key' | 'scope';
  readonly message: string;
};

const DISALLOWED_VERSION_STORE_CONFIG_FIELDS: Readonly<
  Record<string, DisallowedVersionStoreConfigField>
> = Object.freeze({
  providerId: {
    category: 'provider-identity',
    message:
      'versionStore.providerId is ambiguous; SDK version-store config selects a provider kind, not a persisted provider identity.',
  },
  providerID: {
    category: 'provider-identity',
    message:
      'versionStore.providerID is ambiguous; SDK version-store config selects a provider kind, not a persisted provider identity.',
  },
  providerIdentity: {
    category: 'provider-identity',
    message:
      'versionStore.providerIdentity is ambiguous; provider identities are owned by the selected kernel provider.',
  },
  providerRefId: {
    category: 'provider-identity',
    message:
      'versionStore.providerRefId is ambiguous; provider ref identities are graph metadata, not SDK provider selection.',
  },
  providerKey: {
    category: 'provider-identity',
    message:
      'versionStore.providerKey is ambiguous; SDK version-store config selects a provider kind, not a persisted provider key.',
  },
  storageKey: {
    category: 'storage-key',
    message:
      'versionStore.storageKey is unsafe storage key material; storage keys are derived from the validated document scope.',
  },
  storageKeyPrefix: {
    category: 'storage-key',
    message:
      'versionStore.storageKeyPrefix is unsafe storage key material; storage keys are derived from the validated document scope.',
  },
  keyPrefix: {
    category: 'storage-key',
    message:
      'versionStore.keyPrefix is unsafe storage key material; storage keys are derived from the validated document scope.',
  },
  documentScopeKey: {
    category: 'storage-key',
    message:
      'versionStore.documentScopeKey is unsafe storage key material; document scope keys are kernel-owned derived values.',
  },
  namespaceKey: {
    category: 'storage-key',
    message:
      'versionStore.namespaceKey is unsafe storage key material; namespace keys are kernel-owned derived values.',
  },
  namespace: {
    category: 'storage-key',
    message:
      'versionStore.namespace is unsafe storage key material; graph namespaces are kernel-owned derived values.',
  },
  graphId: {
    category: 'storage-key',
    message:
      'versionStore.graphId is unsafe storage key material; root graph IDs are selected by the kernel lifecycle.',
  },
  databaseName: {
    category: 'storage-key',
    message:
      'versionStore.databaseName is unsafe storage key material; IndexedDB database naming is SDK-owned.',
  },
  dbName: {
    category: 'storage-key',
    message:
      'versionStore.dbName is unsafe storage key material; IndexedDB database naming is SDK-owned.',
  },
  objectStoreName: {
    category: 'storage-key',
    message:
      'versionStore.objectStoreName is unsafe storage key material; IndexedDB object store naming is SDK-owned.',
  },
  documentId: {
    category: 'scope',
    message:
      'versionStore.documentId is inconsistent with SDK document scope; pass documentId to createWorkbook options instead.',
  },
  documentScope: {
    category: 'scope',
    message:
      'versionStore.documentScope is inconsistent with SDK document scope; pass workspaceId/principalScope on versionStore and documentId to createWorkbook options.',
  },
  workspaceScope: {
    category: 'scope',
    message:
      'versionStore.workspaceScope is inconsistent with SDK workspace scope; pass workspaceId directly on versionStore.',
  },
  scope: {
    category: 'scope',
    message:
      'versionStore.scope is inconsistent with SDK document scope; pass workspaceId/principalScope on versionStore and documentId to createWorkbook options.',
  },
});

export class MogSdkVersionStoreConfigError extends Error {
  readonly diagnostic: MogSdkVersionStoreDiagnostic;
  readonly diagnostics: readonly MogSdkVersionStoreDiagnostic[];

  constructor(diagnostic: MogSdkVersionStoreDiagnostic) {
    super(diagnostic.message);
    this.name = 'MogSdkVersionStoreConfigError';
    this.diagnostic = diagnostic;
    this.diagnostics = [diagnostic];
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface MogSdkVersionStoreLifecycleProviderSelection {
  readonly kind: 'memory' | 'memory-durable-snapshot' | 'indexeddb';
  readonly workspaceId?: string;
  readonly principalScope?: string;
  readonly readOnly?: boolean;
  readonly requireDurablePersistence?: boolean;
}

export interface MogSdkVersionStoreLifecycleConfig {
  readonly providerSelection: MogSdkVersionStoreLifecycleProviderSelection;
}

export function isMogSdkVersionStoreConfigError(
  value: unknown,
): value is MogSdkVersionStoreConfigError {
  return value instanceof MogSdkVersionStoreConfigError;
}

export function createSdkVersionStoreLifecycleConfig(
  versionStore: MogSdkVersionStoreConfig | undefined,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): MogSdkVersionStoreLifecycleConfig | undefined {
  if (versionStore === undefined) return undefined;

  const parsed = parseVersionStoreConfig(versionStore, options);
  if (isUnsupportedVersionStoreKind(parsed.kind)) {
    throw new MogSdkVersionStoreConfigError(
      unsupportedVersionStoreDiagnostic(parsed.kind, parsed.config, options),
    );
  }
  if (!isSupportedVersionStoreKind(parsed.kind)) {
    throw new MogSdkVersionStoreConfigError(
      unsupportedVersionStoreDiagnostic(parsed.kind, parsed.config, options),
    );
  }

  validateSupportedVersionStoreConfig(parsed.kind, parsed.config, options);

  switch (parsed.kind) {
    case 'memory':
    case 'in-memory': {
      const requireDurablePersistence = optionalBooleanField(
        parsed.config,
        'requireDurablePersistence',
        options,
      );
      if (requireDurablePersistence === true) {
        throw new MogSdkVersionStoreConfigError(
          invalidVersionStoreDiagnostic(
            options,
            parsed.kind,
            'The ephemeral memory version store cannot satisfy requireDurablePersistence=true.',
          ),
        );
      }
      return lifecycleConfig('memory', parsed.config, options);
    }
    case 'memory-durable-snapshot':
      return lifecycleConfig('memory-durable-snapshot', parsed.config, options, true);
    case 'indexeddb':
      return lifecycleConfig('indexeddb', parsed.config, options, true);
    case 'browser': {
      const provider = optionalStringField(parsed.config, 'provider', options);
      if (provider !== undefined && provider !== 'indexeddb') {
        throw new MogSdkVersionStoreConfigError(
          invalidVersionStoreDiagnostic(
            options,
            parsed.kind,
            `Browser version stores only support provider='indexeddb'; received '${provider}'.`,
          ),
        );
      }
      return lifecycleConfig('indexeddb', parsed.config, options, true);
    }
    default:
      throw new MogSdkVersionStoreConfigError(
        unsupportedVersionStoreDiagnostic(parsed.kind, parsed.config, options),
      );
  }
}

type ParsedVersionStoreConfig = {
  readonly kind: string;
  readonly config: Readonly<Record<string, unknown>> | null;
};

function parseVersionStoreConfig(
  versionStore: MogSdkVersionStoreConfig,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): ParsedVersionStoreConfig {
  if (typeof versionStore === 'string') {
    return { kind: versionStore, config: null };
  }

  if (!isRecord(versionStore)) {
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        undefined,
        'versionStore must be a supported kind string or a version-store config object.',
      ),
    );
  }

  if (typeof versionStore.kind !== 'string' || versionStore.kind.length === 0) {
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        undefined,
        'versionStore.kind must be a non-empty string.',
      ),
    );
  }

  return { kind: versionStore.kind, config: versionStore };
}

function validateSupportedVersionStoreConfig(
  kind: MogSdkSupportedVersionStoreKind,
  config: Readonly<Record<string, unknown>> | null,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): void {
  if (config === null) return;

  if (kind !== 'browser' && hasOwnField(config, 'provider')) {
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        kind,
        "versionStore.provider is only valid with kind='browser'; use versionStore.kind to select a provider.",
        { field: 'provider', category: 'provider-identity' },
      ),
    );
  }

  for (const [field, fieldConfig] of Object.entries(DISALLOWED_VERSION_STORE_CONFIG_FIELDS)) {
    if (!hasOwnField(config, field)) continue;
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(options, kind, fieldConfig.message, {
        field,
        category: fieldConfig.category,
      }),
    );
  }
}

function lifecycleConfig(
  kind: MogSdkVersionStoreLifecycleProviderSelection['kind'],
  config: Readonly<Record<string, unknown>> | null,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
  defaultRequireDurablePersistence?: boolean,
): MogSdkVersionStoreLifecycleConfig {
  const workspaceId = optionalStringField(config, 'workspaceId', options);
  const principalScope = optionalStringField(config, 'principalScope', options);
  const readOnly = optionalBooleanField(config, 'readOnly', options);
  const explicitRequireDurablePersistence = optionalBooleanField(
    config,
    'requireDurablePersistence',
    options,
  );
  const requireDurablePersistence =
    explicitRequireDurablePersistence ?? defaultRequireDurablePersistence;

  return {
    providerSelection: {
      kind,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
      ...(principalScope !== undefined ? { principalScope } : {}),
      ...(readOnly !== undefined ? { readOnly } : {}),
      ...(requireDurablePersistence !== undefined ? { requireDurablePersistence } : {}),
    },
  };
}

function optionalStringField(
  config: Readonly<Record<string, unknown>> | null,
  field: string,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): string | undefined {
  const value = config?.[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        kindFromConfig(config),
        `versionStore.${field} must be a non-empty string when provided.`,
      ),
    );
  }
  const normalized = value.normalize('NFC');
  if (normalized.trim().length === 0 || utf8ByteLength(normalized) > 256) {
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        kindFromConfig(config),
        `versionStore.${field} must contain non-whitespace text and be at most 256 UTF-8 bytes when provided.`,
        { field },
      ),
    );
  }
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        kindFromConfig(config),
        `versionStore.${field} contains unsafe storage key material; ASCII control characters are not allowed.`,
        { field, category: 'storage-key' },
      ),
    );
  }
  return normalized;
}

function optionalBooleanField(
  config: Readonly<Record<string, unknown>> | null,
  field: string,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): boolean | undefined {
  const value = config?.[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        kindFromConfig(config),
        `versionStore.${field} must be a boolean when provided.`,
      ),
    );
  }
  return value;
}

function unsupportedVersionStoreDiagnostic(
  kind: string,
  config: Readonly<Record<string, unknown>> | null,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): MogSdkVersionStoreDiagnostic {
  const isNodeFile = isUnsupportedVersionStoreKind(kind);
  const safeMessage = isNodeFile
    ? 'Node durable file version stores are not supported by this SDK release.'
    : `Version store kind '${kind}' is not supported by this SDK release.`;
  const message = `${safeMessage} No in-memory fallback was selected; choose an explicit supported versionStore kind.`;
  return {
    code: 'MOG_SDK_VERSION_STORE_UNSUPPORTED',
    severity: 'error',
    runtime: options.runtime,
    requestedKind: kind,
    supportedKinds: MOG_SDK_SUPPORTED_VERSION_STORE_KINDS,
    safeMessage,
    message,
    details: {
      noFallbackToMemory: true,
      pathProvided: typeof config?.path === 'string',
    },
  };
}

function invalidVersionStoreDiagnostic(
  options: { readonly runtime: MogSdkVersionStoreRuntime },
  kind: string | undefined,
  message: string,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): MogSdkVersionStoreDiagnostic {
  return {
    code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
    severity: 'error',
    runtime: options.runtime,
    ...(kind !== undefined ? { requestedKind: kind } : {}),
    supportedKinds: MOG_SDK_SUPPORTED_VERSION_STORE_KINDS,
    safeMessage: message,
    message,
    ...(details !== undefined ? { details } : {}),
  };
}

function kindFromConfig(config: Readonly<Record<string, unknown>> | null): string | undefined {
  return typeof config?.kind === 'string' ? config.kind : undefined;
}

function isUnsupportedVersionStoreKind(kind: string): kind is MogSdkUnsupportedVersionStoreKind {
  return (MOG_SDK_UNSUPPORTED_VERSION_STORE_KINDS as readonly string[]).includes(kind);
}

function isSupportedVersionStoreKind(kind: string): kind is MogSdkSupportedVersionStoreKind {
  return (MOG_SDK_SUPPORTED_VERSION_STORE_KINDS as readonly string[]).includes(kind);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function hasOwnField(config: Readonly<Record<string, unknown>>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(config, field);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}
