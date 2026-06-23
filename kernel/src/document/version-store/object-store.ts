import {
  canonicalizeVersionDependencies,
  parseObjectDigest,
  type ObjectDigest,
  type VersionDependencyRef,
} from './object-digest';
import { clonePayload } from './object-store-canonical';
import {
  VersionObjectStoreError,
  diagnostic,
  diagnosticFromError,
  throwValidation,
  type VersionObjectStoreDiagnostic,
} from './object-store-diagnostics';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store-namespace';
import {
  cloneVersionObjectRecord,
  dependencyMatchesRecord,
  recordBelongsToNamespace,
  validateVersionObjectRecord,
  versionObjectRecordsMatch,
  type ValidatedVersionObjectRecord,
  type VersionObjectRecord,
} from './object-store-record';

export type {
  VersionObjectCompatibilityVersion,
  VersionObjectPayloadEncoding,
  VersionObjectPreimage,
} from './object-header';
export { VersionObjectStoreError } from './object-store-diagnostics';
export type {
  VersionObjectStoreDiagnostic,
  VersionObjectStoreDiagnosticCode,
} from './object-store-diagnostics';
export { normalizeVersionGraphNamespace, versionGraphNamespaceKey } from './object-store-namespace';
export type { VersionGraphNamespace } from './object-store-namespace';
export {
  VERSION_OBJECT_PREIMAGE_DOMAIN,
  VERSION_OBJECT_SCHEMA_VERSION,
  encodeVersionObjectPreimage,
} from './object-store-preimage';
export { createVersionObjectRecord } from './object-store-record';
export type { VersionObjectRecord } from './object-store-record';

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

export type VersionObjectPutBatchResult =
  | VersionObjectPutBatchSuccess
  | VersionObjectPutBatchFailure;

export interface VersionObjectStore {
  readonly namespace: VersionGraphNamespace;
  putObjects(batch: readonly VersionObjectRecord<unknown>[]): Promise<VersionObjectPutBatchResult>;
  getObject<TPayload>(ref: VersionDependencyRef): Promise<TPayload>;
  getObjectRecord<TPayload>(ref: VersionDependencyRef): Promise<VersionObjectRecord<TPayload>>;
  hasObject(ref: VersionDependencyRef): Promise<boolean>;
}

export class VersionObjectMemoryBackend {
  private readonly records = new Map<string, VersionObjectRecord<unknown>>();

  get(
    namespace: VersionGraphNamespace,
    digest: ObjectDigest,
  ): VersionObjectRecord<unknown> | undefined {
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
      .filter(
        ([key, record]) => key.startsWith(prefix) && recordBelongsToNamespace(namespace, record),
      )
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
    this.records.set(
      versionObjectStorageKey(namespace, parseObjectDigest(digest)),
      cloneVersionObjectRecord(record),
    );
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

  async putObjects(
    batch: readonly VersionObjectRecord<unknown>[],
  ): Promise<VersionObjectPutBatchResult> {
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

  async getObjectRecord<TPayload>(
    ref: VersionDependencyRef,
  ): Promise<VersionObjectRecord<TPayload>> {
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

    if (
      record.digest.algorithm !== dependency.digest.algorithm ||
      record.digest.digest !== dependency.digest.digest
    ) {
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
      const source = diagnosticFromError(error);
      const unsupported = source.code === 'VERSION_UNSUPPORTED_SCHEMA';
      throw new VersionObjectStoreError(
        diagnostic(
          unsupported ? source.code : 'VERSION_OBJECT_CORRUPTION',
          unsupported ? source.message : 'Stored version object record failed validation.',
          {
            namespace: this.namespace,
            digest: record.digest,
            objectType: record.preimage.objectType,
            ...(unsupported ? {} : { severity: 'corruption' as const }),
            details: { cause: source.code, ...(source.details ?? {}) },
          },
        ),
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

export function createInMemoryVersionObjectStore(
  namespace: VersionGraphNamespace,
  options?: InMemoryVersionObjectStoreOptions,
): InMemoryVersionObjectStore {
  return new InMemoryVersionObjectStore(namespace, options);
}

function failedBatch(
  diagnostics: readonly VersionObjectStoreDiagnostic[],
): VersionObjectPutBatchFailure {
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

function parseSingleDependencyRef(value: VersionDependencyRef, path: string): VersionDependencyRef {
  try {
    return canonicalizeVersionDependencies([value])[0];
  } catch (error) {
    throw new VersionObjectStoreError(diagnosticFromError(error, path));
  }
}

function versionObjectStorageKey(namespace: VersionGraphNamespace, digest: ObjectDigest): string {
  return `${versionGraphNamespaceKey(namespace)}\u0000${digest.algorithm}\u0000${digest.digest}`;
}
