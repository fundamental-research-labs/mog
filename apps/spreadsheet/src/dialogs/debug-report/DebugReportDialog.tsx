/**
 * Debug Report Dialog
 *
 * Shown after a debug recording stops. User fills in bug report metadata
 * (title, description, expected/actual, severity), then downloads a
 * self-contained JSON bundle that agents can analyze.
 */

import { useCallback, useState } from 'react';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

type Severity = 'critical' | 'major' | 'minor' | 'cosmetic';

const IDB_NAME = 'shortcut-rust-docs';
const IDB_VERSION = 2;
const IDB_STORES = ['snapshots', 'updates', 'meta'] as const;
const IDB_META_RECENT_DOCS_KEY = 'recentDocs';
const IDB_META_LAST_ACTIVE_DOC_ID_KEY = 'lastActiveDocId';

type IdbStoreName = (typeof IDB_STORES)[number];

const IDB_EXPORT_MAX_ENTRIES: Record<IdbStoreName, number> = {
  snapshots: 2,
  updates: 100,
  meta: 20,
};

const IDB_EXPORT_LIMITS = {
  maxDocIds: 2,
  maxEntriesPerStore: IDB_EXPORT_MAX_ENTRIES,
  maxBytesPerBinaryValue: 256 * 1024,
  maxStringCharsPerValue: 64 * 1024,
  maxArrayItems: 25,
  maxObjectEntries: 25,
  maxObjectDepth: 3,
  maxTotalValueBytes: 2 * 1024 * 1024,
};

interface IndexedDBExportScope {
  docIds: string[];
  source: 'meta' | 'unscoped-fallback';
  lastActiveDocId: string | null;
  recentDocCount: number;
  truncatedDocIds: boolean;
}

interface IndexedDBStoreStats {
  totalEntries: number | null;
  includedEntries: number;
  omittedEntries: number | null;
  truncatedValues: number;
  scoped: boolean;
  notes: string[];
}

interface IndexedDBStoreEntry {
  key: unknown;
  value: unknown;
}

interface IndexedDBExport {
  dbName: string;
  dbVersion: number;
  exportedAt: string;
  exportFormat: 'scoped-truncated-v1';
  scope: IndexedDBExportScope;
  limits: typeof IDB_EXPORT_LIMITS;
  stores: Record<IdbStoreName, IndexedDBStoreEntry[]>;
  storeStats: Record<IdbStoreName, IndexedDBStoreStats>;
}

interface ExportBudget {
  remainingValueBytes: number;
}

/** Dump all IndexedDB stores into a JSON-serializable object. */
async function dumpIndexedDB(): Promise<IndexedDBExport> {
  const db = await openIndexedDBForExport();

  try {
    const scope = await readIndexedDBExportScope(db);
    const budget: ExportBudget = {
      remainingValueBytes: IDB_EXPORT_LIMITS.maxTotalValueBytes,
    };
    const stores = createEmptyStores();
    const storeStats = createEmptyStoreStats();

    for (const storeName of IDB_STORES) {
      if (!db.objectStoreNames.contains(storeName)) {
        storeStats[storeName].notes.push('store missing');
        continue;
      }

      const result = await dumpIndexedDBStore(db, storeName, scope, budget);
      stores[storeName] = result.entries;
      storeStats[storeName] = result.stats;
    }

    return {
      dbName: IDB_NAME,
      dbVersion: IDB_VERSION,
      exportedAt: new Date().toISOString(),
      exportFormat: 'scoped-truncated-v1',
      scope,
      limits: IDB_EXPORT_LIMITS,
      stores,
      storeStats,
    };
  } finally {
    db.close();
  }
}

async function openIndexedDBForExport(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    let settled = false;
    let timeout = 0;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(err);
    };

    timeout = window.setTimeout(() => {
      fail(new Error('Timed out opening IndexedDB for debug export'));
    }, 5000);

    req.onerror = () => {
      fail(req.error ?? new Error('Failed to open IDB'));
    };
    req.onblocked = () => {
      fail(new Error('IndexedDB export blocked by another open connection'));
    };
    req.onsuccess = () => {
      if (settled) {
        req.result.close();
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      resolve(req.result);
    };
  });
}

function createEmptyStores(): Record<IdbStoreName, IndexedDBStoreEntry[]> {
  return {
    snapshots: [],
    updates: [],
    meta: [],
  };
}

function createEmptyStoreStats(): Record<IdbStoreName, IndexedDBStoreStats> {
  return {
    snapshots: createStoreStats(false),
    updates: createStoreStats(false),
    meta: createStoreStats(false),
  };
}

function createStoreStats(scoped: boolean): IndexedDBStoreStats {
  return {
    totalEntries: null,
    includedEntries: 0,
    omittedEntries: null,
    truncatedValues: 0,
    scoped,
    notes: [],
  };
}

async function readIndexedDBExportScope(db: IDBDatabase): Promise<IndexedDBExportScope> {
  if (!db.objectStoreNames.contains('meta')) {
    return {
      docIds: [],
      source: 'unscoped-fallback',
      lastActiveDocId: null,
      recentDocCount: 0,
      truncatedDocIds: false,
    };
  }

  const { recentDocs, lastActiveDocId } = await new Promise<{
    recentDocs: unknown;
    lastActiveDocId: unknown;
  }>((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const store = tx.objectStore('meta');
    let recentDocs: unknown;
    let lastActiveDocId: unknown;

    const recentReq = store.get(IDB_META_RECENT_DOCS_KEY);
    recentReq.onsuccess = () => {
      recentDocs = recentReq.result;
    };

    const lastActiveReq = store.get(IDB_META_LAST_ACTIVE_DOC_ID_KEY);
    lastActiveReq.onsuccess = () => {
      lastActiveDocId = lastActiveReq.result;
    };

    tx.oncomplete = () => resolve({ recentDocs, lastActiveDocId });
    tx.onerror = () => reject(tx.error ?? new Error('Failed to read IDB meta scope'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB meta scope read aborted'));
  });

  const recentDocIds = Array.isArray(recentDocs)
    ? recentDocs
        .map((entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { docId?: unknown }).docId === 'string'
            ? (entry as { docId: string }).docId
            : null,
        )
        .filter((docId): docId is string => docId !== null)
    : [];
  const allDocIds = uniqueStrings([
    typeof lastActiveDocId === 'string' ? lastActiveDocId : null,
    ...recentDocIds,
  ]);
  const docIds = allDocIds.slice(0, IDB_EXPORT_LIMITS.maxDocIds);

  return {
    docIds,
    source: docIds.length > 0 ? 'meta' : 'unscoped-fallback',
    lastActiveDocId: typeof lastActiveDocId === 'string' ? lastActiveDocId : null,
    recentDocCount: recentDocIds.length,
    truncatedDocIds: allDocIds.length > docIds.length,
  };
}

async function dumpIndexedDBStore(
  db: IDBDatabase,
  storeName: IdbStoreName,
  scope: IndexedDBExportScope,
  budget: ExportBudget,
): Promise<{ entries: IndexedDBStoreEntry[]; stats: IndexedDBStoreStats }> {
  if (storeName === 'snapshots' && scope.docIds.length > 0) {
    return dumpKeyedEntries(db, storeName, scope.docIds, budget);
  }

  if (storeName === 'updates' && scope.docIds.length > 0) {
    return dumpScopedUpdateEntries(db, scope.docIds, budget);
  }

  return dumpCursorEntries(db, storeName, {
    budget,
    maxEntries: IDB_EXPORT_LIMITS.maxEntriesPerStore[storeName],
    scoped: false,
  });
}

async function dumpKeyedEntries(
  db: IDBDatabase,
  storeName: IdbStoreName,
  keys: string[],
  budget: ExportBudget,
): Promise<{ entries: IndexedDBStoreEntry[]; stats: IndexedDBStoreStats }> {
  const stats = createStoreStats(true);
  stats.totalEntries = await countKeyedEntries(db, storeName, keys);
  stats.notes.push('scoped to recent active document ids');

  const entries = await new Promise<IndexedDBStoreEntry[]>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const collected: IndexedDBStoreEntry[] = [];

    for (const key of keys.slice(0, IDB_EXPORT_LIMITS.maxEntriesPerStore[storeName])) {
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result === undefined || budget.remainingValueBytes <= 0) return;
        const value = serializeIndexedDBValue(req.result, budget);
        if (hasTruncationMarker(value)) stats.truncatedValues += 1;
        collected.push({ key, value });
      };
    }

    tx.oncomplete = () => resolve(collected);
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to read ${storeName}`));
    tx.onabort = () => reject(tx.error ?? new Error(`${storeName} read aborted`));
  });

  stats.includedEntries = entries.length;
  stats.omittedEntries =
    stats.totalEntries === null ? null : Math.max(0, stats.totalEntries - stats.includedEntries);
  if (stats.omittedEntries && stats.omittedEntries > 0) {
    stats.notes.push('entries omitted by export limit or document scope');
  }
  return { entries, stats };
}

async function dumpScopedUpdateEntries(
  db: IDBDatabase,
  docIds: string[],
  budget: ExportBudget,
): Promise<{ entries: IndexedDBStoreEntry[]; stats: IndexedDBStoreStats }> {
  const stats = createStoreStats(true);
  stats.totalEntries = await countUpdateEntriesForDocIds(db, docIds);
  stats.notes.push('scoped to recent active document ids');
  stats.notes.push('recent updates exported first');

  const entries: IndexedDBStoreEntry[] = [];
  for (const docId of docIds) {
    if (entries.length >= IDB_EXPORT_LIMITS.maxEntriesPerStore.updates) break;
    if (budget.remainingValueBytes <= 0) break;

    const range = IDBKeyRange.bound([docId, -Infinity], [docId, Infinity]);
    const result = await dumpCursorEntries(db, 'updates', {
      budget,
      direction: 'prev',
      maxEntries: IDB_EXPORT_LIMITS.maxEntriesPerStore.updates - entries.length,
      range,
      scoped: true,
    });
    entries.push(...result.entries);
    stats.truncatedValues += result.stats.truncatedValues;
  }

  stats.includedEntries = entries.length;
  stats.omittedEntries =
    stats.totalEntries === null ? null : Math.max(0, stats.totalEntries - stats.includedEntries);
  if (stats.omittedEntries && stats.omittedEntries > 0) {
    stats.notes.push('entries omitted by export limit');
  }
  return { entries, stats };
}

async function dumpCursorEntries(
  db: IDBDatabase,
  storeName: IdbStoreName,
  options: {
    budget: ExportBudget;
    direction?: IDBCursorDirection;
    maxEntries: number;
    range?: IDBKeyRange;
    scoped: boolean;
  },
): Promise<{ entries: IndexedDBStoreEntry[]; stats: IndexedDBStoreStats }> {
  const stats = createStoreStats(options.scoped);
  stats.totalEntries = await countStoreEntries(db, storeName, options.range);
  const entries = await new Promise<IndexedDBStoreEntry[]>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const collected: IndexedDBStoreEntry[] = [];
    const cursorReq = store.openCursor(options.range, options.direction ?? 'next');

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;

      if (collected.length >= options.maxEntries || options.budget.remainingValueBytes <= 0) {
        return;
      }

      const value = serializeIndexedDBValue(cursor.value, options.budget);
      if (hasTruncationMarker(value)) stats.truncatedValues += 1;
      collected.push({ key: cursor.key, value });

      if (collected.length < options.maxEntries && options.budget.remainingValueBytes > 0) {
        cursor.continue();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error(`Failed to cursor ${storeName}`));
    tx.oncomplete = () => resolve(collected);
    tx.onerror = () => reject(tx.error ?? new Error(`Failed to read ${storeName}`));
    tx.onabort = () => reject(tx.error ?? new Error(`${storeName} read aborted`));
  });

  stats.includedEntries = entries.length;
  stats.omittedEntries =
    stats.totalEntries === null ? null : Math.max(0, stats.totalEntries - stats.includedEntries);
  if (stats.omittedEntries && stats.omittedEntries > 0) {
    stats.notes.push('entries omitted by export limit');
  }
  return { entries, stats };
}

async function countKeyedEntries(
  db: IDBDatabase,
  storeName: IdbStoreName,
  keys: string[],
): Promise<number | null> {
  try {
    const counts = await Promise.all(keys.map((key) => countStoreEntries(db, storeName, key)));
    return counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  } catch {
    return null;
  }
}

async function countUpdateEntriesForDocIds(
  db: IDBDatabase,
  docIds: string[],
): Promise<number | null> {
  try {
    const counts = await Promise.all(
      docIds.map((docId) =>
        countStoreEntries(db, 'updates', IDBKeyRange.bound([docId, -Infinity], [docId, Infinity])),
      ),
    );
    return counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  } catch {
    return null;
  }
}

async function countStoreEntries(
  db: IDBDatabase,
  storeName: IdbStoreName,
  query?: IDBValidKey | IDBKeyRange,
): Promise<number | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).count(query);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    tx.onerror = () => resolve(null);
    tx.onabort = () => resolve(null);
  });
}

function serializeIndexedDBValue(value: unknown, budget: ExportBudget): unknown {
  if (value instanceof Uint8Array) {
    return serializeBinaryValue(value, budget);
  }
  if (value instanceof ArrayBuffer) {
    return serializeBinaryValue(new Uint8Array(value), budget);
  }
  if (ArrayBuffer.isView(value)) {
    return serializeBinaryValue(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      budget,
    );
  }
  if (typeof value === 'string') {
    return serializeStringValue(value, budget);
  }
  return summarizeStructuredValue(value, budget, 0, new WeakSet<object>());
}

function serializeBinaryValue(bytes: Uint8Array, budget: ExportBudget): unknown {
  const exportedBytes = Math.min(
    bytes.byteLength,
    IDB_EXPORT_LIMITS.maxBytesPerBinaryValue,
    Math.max(0, budget.remainingValueBytes),
  );
  budget.remainingValueBytes -= exportedBytes;

  return {
    __type: 'Uint8Array',
    base64: uint8ToBase64(bytes.subarray(0, exportedBytes)),
    byteLength: bytes.byteLength,
    exportedBytes,
    truncated: exportedBytes < bytes.byteLength,
  };
}

function serializeStringValue(value: string, budget: ExportBudget): unknown {
  const exportedChars = Math.min(
    value.length,
    IDB_EXPORT_LIMITS.maxStringCharsPerValue,
    Math.floor(Math.max(0, budget.remainingValueBytes) / 2),
  );
  budget.remainingValueBytes -= exportedChars * 2;

  if (exportedChars >= value.length) {
    return value;
  }

  return {
    __type: 'string',
    value: value.slice(0, exportedChars),
    charLength: value.length,
    exportedChars,
    truncated: true,
  };
}

function summarizeStructuredValue(
  value: unknown,
  budget: ExportBudget,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return { __type: 'bigint', value: value.toString() };
  if (typeof value === 'undefined') return { __type: 'undefined' };
  if (typeof value === 'symbol') return { __type: 'symbol', value: String(value) };
  if (typeof value === 'function') return { __type: 'function', name: value.name || null };
  if (typeof value === 'string') return serializeStringValue(value, budget);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return serializeIndexedDBValue(value, budget);
  }
  if (typeof value !== 'object') return String(value);

  if (seen.has(value)) return { __type: 'CircularReference' };
  if (depth >= IDB_EXPORT_LIMITS.maxObjectDepth) {
    return { __type: value.constructor?.name || 'Object', truncated: true };
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, IDB_EXPORT_LIMITS.maxArrayItems)
        .map((item) => summarizeStructuredValue(item, budget, depth + 1, seen));
      if (items.length >= value.length) return items;
      return {
        __type: 'Array',
        length: value.length,
        items,
        truncated: true,
      };
    }

    if (value instanceof Map) {
      return {
        __type: 'Map',
        size: value.size,
        entries: Array.from(value.entries())
          .slice(0, IDB_EXPORT_LIMITS.maxObjectEntries)
          .map(([key, mapValue]) => [
            summarizeStructuredValue(key, budget, depth + 1, seen),
            summarizeStructuredValue(mapValue, budget, depth + 1, seen),
          ]),
        truncated: value.size > IDB_EXPORT_LIMITS.maxObjectEntries,
      };
    }

    if (value instanceof Set) {
      return {
        __type: 'Set',
        size: value.size,
        values: Array.from(value.values())
          .slice(0, IDB_EXPORT_LIMITS.maxArrayItems)
          .map((setValue) => summarizeStructuredValue(setValue, budget, depth + 1, seen)),
        truncated: value.size > IDB_EXPORT_LIMITS.maxArrayItems,
      };
    }

    const entries = Object.entries(value).slice(0, IDB_EXPORT_LIMITS.maxObjectEntries);
    const out: Record<string, unknown> = {};
    for (const [key, objectValue] of entries) {
      out[key] = summarizeStructuredValue(objectValue, budget, depth + 1, seen);
    }
    const keyCount = Object.keys(value).length;
    if (keyCount > entries.length) {
      out.__truncatedKeys = keyCount - entries.length;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function hasTruncationMarker(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.truncated === true || typeof record.__truncatedKeys === 'number') return true;
  if (Array.isArray(record.items)) return record.items.some(hasTruncationMarker);
  if (Array.isArray(record.values)) return record.values.some(hasTruncationMarker);
  if (Array.isArray(record.entries)) return record.entries.some(hasTruncationMarker);
  return Object.values(record).some(hasTruncationMarker);
}

function uniqueStrings(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** Clear all data from all IndexedDB stores (without deleting the database). */
async function clearIndexedDB(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IDB'));
  });

  try {
    const storeNames = Array.from(db.objectStoreNames);
    if (storeNames.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      for (const name of storeNames) {
        tx.objectStore(name).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear IDB'));
    });
  } finally {
    db.close();
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function buildIndexedDBExportBlob(data: IndexedDBExport): Blob {
  const parts: BlobPart[] = [];
  let firstTopLevelField = true;
  const appendField = (key: string, value: unknown) => {
    if (!firstTopLevelField) parts.push(',');
    firstTopLevelField = false;
    parts.push(JSON.stringify(key), ':', JSON.stringify(value));
  };

  parts.push('{');
  appendField('dbName', data.dbName);
  appendField('dbVersion', data.dbVersion);
  appendField('exportedAt', data.exportedAt);
  appendField('exportFormat', data.exportFormat);
  appendField('scope', data.scope);
  appendField('limits', data.limits);

  if (!firstTopLevelField) parts.push(',');
  firstTopLevelField = false;
  parts.push(JSON.stringify('stores'), ':{');
  IDB_STORES.forEach((storeName, storeIndex) => {
    if (storeIndex > 0) parts.push(',');
    parts.push(JSON.stringify(storeName), ':[');
    data.stores[storeName].forEach((entry, entryIndex) => {
      if (entryIndex > 0) parts.push(',');
      parts.push(JSON.stringify(entry));
    });
    parts.push(']');
  });
  parts.push('}');

  appendField('storeStats', data.storeStats);
  parts.push('}');

  return new Blob(parts, { type: 'application/json' });
}

export const __debugReportDialogTestUtils: {
  IDB_EXPORT_LIMITS: typeof IDB_EXPORT_LIMITS;
  buildIndexedDBExportBlob: (data: unknown) => Blob;
  serializeIndexedDBValue: (value: unknown, budget: { remainingValueBytes: number }) => unknown;
} = {
  IDB_EXPORT_LIMITS,
  buildIndexedDBExportBlob: (data) => buildIndexedDBExportBlob(data as IndexedDBExport),
  serializeIndexedDBValue,
};

export interface DebugReportDialogProps {
  bundle: unknown;
  onClose: () => void;
}

export function DebugReportDialog({ bundle, onClose }: DebugReportDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const [actualBehavior, setActualBehavior] = useState('');
  const [severity, setSeverity] = useState<Severity>('major');

  const [idbStatus, setIdbStatus] = useState<'idle' | 'downloading' | 'clearing' | 'cleared'>(
    'idle',
  );

  const handleDownloadIdb = useCallback(async () => {
    setIdbStatus('downloading');
    try {
      const dump = await dumpIndexedDB();
      const blob = buildIndexedDBExportBlob(dump);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `indexeddb-state-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[DebugReport] Failed to dump IndexedDB:', err);
    } finally {
      setIdbStatus('idle');
    }
  }, []);

  const handleClearIdb = useCallback(async () => {
    setIdbStatus('clearing');
    try {
      await clearIndexedDB();
      setIdbStatus('cleared');
    } catch (err) {
      console.error('[DebugReport] Failed to clear IndexedDB:', err);
      setIdbStatus('idle');
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!bundle) return;

    // Attach bug report to bundle
    const fullBundle = {
      ...(bundle as Record<string, unknown>),
      bugReport: {
        title,
        description,
        expectedBehavior,
        actualBehavior,
        severity,
      },
    };

    // Serialize and download
    const json = JSON.stringify(fullBundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    a.download = `debug-recording-${slug || 'untitled'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    onClose();
  }, [bundle, title, description, expectedBehavior, actualBehavior, severity, onClose]);

  return (
    <Dialog open onClose={onClose} dialogId="debug-report-dialog" width="md">
      <DialogHeader onClose={onClose}>Bug Report</DialogHeader>
      <DialogBody>
        <div className="flex flex-col gap-3">
          {/* Title */}
          <div>
            <label className="block text-body font-medium text-ss-text-secondary mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the bug"
              className="w-full px-2 py-1.5 text-body border border-ss-border rounded bg-ss-surface text-ss-text-primary focus:outline-none focus:ring-1 focus:ring-ss-primary"
              data-testid="debug-report-title"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-body font-medium text-ss-text-secondary mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, context, or additional details"
              rows={3}
              className="w-full px-2 py-1.5 text-body border border-ss-border rounded bg-ss-surface text-ss-text-primary focus:outline-none focus:ring-1 focus:ring-ss-primary resize-y"
              data-testid="debug-report-description"
            />
          </div>

          {/* Expected / Actual side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-body font-medium text-ss-text-secondary mb-1">
                Expected behavior
              </label>
              <textarea
                value={expectedBehavior}
                onChange={(e) => setExpectedBehavior(e.target.value)}
                placeholder="What should have happened"
                rows={2}
                className="w-full px-2 py-1.5 text-body border border-ss-border rounded bg-ss-surface text-ss-text-primary focus:outline-none focus:ring-1 focus:ring-ss-primary resize-y"
                data-testid="debug-report-expected"
              />
            </div>
            <div>
              <label className="block text-body font-medium text-ss-text-secondary mb-1">
                Actual behavior
              </label>
              <textarea
                value={actualBehavior}
                onChange={(e) => setActualBehavior(e.target.value)}
                placeholder="What actually happened"
                rows={2}
                className="w-full px-2 py-1.5 text-body border border-ss-border rounded bg-ss-surface text-ss-text-primary focus:outline-none focus:ring-1 focus:ring-ss-primary resize-y"
                data-testid="debug-report-actual"
              />
            </div>
          </div>

          {/* Severity */}
          <div>
            <label className="block text-body font-medium text-ss-text-secondary mb-1">
              Severity
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className="w-full px-2 py-1.5 text-body border border-ss-border rounded bg-ss-surface text-ss-text-primary focus:outline-none focus:ring-1 focus:ring-ss-primary"
              data-testid="debug-report-severity"
            >
              <option value="critical">Critical - App crashes or data loss</option>
              <option value="major">Major - Feature broken, no workaround</option>
              <option value="minor">Minor - Feature broken, workaround exists</option>
              <option value="cosmetic">Cosmetic - Visual issue only</option>
            </select>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <div className="flex items-center gap-2 mr-auto">
          <Button
            variant="secondary"
            onClick={handleDownloadIdb}
            disabled={idbStatus === 'downloading'}
          >
            {idbStatus === 'downloading' ? 'Exporting…' : 'Download IndexedDB'}
          </Button>
          <Button
            variant="secondary"
            onClick={handleClearIdb}
            disabled={idbStatus === 'clearing' || idbStatus === 'cleared'}
          >
            {idbStatus === 'cleared'
              ? 'Cleared'
              : idbStatus === 'clearing'
                ? 'Clearing…'
                : 'Clear IndexedDB'}
          </Button>
        </div>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleDownload} disabled={!title.trim()}>
          Download Report
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
