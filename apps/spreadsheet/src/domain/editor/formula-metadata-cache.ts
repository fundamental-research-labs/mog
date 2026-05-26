import type {
  Workbook,
  Worksheet,
  NamedRangeInfo,
  TableInfo as ApiTableInfo,
} from '@mog-sdk/contracts/api';
import type {
  DefinedNameDefinition,
  NameCompletionStoreLike,
  SheetInfo,
  TableInfo,
} from './name-completion';

type DisposableLike = (() => void) | { dispose: () => void };

type FormulaMetadataStatus = 'idle' | 'loading' | 'ready' | 'error' | 'disposed';

export interface FormulaMetadataSnapshot {
  status: FormulaMetadataStatus;
  version: number;
  metadata: FormulaAutocompleteMetadata | null;
}

export interface FormulaAutocompleteMetadata {
  namedRanges: NamedRangeInfo[];
  tables: Array<ApiTableInfo & { _sheetName: string }>;
  sheets: SheetInfo[];
}

export interface FormulaMetadataWorkbookLike extends Pick<
  Workbook,
  'names' | 'getSheetNames' | 'getSheet' | 'getSheetById' | 'on'
> {
  readonly isDisposed?: boolean;
}

type FormulaMetadataSubscriber = () => void;

function disposeSubscription(disposable: DisposableLike | void): void {
  if (!disposable) return;
  if (typeof disposable === 'function') {
    disposable();
    return;
  }
  disposable.dispose();
}

function normalizeTables(
  tables: ApiTableInfo[],
  sheetName: string,
): FormulaAutocompleteMetadata['tables'] {
  return tables.map((table) => ({ ...table, _sheetName: sheetName }));
}

async function loadFormulaMetadata(
  wb: FormulaMetadataWorkbookLike,
): Promise<FormulaAutocompleteMetadata> {
  const [namedRanges, sheetNames] = await Promise.all([wb.names.list(), wb.getSheetNames()]);

  const sheets = await Promise.all(
    sheetNames.map(async (name) => {
      const ws = await wb.getSheet(name);
      return { id: ws.getSheetId(), name };
    }),
  );

  const tableGroups = await Promise.all(
    sheets.map(async ({ id, name }) => {
      const ws = wb.getSheetById(id) as Worksheet;
      const tables = await ws.tables.list();
      return normalizeTables(tables, name);
    }),
  );

  return {
    namedRanges,
    sheets,
    tables: tableGroups.flat(),
  };
}

export class FormulaMetadataCache {
  private snapshot: FormulaMetadataSnapshot = {
    status: 'idle',
    version: 0,
    metadata: null,
  };
  private inFlight: Promise<FormulaAutocompleteMetadata> | null = null;
  private subscribers = new Set<FormulaMetadataSubscriber>();
  private readonly disposables: DisposableLike[] = [];

  constructor(private readonly wb: FormulaMetadataWorkbookLike) {
    this.disposables.push(
      wb.on('structureChanged', () => this.invalidate()),
      wb.on('sheet:created', () => this.invalidate()),
      wb.on('sheet:deleted', () => this.invalidate()),
      wb.on('sheet:renamed', () => this.invalidate()),
      wb.on('table:created', () => this.invalidate()),
      wb.on('table:updated', () => this.invalidate()),
      wb.on('table:deleted', () => this.invalidate()),
      wb.on('name:created', () => this.invalidate()),
      wb.on('name:updated', () => this.invalidate()),
      wb.on('name:deleted', () => this.invalidate()),
      wb.on('import:complete', () => this.invalidate()),
    );
  }

  getSnapshot(): FormulaMetadataSnapshot {
    return this.snapshot;
  }

  subscribe(subscriber: FormulaMetadataSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  request(): Promise<FormulaAutocompleteMetadata> {
    if (this.snapshot.status === 'disposed' || this.wb.isDisposed) {
      this.dispose();
      return Promise.resolve({ namedRanges: [], tables: [], sheets: [] });
    }

    if (this.snapshot.status === 'ready' && this.snapshot.metadata) {
      return Promise.resolve(this.snapshot.metadata);
    }

    if (this.inFlight) return this.inFlight;

    this.setSnapshot({ ...this.snapshot, status: 'loading' });
    this.inFlight = loadFormulaMetadata(this.wb)
      .then((metadata) => {
        this.inFlight = null;
        this.setSnapshot({
          status: 'ready',
          version: this.snapshot.version + 1,
          metadata,
        });
        return metadata;
      })
      .catch((error) => {
        this.inFlight = null;
        this.setSnapshot({
          status: 'error',
          version: this.snapshot.version + 1,
          metadata: this.snapshot.metadata,
        });
        throw error;
      });

    return this.inFlight;
  }

  invalidate(): void {
    if (this.snapshot.status === 'disposed') return;
    this.setSnapshot({
      status: 'idle',
      version: this.snapshot.version + 1,
      metadata: null,
    });
  }

  dispose(): void {
    if (this.snapshot.status === 'disposed') return;
    for (const disposable of this.disposables.splice(0)) {
      disposeSubscription(disposable);
    }
    this.inFlight = null;
    this.setSnapshot({
      status: 'disposed',
      version: this.snapshot.version + 1,
      metadata: null,
    });
    this.subscribers.clear();
  }

  private setSnapshot(snapshot: FormulaMetadataSnapshot): void {
    this.snapshot = snapshot;
    for (const subscriber of this.subscribers) {
      subscriber();
    }
  }
}

const caches = new WeakMap<FormulaMetadataWorkbookLike, FormulaMetadataCache>();

export function getFormulaMetadataCache(wb: FormulaMetadataWorkbookLike): FormulaMetadataCache {
  let cache = caches.get(wb);
  if (!cache || cache.getSnapshot().status === 'disposed') {
    cache = new FormulaMetadataCache(wb);
    caches.set(wb, cache);
  }
  return cache;
}

export function createFormulaNameCompletionStore(
  metadata: FormulaAutocompleteMetadata | null,
): NameCompletionStoreLike {
  const sheets = metadata?.sheets ?? [];
  const sheetIdByName = new Map(sheets.map((sheet) => [sheet.name, sheet.id]));

  return {
    getDefinedNames: () => {
      const result: Record<string, DefinedNameDefinition> = {};
      for (const namedRange of metadata?.namedRanges ?? []) {
        result[namedRange.name] = {
          refersTo: namedRange.reference,
          scope: namedRange.scope
            ? (sheetIdByName.get(namedRange.scope) ?? namedRange.scope)
            : undefined,
          comment: namedRange.comment,
        };
      }
      return result;
    },
    getTables: () =>
      (metadata?.tables ?? []).map((table) => ({
        name: table.name,
        sheetName: table._sheetName,
        range: table.range,
        columns: table.columns.map((column) => ({ name: column.name })),
      })),
    getTable: (name: string): TableInfo | undefined => {
      const table = metadata?.tables.find((candidate) => candidate.name === name);
      if (!table) return undefined;
      return {
        name: table.name,
        sheetName: table._sheetName,
        range: table.range,
        columns: table.columns.map((column) => ({ name: column.name })),
      };
    },
    getSheets: () => sheets,
  };
}
