import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

export type ActiveCheckoutMaterializationRecord = {
  readonly documentScopeKey: string;
  readonly checkedOutCommitId: string;
  readonly branchName: string;
  readonly refHeadAtMaterialization: string;
  readonly updatedAt: string;
};

export type ActiveCheckoutMaterializationStore = {
  read(): Promise<ActiveCheckoutMaterializationRecord | null>;
  write(record: Omit<ActiveCheckoutMaterializationRecord, 'documentScopeKey'>): Promise<void>;
  clear(): Promise<void>;
};

export class ActiveCheckoutMaterializationMemoryBackend {
  private readonly records = new Map<string, ActiveCheckoutMaterializationRecord>();

  read(documentScopeKey: string): ActiveCheckoutMaterializationRecord | null {
    return cloneRecord(this.records.get(documentScopeKey) ?? null);
  }

  write(record: ActiveCheckoutMaterializationRecord): void {
    this.records.set(record.documentScopeKey, cloneRecord(record));
  }

  clear(documentScopeKey: string): void {
    this.records.delete(documentScopeKey);
  }

  exportSnapshot(): readonly ActiveCheckoutMaterializationRecord[] {
    return Object.freeze([...this.records.values()].map((record) => cloneRecord(record)));
  }

  static fromSnapshot(
    records: readonly ActiveCheckoutMaterializationRecord[],
  ): ActiveCheckoutMaterializationMemoryBackend {
    const backend = new ActiveCheckoutMaterializationMemoryBackend();
    for (const record of records) {
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
  if (!isRecord(value)) return null;
  if (
    value.documentScopeKey !== documentScopeKey ||
    typeof value.checkedOutCommitId !== 'string' ||
    typeof value.branchName !== 'string' ||
    typeof value.refHeadAtMaterialization !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }
  return Object.freeze({
    documentScopeKey,
    checkedOutCommitId: value.checkedOutCommitId,
    branchName: value.branchName,
    refHeadAtMaterialization: value.refHeadAtMaterialization,
    updatedAt: value.updatedAt,
  });
}

function cloneRecord(
  record: ActiveCheckoutMaterializationRecord,
): ActiveCheckoutMaterializationRecord;
function cloneRecord(record: ActiveCheckoutMaterializationRecord | null): ActiveCheckoutMaterializationRecord | null;
function cloneRecord(
  record: ActiveCheckoutMaterializationRecord | null,
): ActiveCheckoutMaterializationRecord | null {
  return record ? Object.freeze({ ...record }) : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
