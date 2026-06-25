import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import { isWorkbookCommitId } from './object-digest';
import { REF_NAME_STORAGE_PREFIX, validateRefName } from './refs/ref-name';

const STORED_ACTIVE_CHECKOUT_MATERIALIZATION_SCHEMA_VERSION = 1;
const STORED_ACTIVE_CHECKOUT_MATERIALIZATION_RECORD_KIND = 'activeCheckoutMaterialization';
const ACTIVE_CHECKOUT_MATERIALIZATION_BRANCH_NAMESPACES = new Set([
  'agent',
  'import',
  'review',
  'scenario',
]);

export type ActiveCheckoutMaterializationRecord = {
  readonly documentScopeKey: string;
  readonly checkedOutCommitId: string;
  readonly branchName: string;
  readonly refHeadAtMaterialization: string;
  readonly updatedAt: string;
};

export type ActiveCheckoutMaterializationMemoryBackendSnapshot =
  readonly ActiveCheckoutMaterializationRecord[];

export type ActiveCheckoutMaterializationStore = {
  read(): Promise<ActiveCheckoutMaterializationRecord | null>;
  write(record: Omit<ActiveCheckoutMaterializationRecord, 'documentScopeKey'>): Promise<void>;
  clear(): Promise<void>;
};

export type StoredActiveCheckoutMaterializationRecord = {
  readonly schemaVersion: typeof STORED_ACTIVE_CHECKOUT_MATERIALIZATION_SCHEMA_VERSION;
  readonly recordKind: typeof STORED_ACTIVE_CHECKOUT_MATERIALIZATION_RECORD_KIND;
  readonly documentScopeKey: string;
  readonly record: ActiveCheckoutMaterializationRecord;
};

export type ActiveCheckoutMaterializationDecodeResult =
  | {
      readonly status: 'valid';
      readonly record: ActiveCheckoutMaterializationRecord;
    }
  | {
      readonly status: 'malformed';
    };

export class ActiveCheckoutMaterializationMemoryBackend {
  private readonly records = new Map<string, ActiveCheckoutMaterializationRecord>();

  read(documentScopeKey: string): ActiveCheckoutMaterializationRecord | null {
    return cloneActiveCheckoutMaterializationRecord(this.records.get(documentScopeKey) ?? null);
  }

  write(record: ActiveCheckoutMaterializationRecord): void {
    if (!isPlainRecord(record) || typeof record.documentScopeKey !== 'string') {
      throw new Error('Active checkout materialization record is malformed.');
    }
    const decoded = decodeActiveCheckoutMaterializationRecord(record, record.documentScopeKey);
    if (!decoded) {
      throw new Error('Active checkout materialization record is malformed.');
    }
    this.records.set(decoded.documentScopeKey, decoded);
  }

  clear(documentScopeKey: string): void {
    this.records.delete(documentScopeKey);
  }

  exportSnapshot(): ActiveCheckoutMaterializationMemoryBackendSnapshot {
    return Object.freeze(
      [...this.records.values()].map((record) => cloneActiveCheckoutMaterializationRecord(record)),
    );
  }

  static fromSnapshot(
    records: ActiveCheckoutMaterializationMemoryBackendSnapshot,
  ): ActiveCheckoutMaterializationMemoryBackend {
    const backend = new ActiveCheckoutMaterializationMemoryBackend();
    for (const record of records) {
      if (!isPlainRecord(record) || typeof record.documentScopeKey !== 'string') continue;
      const decoded = decodeActiveCheckoutMaterializationRecord(record, record.documentScopeKey);
      if (decoded) backend.records.set(decoded.documentScopeKey, decoded);
    }
    return backend;
  }
}

export function createActiveCheckoutMaterializationMemoryStore(
  backend: ActiveCheckoutMaterializationMemoryBackend,
  documentScope: VersionDocumentScope,
): ActiveCheckoutMaterializationStore {
  const normalized = normalizeVersionDocumentScope(documentScope);
  const documentScopeKey = versionDocumentScopeKey(normalized);
  return {
    async read() {
      return backend.read(documentScopeKey);
    },
    async write(record) {
      backend.write({ ...record, documentScopeKey });
    },
    async clear() {
      backend.clear(documentScopeKey);
    },
  };
}

export function decodeActiveCheckoutMaterializationRecord(
  value: unknown,
  documentScopeKey: string,
): ActiveCheckoutMaterializationRecord | null {
  if (!isPlainRecord(value)) return null;
  if (
    !hasOnlyKeys(value, [
      'documentScopeKey',
      'checkedOutCommitId',
      'branchName',
      'refHeadAtMaterialization',
      'updatedAt',
    ])
  ) {
    return null;
  }
  if (
    value.documentScopeKey !== documentScopeKey ||
    !isWorkbookCommitId(value.checkedOutCommitId) ||
    !isWorkbookCommitId(value.refHeadAtMaterialization) ||
    !isCanonicalIsoInstant(value.updatedAt)
  ) {
    return null;
  }
  const branchName = normalizeMaterializedBranchName(value.branchName);
  if (!branchName) return null;
  return Object.freeze({
    documentScopeKey,
    checkedOutCommitId: value.checkedOutCommitId,
    branchName,
    refHeadAtMaterialization: value.refHeadAtMaterialization,
    updatedAt: value.updatedAt,
  });
}

export function storedActiveCheckoutMaterializationRecord(
  record: ActiveCheckoutMaterializationRecord,
): StoredActiveCheckoutMaterializationRecord {
  if (!isPlainRecord(record) || typeof record.documentScopeKey !== 'string') {
    throw new Error('Active checkout materialization record is malformed.');
  }
  const decoded = decodeActiveCheckoutMaterializationRecord(record, record.documentScopeKey);
  if (!decoded) {
    throw new Error('Active checkout materialization record is malformed.');
  }
  return Object.freeze({
    schemaVersion: STORED_ACTIVE_CHECKOUT_MATERIALIZATION_SCHEMA_VERSION,
    recordKind: STORED_ACTIVE_CHECKOUT_MATERIALIZATION_RECORD_KIND,
    documentScopeKey: decoded.documentScopeKey,
    record: decoded,
  });
}

export function decodeStoredActiveCheckoutMaterializationRecord(
  value: unknown,
  documentScopeKey: string,
): ActiveCheckoutMaterializationDecodeResult {
  const legacyRecord = decodeActiveCheckoutMaterializationRecord(value, documentScopeKey);
  if (legacyRecord) return { status: 'valid', record: legacyRecord };

  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ['schemaVersion', 'recordKind', 'documentScopeKey', 'record']) ||
    value.schemaVersion !== STORED_ACTIVE_CHECKOUT_MATERIALIZATION_SCHEMA_VERSION ||
    value.recordKind !== STORED_ACTIVE_CHECKOUT_MATERIALIZATION_RECORD_KIND ||
    value.documentScopeKey !== documentScopeKey
  ) {
    return { status: 'malformed' };
  }

  const record = decodeActiveCheckoutMaterializationRecord(value.record, documentScopeKey);
  return record ? { status: 'valid', record } : { status: 'malformed' };
}

export function cloneActiveCheckoutMaterializationRecord(
  record: ActiveCheckoutMaterializationRecord,
): ActiveCheckoutMaterializationRecord;
export function cloneActiveCheckoutMaterializationRecord(
  record: ActiveCheckoutMaterializationRecord | null,
): ActiveCheckoutMaterializationRecord | null;
export function cloneActiveCheckoutMaterializationRecord(
  record: ActiveCheckoutMaterializationRecord | null,
): ActiveCheckoutMaterializationRecord | null {
  return record ? Object.freeze({ ...record }) : null;
}

function normalizeMaterializedBranchName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? decodeBranchRefSuffix(value.slice(REF_NAME_STORAGE_PREFIX.length))
    : value;
  if (branchName === null) return null;
  const parsed = validateRefName(branchName, 'branchName');
  if (!parsed.ok) return null;
  if (parsed.name === 'main') return parsed.name;
  const topLevelNamespace = parsed.name.split('/')[0];
  return topLevelNamespace &&
    ACTIVE_CHECKOUT_MATERIALIZATION_BRANCH_NAMESPACES.has(topLevelNamespace)
    ? parsed.name
    : null;
}

function decodeBranchRefSuffix(value: string): string | null {
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  try {
    return new Date(timestamp).toISOString() === value;
  } catch {
    return false;
  }
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length) return false;
  const expected = new Set(expectedKeys);
  return actualKeys.every((key) => expected.has(key));
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
