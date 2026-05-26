import { __debugReportDialogTestUtils } from './DebugReportDialog';

describe('DebugReportDialog IndexedDB export helpers', () => {
  it('truncates binary values before base64 encoding', () => {
    const { IDB_EXPORT_LIMITS, serializeIndexedDBValue } = __debugReportDialogTestUtils;
    const bytes = new Uint8Array(IDB_EXPORT_LIMITS.maxBytesPerBinaryValue + 10);
    bytes.fill(65);
    const budget = { remainingValueBytes: IDB_EXPORT_LIMITS.maxBytesPerBinaryValue + 100 };

    const serialized = serializeIndexedDBValue(bytes, budget) as {
      __type: string;
      base64: string;
      byteLength: number;
      exportedBytes: number;
      truncated: boolean;
    };

    expect(serialized.__type).toBe('Uint8Array');
    expect(serialized.byteLength).toBe(bytes.byteLength);
    expect(serialized.exportedBytes).toBe(IDB_EXPORT_LIMITS.maxBytesPerBinaryValue);
    expect(serialized.truncated).toBe(true);
    expect(serialized.base64.length).toBeLessThan(bytes.byteLength * 2);
    expect(budget.remainingValueBytes).toBe(100);
  });

  it('respects the total export byte budget even for a small value', () => {
    const { serializeIndexedDBValue } = __debugReportDialogTestUtils;
    const budget = { remainingValueBytes: 4 };

    const serialized = serializeIndexedDBValue(new Uint8Array([1, 2, 3, 4, 5, 6]), budget) as {
      byteLength: number;
      exportedBytes: number;
      truncated: boolean;
    };

    expect(serialized.byteLength).toBe(6);
    expect(serialized.exportedBytes).toBe(4);
    expect(serialized.truncated).toBe(true);
    expect(budget.remainingValueBytes).toBe(0);
  });

  it('builds parseable JSON without changing the stores shape', async () => {
    const { buildIndexedDBExportBlob } = __debugReportDialogTestUtils;
    const blob = buildIndexedDBExportBlob({
      dbName: 'shortcut-rust-docs',
      dbVersion: 2,
      exportedAt: '2026-05-20T00:00:00.000Z',
      exportFormat: 'scoped-truncated-v1',
      scope: {
        docIds: ['doc-a'],
        source: 'meta',
        lastActiveDocId: 'doc-a',
        recentDocCount: 1,
        truncatedDocIds: false,
      },
      limits: {},
      stores: {
        snapshots: [
          {
            key: 'doc-a',
            value: {
              __type: 'Uint8Array',
              base64: 'AQID',
              byteLength: 3,
              exportedBytes: 3,
              truncated: false,
            },
          },
        ],
        updates: [],
        meta: [{ key: 'lastActiveDocId', value: 'doc-a' }],
      },
      storeStats: {
        snapshots: {
          totalEntries: 1,
          includedEntries: 1,
          omittedEntries: 0,
          truncatedValues: 0,
          scoped: true,
          notes: [],
        },
        updates: {
          totalEntries: 0,
          includedEntries: 0,
          omittedEntries: 0,
          truncatedValues: 0,
          scoped: true,
          notes: [],
        },
        meta: {
          totalEntries: 1,
          includedEntries: 1,
          omittedEntries: 0,
          truncatedValues: 0,
          scoped: false,
          notes: [],
        },
      },
    });

    const parsed = JSON.parse(await blobToText(blob)) as {
      dbName: string;
      stores: {
        snapshots: Array<{ value: { __type?: string; base64?: string } }>;
        updates: unknown[];
        meta: unknown[];
      };
    };

    expect(parsed.dbName).toBe('shortcut-rust-docs');
    expect(Array.isArray(parsed.stores.snapshots)).toBe(true);
    expect(Array.isArray(parsed.stores.updates)).toBe(true);
    expect(Array.isArray(parsed.stores.meta)).toBe(true);
    expect(parsed.stores.snapshots[0]?.value.__type).toBe('Uint8Array');
    expect(typeof parsed.stores.snapshots[0]?.value.base64).toBe('string');
  });
});

function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsText(blob);
  });
}
