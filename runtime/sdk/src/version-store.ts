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
  return value;
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
): MogSdkVersionStoreDiagnostic {
  return {
    code: 'MOG_SDK_VERSION_STORE_INVALID_CONFIG',
    severity: 'error',
    runtime: options.runtime,
    ...(kind !== undefined ? { requestedKind: kind } : {}),
    supportedKinds: MOG_SDK_SUPPORTED_VERSION_STORE_KINDS,
    safeMessage: message,
    message,
  };
}

function kindFromConfig(config: Readonly<Record<string, unknown>> | null): string | undefined {
  return typeof config?.kind === 'string' ? config.kind : undefined;
}

function isUnsupportedVersionStoreKind(kind: string): kind is MogSdkUnsupportedVersionStoreKind {
  return (MOG_SDK_UNSUPPORTED_VERSION_STORE_KINDS as readonly string[]).includes(kind);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
