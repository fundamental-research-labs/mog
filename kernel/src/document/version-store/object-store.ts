import {
  VersionObjectDigestError,
  canonicalizeVersionDependencies,
  isVersionObjectType,
  parseObjectDigest,
  type ObjectDigest,
  type VersionDependencyRef,
  type VersionObjectDigestIssue,
  type VersionObjectType,
} from './object-digest';

export const VERSION_OBJECT_PREIMAGE_DOMAIN = 'mog.version-object.v1\n';
export const VERSION_OBJECT_SCHEMA_VERSION = 1;

export type VersionGraphNamespace = {
  readonly workspaceId?: string;
  readonly documentId: string;
  readonly graphId: string;
  readonly principalScope?: string;
};

export type VersionObjectPayloadEncoding = 'mog-canonical-json-v1' | 'bytes';

export type VersionObjectPreimage<TPayload> = {
  readonly objectType: VersionObjectType;
  readonly schemaVersion: typeof VERSION_OBJECT_SCHEMA_VERSION;
  readonly payloadEncoding: VersionObjectPayloadEncoding;
  readonly dependencies: readonly VersionDependencyRef[];
  readonly payload: TPayload;
};

export type VersionObjectRecord<TPayload> = {
  readonly namespace: VersionGraphNamespace;
  readonly preimage: VersionObjectPreimage<TPayload>;
  readonly digest: ObjectDigest;
  readonly payloadByteLength: number;
  readonly preimageByteLength: number;
};

export type VersionObjectStoreDiagnosticCode =
  | VersionObjectDigestIssue
  | 'VERSION_INVALID_NAMESPACE'
  | 'VERSION_WRONG_NAMESPACE'
  | 'VERSION_INVALID_PREIMAGE'
  | 'VERSION_UNSUPPORTED_SCHEMA'
  | 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING'
  | 'VERSION_INVALID_PAYLOAD'
  | 'VERSION_BYTE_LENGTH_MISMATCH'
  | 'VERSION_MISSING_DEPENDENCY'
  | 'VERSION_OBJECT_CORRUPTION'
  | 'VERSION_OBJECT_NOT_FOUND'
  | 'VERSION_OBJECT_TYPE_MISMATCH'
  | 'VERSION_STORE_UNAVAILABLE';

export type VersionObjectStoreDiagnostic = {
  readonly code: VersionObjectStoreDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly namespace?: VersionGraphNamespace;
  readonly digest?: ObjectDigest;
  readonly objectType?: VersionObjectType;
  readonly dependency?: VersionDependencyRef;
  readonly path?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type VersionObjectPutBatchSuccess = {
  readonly status: 'success';
  readonly records: readonly VersionObjectRecord<unknown>[];
  readonly diagnostics: readonly [];
};

export type VersionObjectPutBatchFailure = {
  readonly status: 'failed';
  readonly diagnostics: readonly VersionObjectStoreDiagnostic[];
  readonly mutationGuarantee: 'no-objects-written';
};

export type VersionObjectPutBatchResult = VersionObjectPutBatchSuccess | VersionObjectPutBatchFailure;

export interface VersionObjectStore {
  readonly namespace: VersionGraphNamespace;
  putObjects(batch: readonly VersionObjectRecord<unknown>[]): Promise<VersionObjectPutBatchResult>;
  getObject<TPayload>(ref: VersionDependencyRef): Promise<TPayload>;
  getObjectRecord<TPayload>(ref: VersionDependencyRef): Promise<VersionObjectRecord<TPayload>>;
  hasObject(ref: VersionDependencyRef): Promise<boolean>;
}

export class VersionObjectStoreError extends Error {
  readonly diagnostic: VersionObjectStoreDiagnostic;

  constructor(diagnostic: VersionObjectStoreDiagnostic) {
    super(diagnostic.message);
    this.name = 'VersionObjectStoreError';
    this.diagnostic = diagnostic;
  }
}

class VersionObjectStoreValidationError extends Error {
  readonly diagnostic: VersionObjectStoreDiagnostic;

  constructor(diagnostic: VersionObjectStoreDiagnostic) {
    super(diagnostic.message);
    this.name = 'VersionObjectStoreValidationError';
    this.diagnostic = diagnostic;
  }
}

export class VersionObjectMemoryBackend {
  private readonly records = new Map<string, VersionObjectRecord<unknown>>();

  get(namespace: VersionGraphNamespace, digest: ObjectDigest): VersionObjectRecord<unknown> | undefined {
    return this.records.get(versionObjectStorageKey(namespace, digest));
  }
  put(record: VersionObjectRecord<unknown>): void {
    this.records.set(
      versionObjectStorageKey(record.namespace, record.digest),
      cloneVersionObjectRecord(record),
    );
  }
  list(namespace: VersionGraphNamespace): readonly VersionObjectRecord<unknown>[] {
    const prefix = `${versionGraphNamespaceKey(namespace)}\u0000`;
    const out = [...this.records.entries()]
      .filter(([key, record]) => key.startsWith(prefix) && recordBelongsToNamespace(namespace, record))
      .map(([, record]) => cloneVersionObjectRecord(record));
    return Object.freeze(
      out.sort((left, right) => left.digest.digest.localeCompare(right.digest.digest)),
    );
  }
  putCorruptRecordForTesting(
    namespace: VersionGraphNamespace,
    digest: ObjectDigest,
    record: VersionObjectRecord<unknown>,
  ): void {
    this.records.set(versionObjectStorageKey(namespace, parseObjectDigest(digest)), cloneVersionObjectRecord(record));
  }
}

export type InMemoryVersionObjectStoreOptions = {
  readonly backend?: VersionObjectMemoryBackend;
};
export class InMemoryVersionObjectStore implements VersionObjectStore {
  readonly namespace: VersionGraphNamespace;
  private readonly backend: VersionObjectMemoryBackend;
  private readonly namespaceKey: string;

  constructor(namespace: VersionGraphNamespace, options: InMemoryVersionObjectStoreOptions = {}) {
    this.namespace = normalizeVersionGraphNamespace(namespace);
    this.namespaceKey = versionGraphNamespaceKey(this.namespace);
    this.backend = options.backend ?? new VersionObjectMemoryBackend();
  }
  async putObjects(batch: readonly VersionObjectRecord<unknown>[]): Promise<VersionObjectPutBatchResult> {
    if (!Array.isArray(batch)) {
      return failedBatch([
        diagnostic('VERSION_INVALID_PREIMAGE', 'putObjects batch must be an array.', {
          path: 'batch',
        }),
      ]);
    }
    const staged = new Map<string, ValidatedVersionObjectRecord<unknown>>();
    const diagnostics: VersionObjectStoreDiagnostic[] = [];

    for (let index = 0; index < batch.length; index++) {
      const record = batch[index];
      try {
        const namespace = normalizeVersionGraphNamespace(
          record.namespace,
          `batch[${index}].namespace`,
        );
        if (versionGraphNamespaceKey(namespace) !== this.namespaceKey) {
          throwValidation(
            'VERSION_WRONG_NAMESPACE',
            'Version object record namespace does not match this store namespace.',
            {
              path: `batch[${index}].namespace`,
              details: { namespace: 'redacted' },
            },
          );
        }

        const digest = parseObjectDigest(record.digest, `batch[${index}].digest`);
        const duplicate = staged.get(digest.digest);
        if (duplicate) {
          if (!versionObjectRecordsMatch(duplicate.record, record)) {
            throwValidation(
              'VERSION_OBJECT_CORRUPTION',
              'Batch contains two different records for the same digest.',
              {
                digest,
                path: `batch[${index}]`,
                severity: 'corruption',
              },
            );
          }
          continue;
        }

        const validated = await validateVersionObjectRecord(record, `batch[${index}]`);
        const existing = this.backend.get(this.namespace, validated.record.digest);
        if (existing && !versionObjectRecordsMatch(existing, validated.record)) {
          throwValidation(
            'VERSION_OBJECT_CORRUPTION',
            'Existing object digest is already bound to a different record.',
            {
              namespace,
              digest: validated.record.digest,
              path: `batch[${index}]`,
              severity: 'corruption',
            },
          );
        }

        const key = validated.record.digest.digest;
        staged.set(key, validated);
      } catch (error) {
        diagnostics.push(diagnosticFromError(error));
      }
    }

    if (diagnostics.length > 0) {
      return failedBatch(diagnostics);
    }

    for (const stagedRecord of staged.values()) {
      for (const dependency of stagedRecord.dependencies) {
        const sameBatchDependency = staged.get(dependency.digest.digest);
        const satisfiedByBatch = Boolean(
          sameBatchDependency &&
            dependencyMatchesRecord(this.namespace, dependency, sameBatchDependency.record),
        );
        const satisfiedByStore = hasDependencyRecord(this.backend, this.namespace, dependency);
        if (!satisfiedByBatch && !satisfiedByStore) {
          diagnostics.push(missingDependencyDiagnostic(stagedRecord.record, dependency));
        }
      }
    }

    if (diagnostics.length > 0) {
      return failedBatch(diagnostics);
    }

    const records = [...staged.values()].map((entry) => entry.record);
    for (const record of records) {
      this.backend.put(record);
    }

    return {
      status: 'success',
      records: Object.freeze(records.map(cloneVersionObjectRecord)),
      diagnostics: [],
    };
  }

  async getObject<TPayload>(ref: VersionDependencyRef): Promise<TPayload> {
    const record = await this.getObjectRecord<TPayload>(ref);
    return clonePayload(record.preimage.payload) as TPayload;
  }

  async getObjectRecord<TPayload>(ref: VersionDependencyRef): Promise<VersionObjectRecord<TPayload>> {
    const dependency = parseSingleDependencyRef(ref, 'ref');
    const record = this.backend.get(this.namespace, dependency.digest);
    if (!record) {
      throw new VersionObjectStoreError(
        diagnostic('VERSION_OBJECT_NOT_FOUND', 'Version object was not found in this namespace.', {
          namespace: this.namespace,
          digest: dependency.digest,
          dependency,
        }),
      );
    }

    if (!objectDigestsEqual(record.digest, dependency.digest)) {
      throw new VersionObjectStoreError(
        diagnostic(
          'VERSION_OBJECT_CORRUPTION',
          'Stored version object digest does not match the requested storage key.',
          {
            namespace: this.namespace,
            digest: dependency.digest,
            objectType: record.preimage.objectType,
            dependency,
            severity: 'corruption',
          },
        ),
      );
    }

    if (!recordBelongsToNamespace(this.namespace, record)) {
      throw new VersionObjectStoreError(
        diagnostic(
          'VERSION_OBJECT_CORRUPTION',
          'Stored version object namespace does not match the requested store namespace.',
          {
            namespace: this.namespace,
            digest: dependency.digest,
            objectType: record.preimage.objectType,
            dependency,
            severity: 'corruption',
          },
        ),
      );
    }

    if (!dependencyMatchesRecord(this.namespace, dependency, record)) {
      throw new VersionObjectStoreError(
        diagnostic(
          'VERSION_OBJECT_TYPE_MISMATCH',
          'Version dependency ref does not match stored object type.',
          {
            namespace: this.namespace,
            digest: dependency.digest,
            objectType: record.preimage.objectType,
            dependency,
          },
        ),
      );
    }

    try {
      const validated = await validateVersionObjectRecord(record, 'storedRecord');
      return cloneVersionObjectRecord(validated.record) as VersionObjectRecord<TPayload>;
    } catch (error) {
      throw new VersionObjectStoreError(
        diagnostic('VERSION_OBJECT_CORRUPTION', 'Stored version object record failed validation.', {
          namespace: this.namespace,
          digest: record.digest,
          objectType: record.preimage.objectType,
          severity: 'corruption',
          details: { cause: diagnosticFromError(error).code },
        }),
      );
    }
  }

  async hasObject(ref: VersionDependencyRef): Promise<boolean> {
    const dependency = parseSingleDependencyRef(ref, 'ref');
    const record = this.backend.get(this.namespace, dependency.digest);
    return Boolean(record && dependencyMatchesRecord(this.namespace, dependency, record));
  }
  listObjectRecords(): readonly VersionObjectRecord<unknown>[] {
    return this.backend.list(this.namespace);
  }
  putCorruptRecordForTesting(digest: ObjectDigest, record: VersionObjectRecord<unknown>): void {
    this.backend.putCorruptRecordForTesting(this.namespace, digest, record);
  }
}

export function createInMemoryVersionObjectStore(namespace: VersionGraphNamespace, options?: InMemoryVersionObjectStoreOptions): InMemoryVersionObjectStore {
  return new InMemoryVersionObjectStore(namespace, options);
}

export async function createVersionObjectRecord<TPayload>(namespace: VersionGraphNamespace, preimage: VersionObjectPreimage<TPayload>): Promise<VersionObjectRecord<TPayload>> {
  const normalizedNamespace = normalizeVersionGraphNamespace(namespace);
  const encoded = encodeVersionObjectPreimage(preimage);
  const digest = await sha256ObjectDigest(encoded.preimageBytes);

  return cloneVersionObjectRecord({
    namespace: normalizedNamespace,
    preimage: encoded.preimage as VersionObjectPreimage<TPayload>,
    digest,
    payloadByteLength: encoded.payloadBytes.byteLength,
    preimageByteLength: encoded.preimageBytes.byteLength,
  }) as VersionObjectRecord<TPayload>;
}

export function encodeVersionObjectPreimage<TPayload>(preimage: VersionObjectPreimage<TPayload>): {
  readonly preimage: VersionObjectPreimage<unknown>;
  readonly dependencies: readonly VersionDependencyRef[];
  readonly payloadBytes: Uint8Array;
  readonly preimageBytes: Uint8Array;
} {
  if (!isPlainRecord(preimage)) {
    throwValidation('VERSION_INVALID_PREIMAGE', 'Version object preimage must be an object.');
  }

  if (!isVersionObjectType(preimage.objectType)) {
    throwValidation('VERSION_UNSUPPORTED_OBJECT_TYPE', 'Version object type is not supported.', {
      objectType:
        typeof preimage.objectType === 'string'
          ? (preimage.objectType as VersionObjectType)
          : undefined,
      path: 'preimage.objectType',
    });
  }

  if (preimage.schemaVersion !== VERSION_OBJECT_SCHEMA_VERSION) {
    throwValidation(
      'VERSION_UNSUPPORTED_SCHEMA',
      'Version object schema version is not supported.',
      {
        objectType: preimage.objectType,
        path: 'preimage.schemaVersion',
        details: {
          expected: VERSION_OBJECT_SCHEMA_VERSION,
          received: String(preimage.schemaVersion),
        },
      },
    );
  }

  if (preimage.payloadEncoding !== 'mog-canonical-json-v1' && preimage.payloadEncoding !== 'bytes') {
    throwValidation(
      'VERSION_UNSUPPORTED_PAYLOAD_ENCODING',
      'Version object payload encoding is not supported.',
      {
        objectType: preimage.objectType,
        path: 'preimage.payloadEncoding',
        details: { received: String(preimage.payloadEncoding) },
      },
    );
  }

  const dependencies = canonicalizeVersionDependencies(preimage.dependencies);
  const canonicalPayload =
    preimage.payloadEncoding === 'bytes'
      ? cloneBytesPayload(preimage.payload, 'preimage.payload')
      : normalizeCanonicalJsonValue(preimage.payload, 'preimage.payload');
  const payloadBytes =
    preimage.payloadEncoding === 'bytes'
      ? (canonicalPayload as Uint8Array)
      : utf8Encode(canonicalJsonStringify(canonicalPayload));
  const dependencyBytes = utf8Encode(canonicalJsonStringify(dependencies));
  const preimageBytes = concatBytes(
    utf8Encode(VERSION_OBJECT_PREIMAGE_DOMAIN),
    utf8Encode(`${preimage.objectType}\n`),
    utf8Encode(`${preimage.schemaVersion}\n`),
    utf8Encode(`${preimage.payloadEncoding}\n`),
    dependencyBytes,
    utf8Encode('\n'),
    payloadBytes,
  );

  return Object.freeze({
    preimage: Object.freeze({
      objectType: preimage.objectType,
      schemaVersion: preimage.schemaVersion,
      payloadEncoding: preimage.payloadEncoding,
      dependencies,
      payload: canonicalPayload,
    }),
    dependencies,
    payloadBytes,
    preimageBytes,
  });
}

export function normalizeVersionGraphNamespace(namespace: VersionGraphNamespace, path = 'namespace'): VersionGraphNamespace {
  if (!isPlainRecord(namespace)) {
    throwValidation('VERSION_INVALID_NAMESPACE', 'Version graph namespace must be an object.', {
      path,
    });
  }

  assertAllowedKeys(namespace, ['workspaceId', 'documentId', 'graphId', 'principalScope'], path);

  return Object.freeze({
    ...(namespace.workspaceId === undefined
      ? {}
      : { workspaceId: normalizeNamespaceString(namespace.workspaceId, `${path}.workspaceId`) }),
    documentId: normalizeNamespaceString(namespace.documentId, `${path}.documentId`),
    graphId: normalizeNamespaceString(namespace.graphId, `${path}.graphId`),
    ...(namespace.principalScope === undefined
      ? {}
      : { principalScope: normalizeNamespaceString(namespace.principalScope, `${path}.principalScope`) }),
  });
}

export function versionGraphNamespaceKey(namespace: VersionGraphNamespace): string {
  const normalized = normalizeVersionGraphNamespace(namespace);
  return canonicalJsonStringify({
    workspaceId: normalized.workspaceId ?? null,
    documentId: normalized.documentId,
    graphId: normalized.graphId,
    principalScope: normalized.principalScope ?? null,
  });
}

type ValidatedVersionObjectRecord<TPayload> = {
  readonly record: VersionObjectRecord<TPayload>;
  readonly dependencies: readonly VersionDependencyRef[];
};

async function validateVersionObjectRecord<TPayload>(record: VersionObjectRecord<TPayload>, path: string): Promise<ValidatedVersionObjectRecord<TPayload>> {
  if (!isPlainRecord(record)) {
    throwValidation('VERSION_INVALID_PREIMAGE', 'Version object record must be an object.', {
      path,
    });
  }

  const namespace = normalizeVersionGraphNamespace(record.namespace, `${path}.namespace`);
  const digest = parseObjectDigest(record.digest, `${path}.digest`);
  assertNonNegativeSafeInteger(record.payloadByteLength, `${path}.payloadByteLength`, 'VERSION_BYTE_LENGTH_MISMATCH');
  assertNonNegativeSafeInteger(record.preimageByteLength, `${path}.preimageByteLength`, 'VERSION_BYTE_LENGTH_MISMATCH');

  const encoded = encodeVersionObjectPreimage(record.preimage);
  const expectedDigest = await sha256ObjectDigest(encoded.preimageBytes);
  if (digest.digest !== expectedDigest.digest) {
    throwValidation('VERSION_DIGEST_MISMATCH', 'Version object digest does not match preimage.', {
      namespace,
      digest,
      objectType: encoded.preimage.objectType,
      path: `${path}.digest`,
      details: { expected: expectedDigest.digest, received: digest.digest },
    });
  }

  if (
    record.payloadByteLength !== encoded.payloadBytes.byteLength ||
    record.preimageByteLength !== encoded.preimageBytes.byteLength
  ) {
    throwValidation(
      'VERSION_BYTE_LENGTH_MISMATCH',
      'Version object byte length metadata does not match canonical bytes.',
      {
        namespace,
        digest,
        objectType: encoded.preimage.objectType,
        path,
        details: {
          expectedPayloadByteLength: encoded.payloadBytes.byteLength,
          receivedPayloadByteLength: record.payloadByteLength,
          expectedPreimageByteLength: encoded.preimageBytes.byteLength,
          receivedPreimageByteLength: record.preimageByteLength,
        },
      },
    );
  }

  return Object.freeze({
    record: cloneVersionObjectRecord({
      namespace,
      preimage: encoded.preimage as VersionObjectPreimage<TPayload>,
      digest,
      payloadByteLength: encoded.payloadBytes.byteLength,
      preimageByteLength: encoded.preimageBytes.byteLength,
    }),
    dependencies: encoded.dependencies,
  });
}

function failedBatch(diagnostics: readonly VersionObjectStoreDiagnostic[]): VersionObjectPutBatchFailure {
  return Object.freeze({
    status: 'failed',
    diagnostics: Object.freeze([...diagnostics]),
    mutationGuarantee: 'no-objects-written',
  });
}

function hasDependencyRecord(
  backend: VersionObjectMemoryBackend,
  namespace: VersionGraphNamespace,
  dependency: VersionDependencyRef,
): boolean {
  const record = backend.get(namespace, dependency.digest);
  return Boolean(record && dependencyMatchesRecord(namespace, dependency, record));
}

function missingDependencyDiagnostic(
  record: VersionObjectRecord<unknown>,
  dependency: VersionDependencyRef,
): VersionObjectStoreDiagnostic {
  const details: Readonly<Record<string, string>> =
    dependency.kind === 'object'
      ? { dependencyKind: dependency.kind, dependencyObjectType: dependency.objectType }
      : { dependencyKind: dependency.kind };
  return diagnostic('VERSION_MISSING_DEPENDENCY', 'Version object dependency is missing.', {
    objectType: record.preimage.objectType,
    details,
  });
}

function dependencyMatchesRecord(
  namespace: VersionGraphNamespace,
  dependency: VersionDependencyRef,
  record: VersionObjectRecord<unknown>,
): boolean {
  if (!recordBelongsToNamespace(namespace, record)) {
    return false;
  }
  if (!objectDigestsEqual(record.digest, dependency.digest)) {
    return false;
  }
  if (dependency.kind === 'object') {
    return record.preimage.objectType === dependency.objectType;
  }
  return record.preimage.objectType === 'workbook.commit.v1';
}

function objectDigestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function recordBelongsToNamespace(
  namespace: VersionGraphNamespace,
  record: VersionObjectRecord<unknown>,
): boolean {
  try {
    return versionGraphNamespaceKey(record.namespace) === versionGraphNamespaceKey(namespace);
  } catch {
    return false;
  }
}

function parseSingleDependencyRef(value: VersionDependencyRef, path: string): VersionDependencyRef {
  try {
    return canonicalizeVersionDependencies([value])[0];
  } catch (error) {
    throw new VersionObjectStoreError(diagnosticFromError(error, path));
  }
}

function versionObjectRecordsMatch(
  left: VersionObjectRecord<unknown>,
  right: VersionObjectRecord<unknown>,
): boolean {
  try {
    return versionObjectRecordIdentity(left) === versionObjectRecordIdentity(right);
  } catch {
    return false;
  }
}

function versionObjectRecordIdentity(record: VersionObjectRecord<unknown>): string {
  const encoded = encodeVersionObjectPreimage(record.preimage);
  return canonicalJsonStringify({
    namespace: versionGraphNamespaceKey(record.namespace),
    digest: record.digest,
    objectType: encoded.preimage.objectType,
    schemaVersion: encoded.preimage.schemaVersion,
    payloadEncoding: encoded.preimage.payloadEncoding,
    dependencies: encoded.dependencies,
    payloadByteLength: record.payloadByteLength,
    preimageByteLength: record.preimageByteLength,
    payloadBytesHex: bytesToHex(encoded.payloadBytes),
    preimageBytesHex: bytesToHex(encoded.preimageBytes),
  });
}

function versionObjectStorageKey(namespace: VersionGraphNamespace, digest: ObjectDigest): string {
  return `${versionGraphNamespaceKey(namespace)}\u0000${digest.algorithm}\u0000${digest.digest}`;
}

function diagnosticFromError(error: unknown, path?: string): VersionObjectStoreDiagnostic {
  if (error instanceof VersionObjectStoreValidationError) {
    return error.diagnostic;
  }
  if (error instanceof VersionObjectStoreError) {
    return error.diagnostic;
  }
  if (error instanceof VersionObjectDigestError) {
    return diagnostic(error.issue, error.message, { path });
  }
  if (error instanceof Error) {
    return diagnostic('VERSION_INVALID_PREIMAGE', error.message, { path });
  }
  return diagnostic('VERSION_INVALID_PREIMAGE', 'Version object validation failed.', { path });
}

function diagnostic(
  code: VersionObjectStoreDiagnosticCode,
  message: string,
  options: DiagnosticOptions = {},
): VersionObjectStoreDiagnostic {
  return Object.freeze({
    code,
    severity: options.severity ?? (code === 'VERSION_OBJECT_CORRUPTION' ? 'corruption' : 'error'),
    message,
    ...(options.namespace ? { namespace: options.namespace } : {}),
    ...(options.digest ? { digest: options.digest } : {}),
    ...(options.objectType ? { objectType: options.objectType } : {}),
    ...(options.dependency ? { dependency: options.dependency } : {}),
    ...(options.path ? { path: options.path } : {}),
    ...(options.details ? { details: options.details } : {}),
  });
}

function throwValidation(code: VersionObjectStoreDiagnosticCode, message: string, options: DiagnosticOptions = {}): never {
  throw new VersionObjectStoreValidationError(diagnostic(code, message, options));
}

type DiagnosticOptions = {
  readonly namespace?: VersionGraphNamespace;
  readonly digest?: ObjectDigest;
  readonly objectType?: VersionObjectType;
  readonly dependency?: VersionDependencyRef;
  readonly path?: string;
  readonly severity?: 'error' | 'corruption';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

function normalizeNamespaceString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throwValidation(
      'VERSION_INVALID_NAMESPACE',
      'Version graph namespace fields must be strings.',
      {
        path,
      },
    );
  }
  const normalized = value.normalize('NFC');
  if (normalized.length === 0 || utf8Encode(normalized).byteLength > 256) {
    throwValidation(
      'VERSION_INVALID_NAMESPACE',
      'Version graph namespace fields must be non-empty and at most 256 UTF-8 bytes.',
      { path },
    );
  }
  return normalized;
}

function assertAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[], path: string): void {
  const unsupportedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unsupportedKey) {
    throwValidation(
      'VERSION_INVALID_NAMESPACE',
      'Version graph namespace has an unsupported field.',
      {
        path: `${path}.${unsupportedKey}`,
        details: { field: unsupportedKey },
      },
    );
  }
}

function assertNonNegativeSafeInteger(
  value: unknown,
  path: string,
  code: VersionObjectStoreDiagnosticCode,
): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throwValidation(code, 'Version object byte lengths must be non-negative safe integers.', {
      path,
      details: { received: String(value) },
    });
  }
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function normalizeCanonicalJsonValue(value: unknown, path: string): CanonicalJsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throwValidation('VERSION_INVALID_PAYLOAD', 'Canonical JSON numbers must be finite.', {
        path,
      });
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throwValidation('VERSION_INVALID_PAYLOAD', 'Canonical JSON integers must be safe integers.', {
        path,
      });
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    const normalizedArray: CanonicalJsonValue[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throwValidation(
          'VERSION_INVALID_PAYLOAD',
          'Canonical JSON arrays must not contain holes.',
          {
            path: `${path}[${index}]`,
          },
        );
      }
      normalizedArray.push(normalizeCanonicalJsonValue(value[index], `${path}[${index}]`));
    }
    return Object.freeze(normalizedArray);
  }

  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throwValidation(
      'VERSION_INVALID_PAYLOAD',
      'Canonical JSON payload contains unsupported values.',
      {
        path,
      },
    );
  }

  if (!isPlainRecord(value)) {
    throwValidation('VERSION_INVALID_PAYLOAD', 'Canonical JSON payload must use plain objects.', {
      path,
    });
  }

  const normalizedEntries: Array<readonly [string, CanonicalJsonValue]> = [];
  const seen = new Set<string>();
  for (const [key, childValue] of Object.entries(value)) {
    if (typeof childValue === 'undefined') {
      throwValidation(
        'VERSION_INVALID_PAYLOAD',
        'Canonical JSON objects must not contain undefined.',
        {
          path: `${path}.${key}`,
        },
      );
    }
    const normalizedKey = key.normalize('NFC');
    if (seen.has(normalizedKey)) {
      throwValidation(
        'VERSION_INVALID_PAYLOAD',
        'Canonical JSON object has duplicate keys after NFC normalization.',
        {
          path,
          details: { key: normalizedKey },
        },
      );
    }
    seen.add(normalizedKey);
    normalizedEntries.push([
      normalizedKey,
      normalizeCanonicalJsonValue(childValue, `${path}.${normalizedKey}`),
    ]);
  }
  normalizedEntries.sort(([left], [right]) => compareCodePointStrings(left, right));

  const normalizedRecord: Record<string, CanonicalJsonValue> = {};
  for (const [key, childValue] of normalizedEntries) {
    normalizedRecord[key] = childValue;
  }
  return Object.freeze(normalizedRecord);
}

function canonicalJsonStringify(value: CanonicalJsonValue | unknown): string {
  const canonicalValue = normalizeCanonicalJsonValue(value, 'value');

  if (canonicalValue === null) {
    return 'null';
  }
  if (typeof canonicalValue === 'string') {
    return JSON.stringify(canonicalValue);
  }
  if (typeof canonicalValue === 'number') {
    return JSON.stringify(canonicalValue);
  }
  if (typeof canonicalValue === 'boolean') {
    return canonicalValue ? 'true' : 'false';
  }
  if (Array.isArray(canonicalValue)) {
    return `[${canonicalValue.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(canonicalValue).sort(([left], [right]) =>
    compareCodePointStrings(left, right),
  );
  return `{${entries
    .map(([key, childValue]) => `${JSON.stringify(key)}:${canonicalJsonStringify(childValue)}`)
    .join(',')}}`;
}

function compareCodePointStrings(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index++) {
    const leftPoint = leftPoints[index].codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index].codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
  }
  return leftPoints.length - rightPoints.length;
}

function cloneBytesPayload(value: unknown, path: string): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  const message = 'Bytes payload must be ArrayBuffer or ArrayBufferView.';
  throwValidation('VERSION_INVALID_PAYLOAD', message, { path });
}

function clonePayload<TPayload>(payload: TPayload): TPayload {
  if (payload instanceof Uint8Array) {
    return new Uint8Array(payload) as TPayload;
  }
  if (payload instanceof ArrayBuffer) {
    return payload.slice(0) as TPayload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => clonePayload(item)) as TPayload;
  }
  if (isPlainRecord(payload)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      cloned[key] = clonePayload(value);
    }
    return cloned as TPayload;
  }
  return payload;
}

function cloneVersionObjectRecord<TPayload>(
  record: VersionObjectRecord<TPayload>,
): VersionObjectRecord<TPayload> {
  return Object.freeze({
    namespace: normalizeVersionGraphNamespace(record.namespace),
    preimage: Object.freeze({
      objectType: record.preimage.objectType,
      schemaVersion: record.preimage.schemaVersion,
      payloadEncoding: record.preimage.payloadEncoding,
      dependencies: Object.freeze(record.preimage.dependencies.map(cloneDependencyRef)),
      payload: clonePayload(record.preimage.payload),
    }),
    digest: { ...record.digest },
    payloadByteLength: record.payloadByteLength,
    preimageByteLength: record.preimageByteLength,
  });
}

function cloneDependencyRef(dependency: VersionDependencyRef): VersionDependencyRef {
  if (dependency.kind === 'object') {
    return {
      kind: 'object',
      objectType: dependency.objectType,
      digest: { ...dependency.digest },
    };
  }
  return {
    kind: 'commit',
    commitId: dependency.commitId,
    digest: { ...dependency.digest },
  };
}

async function sha256ObjectDigest(bytes: Uint8Array): Promise<ObjectDigest> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throwValidation('VERSION_STORE_UNAVAILABLE', 'SHA-256 Web Crypto support is unavailable.');
  }
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
  return Object.freeze({ algorithm: 'sha256', digest: bytesToHex(new Uint8Array(digest)) });
}

const textEncoder = new TextEncoder();

function utf8Encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
