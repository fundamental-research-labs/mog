import {
  createPublicVersionDomainSupportManifest,
  type DomainSupportManifest,
} from '@mog-sdk/contracts/versioning';

export const MOG_SDK_SUPPORTED_VERSION_STORE_KINDS = [
  'memory',
  'in-memory',
  'memory-durable-snapshot',
  'indexeddb',
  'browser',
] as const;

const NODE_FS_VERSION_STORE_KIND = ['node', 'fs'].join(':') as 'node:fs';

export const MOG_SDK_UNSUPPORTED_VERSION_STORE_KINDS = [
  'node-file',
  'nodeFile',
  'filesystem',
  'file-system',
  'node-filesystem',
  'nodeFileSystem',
  NODE_FS_VERSION_STORE_KIND,
  'fs',
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
  readonly category:
    | 'provider-identity'
    | 'provider-internal'
    | 'storage-key'
    | 'scope'
    | 'internal-source'
    | 'workspace-authority'
    | 'mode-overclaim'
    | 'stale-default-flag';
  readonly message: string;
};

function disallowedConfigFields(
  category: DisallowedVersionStoreConfigField['category'],
  fields: readonly string[],
  messageForField: (field: string) => string,
): Record<string, DisallowedVersionStoreConfigField> {
  return Object.fromEntries(
    fields.map((field) => [field, { category, message: messageForField(field) }]),
  );
}

const DISALLOWED_VERSION_STORE_CONFIG_FIELDS: Readonly<
  Record<string, DisallowedVersionStoreConfigField>
> = Object.freeze({
  accessContext: {
    category: 'provider-internal',
    message:
      'versionStore.accessContext is an internal provider field; SDK version-store config selects a provider kind, not a provider instance.',
  },
  openGraph: {
    category: 'provider-internal',
    message:
      'versionStore.openGraph is an internal provider method; SDK version-store config selects a provider kind, not a provider instance.',
  },
  readGraphRegistry: {
    category: 'provider-internal',
    message:
      'versionStore.readGraphRegistry is an internal provider method; SDK version-store config selects a provider kind, not a provider instance.',
  },
  initializeGraph: {
    category: 'provider-internal',
    message:
      'versionStore.initializeGraph is an internal provider method; SDK version-store config selects a provider kind, not a provider instance.',
  },
  commitGraphWrite: {
    category: 'provider-internal',
    message:
      'versionStore.commitGraphWrite is an internal provider method; SDK version-store config selects a provider kind, not a provider instance.',
  },
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
  ...disallowedConfigFields(
    'provider-identity',
    [
      'authorityRef',
      'providerAuthority',
      'providerKind',
      'providerRef',
      'providerHandle',
      'providerHandleId',
      'stableOriginId',
      'originKind',
      'roomId',
      'remoteSessionId',
      'syncIdentity',
      'updateIdentity',
      'providerEpoch',
      'epoch',
      'updateId',
      'sequence',
      'payloadHash',
      'trustStatus',
      'authorState',
    ],
    (field) =>
      `versionStore.${field} is host or remote provider provenance; SDK version-store config cannot assert it.`,
  ),
  ...disallowedConfigFields(
    'storage-key',
    [
      'storageKey',
      'storageKeyPrefix',
      'keyPrefix',
      'documentScopeKey',
      'namespaceKey',
      'namespacePrefix',
      'storageNamespace',
      'namespace',
      'graphId',
      'registryKey',
      'registryStorageKey',
      'refStorageKey',
      'objectStorageKey',
      'databaseName',
      'dbName',
      'indexedDbName',
      'indexedDBName',
      'objectStoreName',
      'objectStoreKey',
      'objectStorePrefix',
      'storeName',
    ],
    (field) =>
      `versionStore.${field} is unsafe storage key material; storage keys are derived from the validated document scope.`,
  ),
  ...disallowedConfigFields(
    'mode-overclaim',
    [
      'mode',
      'durability',
      'durabilityMode',
      'persistenceMode',
      'localFirst',
      'remoteBacked',
      'local',
      'remote',
      'sync',
      'syncMode',
      'collaboration',
      'collaborationMode',
      'liveCollaboration',
      'remoteProvider',
      'remoteProviderKind',
      'remoteProviderAttached',
      'pendingRemotePromotion',
      'remotePromote',
      'enableRemotePromote',
      'fallbackToMemory',
      'fallbackKind',
      'autoFallback',
    ],
    (field) =>
      `versionStore.${field} cannot claim local, local-first, remote-backed, or sync provider mode; select a supported kind instead.`,
  ),
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
  ...disallowedConfigFields(
    'workspace-authority',
    [
      'workspaceAuthority',
      'workspaceAuthorityRef',
      'tenantId',
      'tenantScope',
      'tenant',
      'organizationId',
      'orgId',
      'workspace',
      'workspaceRef',
      'remoteWorkspaceId',
      'remoteAuthority',
      'remoteAuthorityRef',
      'syncAuthority',
      'collaborationAuthority',
    ],
    (field) =>
      `versionStore.${field} is workspace authority material; SDK version-store config accepts only workspaceId as public scope.`,
  ),
  source: {
    category: 'internal-source',
    message:
      'versionStore.source is not version-store config; pass workbook import sources to createWorkbook options instead.',
  },
  documentRef: {
    category: 'internal-source',
    message:
      'versionStore.documentRef is an internal host source reference; source handles are created by the SDK host adapter.',
  },
  sourceKind: {
    category: 'internal-source',
    message:
      'versionStore.sourceKind is internal source provenance; source handles are created by the SDK host adapter.',
  },
  sourceHandleId: {
    category: 'internal-source',
    message:
      'versionStore.sourceHandleId is internal source-handle material; source handles are created by the SDK host adapter.',
  },
  sourceHostId: {
    category: 'internal-source',
    message:
      'versionStore.sourceHostId is internal host provenance; source handles are created by the SDK host adapter.',
  },
  sourceSessionId: {
    category: 'internal-source',
    message:
      'versionStore.sourceSessionId is internal host provenance; source handles are created by the SDK host adapter.',
  },
  issuerHostId: {
    category: 'internal-source',
    message:
      'versionStore.issuerHostId is internal source-handle material; source handles are created by the SDK host adapter.',
  },
  issuance: {
    category: 'internal-source',
    message:
      'versionStore.issuance is internal source-handle material; source handles are created by the SDK host adapter.',
  },
  resourceContext: {
    category: 'internal-source',
    message:
      'versionStore.resourceContext is internal host resource context; document scope is derived by the SDK host adapter.',
  },
  resourceContextFingerprint: {
    category: 'internal-source',
    message:
      'versionStore.resourceContextFingerprint is internal host resource context; document scope is derived by the SDK host adapter.',
  },
  principalFingerprint: {
    category: 'internal-source',
    message:
      'versionStore.principalFingerprint is internal host provenance; pass principal/security to createWorkbook options instead.',
  },
  operationAuthorization: {
    category: 'internal-source',
    message:
      'versionStore.operationAuthorization is an internal host authorization handoff; SDK callers cannot provide it.',
  },
  storage: {
    category: 'internal-source',
    message:
      'versionStore.storage is an internal host storage handoff; SDK version-store config only selects public storage behavior.',
  },
  sourceHandleResolvers: {
    category: 'internal-source',
    message:
      'versionStore.sourceHandleResolvers is an internal host resolver registry; SDK callers cannot provide it.',
  },
  replayRegistry: {
    category: 'internal-source',
    message:
      'versionStore.replayRegistry is an internal host replay registry; SDK callers cannot provide it.',
  },
  ...disallowedConfigFields(
    'stale-default-flag',
    [
      'enabled',
      'defaultOn',
      'defaultEnabled',
      'enabledByDefault',
      'enableVersioning',
      'enableVersionHistory',
      'enableVersionStore',
      'defaultVersioning',
      'enableDefaultVersioning',
      'rolloutStage',
      'featureStage',
      'gateStage',
      'gateId',
      'capabilityGate',
      'capabilityGates',
      'capabilityGateStage',
      'featureGate',
      'featureGates',
      'readFeatureGates',
      'controlPlane',
      'controlPlaneClient',
      'controlPlaneEntrypoints',
      'gate',
      'gateKey',
      'gateStatus',
      'casKey',
      'casToken',
      'expectedPriorCasToken',
      'defaultProvider',
      'defaultProviderKind',
      'defaultVersionStore',
    ],
    (field) =>
      `versionStore.${field} is stale default-on/control-plane state; omit versionStore or pass an explicit supported kind.`,
  ),
});

const BASE_SUPPORTED_VERSION_STORE_CONFIG_FIELDS = Object.freeze([
  'kind',
  'workspaceId',
  'principalScope',
  'readOnly',
  'requireDurablePersistence',
]);

const SUPPORTED_VERSION_STORE_CONFIG_FIELDS: Readonly<
  Record<MogSdkSupportedVersionStoreKind, ReadonlySet<string>>
> = Object.freeze({
  memory: new Set(BASE_SUPPORTED_VERSION_STORE_CONFIG_FIELDS),
  'in-memory': new Set(BASE_SUPPORTED_VERSION_STORE_CONFIG_FIELDS),
  'memory-durable-snapshot': new Set(BASE_SUPPORTED_VERSION_STORE_CONFIG_FIELDS),
  indexeddb: new Set(BASE_SUPPORTED_VERSION_STORE_CONFIG_FIELDS),
  browser: new Set([...BASE_SUPPORTED_VERSION_STORE_CONFIG_FIELDS, 'provider']),
});

const CANONICAL_SUPPORTED_VERSION_STORE_KIND_BY_ID: Readonly<
  Record<string, MogSdkSupportedVersionStoreKind>
> = Object.freeze({
  memory: 'memory',
  'in-memory': 'in-memory',
  inmemory: 'in-memory',
  'memory-durable-snapshot': 'memory-durable-snapshot',
  memorydurablesnapshot: 'memory-durable-snapshot',
  indexeddb: 'indexeddb',
  'indexed-db': 'indexeddb',
  browser: 'browser',
});

const WORKSPACE_AUTHORITY_REQUIRED_CONFIG_FIELDS: ReadonlySet<string> = new Set([
  'workspaceAuthority',
  'workspaceAuthorityRef',
  'tenantId',
  'tenantScope',
  'tenant',
  'organizationId',
  'orgId',
  'remote',
  'remoteBacked',
  'localFirst',
  'sync',
  'syncMode',
  'collaboration',
  'collaborationMode',
  'liveCollaboration',
  'remoteProviderAttached',
  'pendingRemotePromotion',
  'remotePromote',
  'enableRemotePromote',
]);

const WORKSPACE_AUTHORITY_REQUIRED_MODE_VALUES: ReadonlySet<string> = new Set([
  'remote',
  'remote-backed',
  'remoteBacked',
  'local-first',
  'localFirst',
  'provider-backed',
  'providerBacked',
  'workspace',
  'workspace-remote',
  'sync',
  'collaboration',
  'collab',
]);

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
  readonly domainSupportManifest: DomainSupportManifest;
}

export interface MogSdkVersionStoreLifecycleOptions {
  readonly runtime: MogSdkVersionStoreRuntime;
  readonly documentId?: string;
}

export function isMogSdkVersionStoreConfigError(
  value: unknown,
): value is MogSdkVersionStoreConfigError {
  return value instanceof MogSdkVersionStoreConfigError;
}

export function createSdkVersionStoreLifecycleConfig(
  versionStore: MogSdkVersionStoreConfig | undefined,
  options: MogSdkVersionStoreLifecycleOptions,
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
      optionalBrowserProviderField(parsed.config, options);
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
    assertCanonicalVersionStoreKind(versionStore, options);
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

  assertCanonicalVersionStoreKind(versionStore.kind, options);
  return { kind: versionStore.kind, config: versionStore };
}

function validateSupportedVersionStoreConfig(
  kind: MogSdkSupportedVersionStoreKind,
  config: Readonly<Record<string, unknown>> | null,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): void {
  if (config === null) return;

  validateWorkspaceAuthorityClaims(kind, config, options);

  for (const [field, fieldConfig] of Object.entries(DISALLOWED_VERSION_STORE_CONFIG_FIELDS)) {
    if (!hasOwnField(config, field)) continue;
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(options, kind, fieldConfig.message, {
        field,
        category: fieldConfig.category,
      }),
    );
  }

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

  const allowedFields = SUPPORTED_VERSION_STORE_CONFIG_FIELDS[kind];
  for (const field of Object.keys(config)) {
    if (allowedFields.has(field)) continue;
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        kind,
        `versionStore.${field} is not a supported ${kind} version-store config field.`,
        { field, category: 'unsupported-field' },
      ),
    );
  }
}

function validateWorkspaceAuthorityClaims(
  kind: MogSdkSupportedVersionStoreKind,
  config: Readonly<Record<string, unknown>>,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): void {
  if (hasUsableWorkspaceId(config)) return;

  const claimedField = firstWorkspaceAuthorityClaimField(config);
  if (claimedField === null) return;

  throw new MogSdkVersionStoreConfigError(
    invalidVersionStoreDiagnostic(
      options,
      kind,
      `versionStore.${claimedField} claims workspace or remote authority, but versionStore.workspaceId is missing.`,
      { field: 'workspaceId', category: 'workspace-authority', claimedField },
    ),
  );
}

function firstWorkspaceAuthorityClaimField(
  config: Readonly<Record<string, unknown>>,
): string | null {
  for (const field of WORKSPACE_AUTHORITY_REQUIRED_CONFIG_FIELDS) {
    if (hasOwnField(config, field) && isAuthorityClaimValue(config[field])) {
      return field;
    }
  }

  for (const field of ['mode', 'durability', 'durabilityMode', 'persistenceMode'] as const) {
    const value = config[field];
    if (typeof value !== 'string') continue;
    if (WORKSPACE_AUTHORITY_REQUIRED_MODE_VALUES.has(value.normalize('NFC'))) return field;
  }

  return null;
}

function isAuthorityClaimValue(value: unknown): boolean {
  return value !== false && value !== null && value !== undefined;
}

function lifecycleConfig(
  kind: MogSdkVersionStoreLifecycleProviderSelection['kind'],
  config: Readonly<Record<string, unknown>> | null,
  options: MogSdkVersionStoreLifecycleOptions,
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
    domainSupportManifest: createPublicVersionDomainSupportManifest(
      options.documentId ? { workbookId: options.documentId } : {},
    ),
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

function optionalBrowserProviderField(
  config: Readonly<Record<string, unknown>> | null,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): 'indexeddb' | undefined {
  const value = config?.provider;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        kindFromConfig(config),
        "versionStore.provider must be the provider kind string 'indexeddb' when provided.",
        { field: 'provider', category: 'provider-identity' },
      ),
    );
  }
  const provider = value.normalize('NFC');
  if (provider !== 'indexeddb') {
    throw new MogSdkVersionStoreConfigError(
      invalidVersionStoreDiagnostic(
        options,
        kindFromConfig(config),
        "versionStore.provider must use canonical provider id 'indexeddb'.",
        { field: 'provider', category: 'provider-identity', canonicalProvider: 'indexeddb' },
      ),
    );
  }
  return provider;
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
    : 'The requested version store kind is not supported by this SDK release.';
  const message = `${safeMessage} No in-memory fallback was selected; choose an explicit supported versionStore kind.`;
  return {
    code: 'MOG_SDK_VERSION_STORE_UNSUPPORTED',
    severity: 'error',
    runtime: options.runtime,
    ...(isKnownPublicVersionStoreKind(kind) ? { requestedKind: kind } : {}),
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

function assertCanonicalVersionStoreKind(
  kind: string,
  options: { readonly runtime: MogSdkVersionStoreRuntime },
): void {
  const canonicalKind = canonicalSupportedVersionStoreKindFor(kind);
  if (canonicalKind === undefined || kind === canonicalKind) return;

  throw new MogSdkVersionStoreConfigError(
    invalidVersionStoreDiagnostic(
      options,
      kind,
      `versionStore.kind must use canonical provider id '${canonicalKind}'.`,
      { field: 'kind', category: 'provider-identity', canonicalKind },
    ),
  );
}

function canonicalSupportedVersionStoreKindFor(
  kind: string,
): MogSdkSupportedVersionStoreKind | undefined {
  return CANONICAL_SUPPORTED_VERSION_STORE_KIND_BY_ID[canonicalKindLookupId(kind)];
}

function canonicalKindLookupId(kind: string): string {
  return kind
    .normalize('NFC')
    .trim()
    .replace(/[\s_]+/gu, '-')
    .toLowerCase();
}

function isUnsupportedVersionStoreKind(kind: string): kind is MogSdkUnsupportedVersionStoreKind {
  return (MOG_SDK_UNSUPPORTED_VERSION_STORE_KINDS as readonly string[]).includes(kind);
}

function isSupportedVersionStoreKind(kind: string): kind is MogSdkSupportedVersionStoreKind {
  return (MOG_SDK_SUPPORTED_VERSION_STORE_KINDS as readonly string[]).includes(kind);
}

function isKnownPublicVersionStoreKind(kind: string): boolean {
  return isSupportedVersionStoreKind(kind) || isUnsupportedVersionStoreKind(kind);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function hasOwnField(config: Readonly<Record<string, unknown>>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(config, field);
}

function hasUsableWorkspaceId(config: Readonly<Record<string, unknown>>): boolean {
  const value = config.workspaceId;
  if (typeof value !== 'string' || value.length === 0) return false;
  const normalized = value.normalize('NFC');
  return (
    normalized.trim().length > 0 &&
    utf8ByteLength(normalized) <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(normalized)
  );
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
