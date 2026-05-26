import type { TableDriverCapabilities } from '@mog-sdk/contracts/storage';
import { LOCAL_CAPABILITIES } from '../../storage/capabilities';
import type { ConnectionStatus, RowId, TableId } from '@mog-sdk/contracts/storage';
import { rowId as createRowId } from '../../storage/connection';
import type { FilterCondition, FilterGroup, Query } from '@mog-sdk/contracts/storage';
import type {
  DriverError,
  ITableDriver,
  PingResult,
  RecordData,
  TableChange,
  TableRecord,
  TableSchema,
  Unsubscribe,
} from '@mog-sdk/contracts/storage';

/**
 * Generate a unique row ID
 */
function generateRowId(): RowId {
  return createRowId(crypto.randomUUID());
}

/**
 * In-memory table storage for the local driver.
 */
interface TableStorage {
  schema: TableSchema;
  records: Map<string, RecordData>;
  subscribers: Set<(changes: TableChange[]) => void>;
}

/**
 * Local table driver.
 * This is the default driver for local data storage.
 */
export class LocalTableDriver implements ITableDriver {
  readonly id: string;
  readonly type = 'local' as const;
  readonly capabilities: TableDriverCapabilities = LOCAL_CAPABILITIES;

  private _status: ConnectionStatus = 'disconnected';
  private _lastSync: number | null = null;
  private tables: Map<string, TableStorage> = new Map();
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private errorListeners: Set<(error: DriverError) => void> = new Set();

  constructor(id: string = 'local') {
    this.id = id;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get lastSync(): number | null {
    return this._lastSync;
  }

  async connect(): Promise<void> {
    this._status = 'connecting';
    this.notifyStatusChange();

    // Simulate connection
    await new Promise((resolve) => setTimeout(resolve, 10));

    this._status = 'connected';
    this._lastSync = Date.now();
    this.notifyStatusChange();
  }

  async disconnect(): Promise<void> {
    this._status = 'disconnected';
    this.notifyStatusChange();
  }

  async getSchema(tableId: TableId): Promise<TableSchema> {
    const table = this.tables.get(String(tableId));
    if (!table) {
      return { columns: [] };
    }
    return table.schema;
  }

  async getRecords(tableId: TableId, query?: Query): Promise<TableRecord[]> {
    const table = this.tables.get(String(tableId));
    if (!table) {
      return [];
    }

    let records: TableRecord[] = Array.from(table.records.entries()).map(([id, data]) => ({
      _rowId: createRowId(id),
      ...data,
    }));

    // Apply filters
    if (query?.where) {
      records = records.filter((record) => this.matchesFilter(record, query.where!));
    }

    // Apply select (column subset)
    if (query?.select && query.select.length > 0) {
      const selectedColumns = new Set(['_rowId', ...query.select]);
      records = records.map((record) => {
        const filtered: TableRecord = { _rowId: record._rowId };
        for (const key of Object.keys(record)) {
          if (selectedColumns.has(key)) {
            filtered[key] = record[key];
          }
        }
        return filtered;
      });
    }

    // Apply ordering
    if (query?.orderBy && query.orderBy.length > 0) {
      records.sort((a, b) => {
        for (const sort of query.orderBy!) {
          const aVal = a[sort.column];
          const bVal = b[sort.column];

          let cmp = 0;
          if (aVal == null && bVal == null) cmp = 0;
          else if (aVal == null) cmp = -1;
          else if (bVal == null) cmp = 1;
          else if (aVal < bVal) cmp = -1;
          else if (aVal > bVal) cmp = 1;

          if (sort.direction === 'desc') cmp = -cmp;
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    }

    // Apply offset and limit
    if (query?.offset) {
      records = records.slice(query.offset);
    }
    if (query?.limit) {
      records = records.slice(0, query.limit);
    }

    return records;
  }

  async createRecord(tableId: TableId, data: RecordData): Promise<RowId> {
    const table = this.getOrCreateTable(tableId);
    const id = generateRowId();

    table.records.set(String(id), { ...data });
    this._lastSync = Date.now();

    // Notify subscribers
    this.notifyTableChange(tableId, [
      {
        type: 'insert',
        rowId: id,
        data,
      },
    ]);

    return id;
  }

  async updateRecord(tableId: TableId, rowId: RowId, data: Partial<RecordData>): Promise<void> {
    const table = this.tables.get(String(tableId));
    if (!table) {
      throw new Error(`Table not found: ${tableId}`);
    }

    const existing = table.records.get(String(rowId));
    if (!existing) {
      throw new Error(`Record not found: ${rowId}`);
    }

    const previous = { ...existing };
    Object.assign(existing, data);
    this._lastSync = Date.now();

    // Notify subscribers
    this.notifyTableChange(tableId, [
      {
        type: 'update',
        rowId,
        data,
        previous,
      },
    ]);
  }

  async deleteRecord(tableId: TableId, rowId: RowId): Promise<void> {
    const table = this.tables.get(String(tableId));
    if (!table) {
      throw new Error(`Table not found: ${tableId}`);
    }

    if (!table.records.delete(String(rowId))) {
      throw new Error(`Record not found: ${rowId}`);
    }
    this._lastSync = Date.now();

    // Notify subscribers
    this.notifyTableChange(tableId, [
      {
        type: 'delete',
        rowId,
      },
    ]);
  }

  // Batch operations
  async createRecords(tableId: TableId, dataList: RecordData[]): Promise<RowId[]> {
    const table = this.getOrCreateTable(tableId);
    const ids: RowId[] = [];
    const changes: TableChange[] = [];

    for (const data of dataList) {
      const id = generateRowId();
      table.records.set(String(id), { ...data });
      ids.push(id);
      changes.push({ type: 'insert', rowId: id, data });
    }

    this._lastSync = Date.now();
    this.notifyTableChange(tableId, changes);

    return ids;
  }

  async updateRecords(
    tableId: TableId,
    updates: Array<{ rowId: RowId; data: Partial<RecordData> }>,
  ): Promise<void> {
    const table = this.tables.get(String(tableId));
    if (!table) {
      throw new Error(`Table not found: ${tableId}`);
    }

    const changes: TableChange[] = [];

    for (const { rowId, data } of updates) {
      const existing = table.records.get(String(rowId));
      if (!existing) {
        throw new Error(`Record not found: ${rowId}`);
      }

      const previous = { ...existing };
      Object.assign(existing, data);
      changes.push({ type: 'update', rowId, data, previous });
    }

    this._lastSync = Date.now();
    this.notifyTableChange(tableId, changes);
  }

  async deleteRecords(tableId: TableId, rowIds: RowId[]): Promise<void> {
    const table = this.tables.get(String(tableId));
    if (!table) {
      throw new Error(`Table not found: ${tableId}`);
    }

    const changes: TableChange[] = [];

    for (const rowId of rowIds) {
      if (table.records.delete(String(rowId))) {
        changes.push({ type: 'delete', rowId });
      }
    }

    this._lastSync = Date.now();
    this.notifyTableChange(tableId, changes);
  }

  // Subscriptions
  subscribe(tableId: TableId, cb: (changes: TableChange[]) => void): Unsubscribe {
    const table = this.getOrCreateTable(tableId);
    table.subscribers.add(cb);

    return () => {
      table.subscribers.delete(cb);
    };
  }

  // Status listeners
  onStatusChange(cb: (status: ConnectionStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  onError(cb: (error: DriverError) => void): Unsubscribe {
    this.errorListeners.add(cb);
    return () => {
      this.errorListeners.delete(cb);
    };
  }

  async ping(): Promise<PingResult> {
    const start = performance.now();
    // Local driver is always "connected"
    return { latencyMs: performance.now() - start };
  }

  // Helper methods

  private getOrCreateTable(tableId: TableId): TableStorage {
    const key = String(tableId);
    if (!this.tables.has(key)) {
      this.tables.set(key, {
        schema: { columns: [] },
        records: new Map(),
        subscribers: new Set(),
      });
    }
    return this.tables.get(key)!;
  }

  private matchesFilter(record: TableRecord, filter: FilterGroup): boolean {
    const { operator, conditions } = filter;

    if (operator === 'and') {
      return conditions.every((cond) => this.matchesCondition(record, cond));
    } else {
      return conditions.some((cond) => this.matchesCondition(record, cond));
    }
  }

  private matchesCondition(record: TableRecord, condition: FilterCondition | FilterGroup): boolean {
    if ('operator' in condition && ('and' === condition.operator || 'or' === condition.operator)) {
      return this.matchesFilter(record, condition as FilterGroup);
    }

    const fc = condition as FilterCondition;
    const recordValue = record[fc.column];

    switch (fc.operator) {
      case 'eq':
        return recordValue === fc.value;
      case 'neq':
        return recordValue !== fc.value;
      case 'gt':
        return recordValue != null && fc.value != null && recordValue > fc.value;
      case 'gte':
        return recordValue != null && fc.value != null && recordValue >= fc.value;
      case 'lt':
        return recordValue != null && fc.value != null && recordValue < fc.value;
      case 'lte':
        return recordValue != null && fc.value != null && recordValue <= fc.value;
      case 'contains':
        return String(recordValue).includes(String(fc.value));
      case 'startsWith':
        return String(recordValue).startsWith(String(fc.value));
      case 'endsWith':
        return String(recordValue).endsWith(String(fc.value));
      case 'in':
        return fc.value.includes(recordValue as string | number | boolean | null);
      case 'notIn':
        return !fc.value.includes(recordValue as string | number | boolean | null);
      case 'isNull':
        return recordValue == null;
      case 'isNotNull':
        return recordValue != null;
      default:
        return false;
    }
  }

  private notifyTableChange(tableId: TableId, changes: TableChange[]): void {
    const table = this.tables.get(String(tableId));
    if (table) {
      for (const cb of table.subscribers) {
        try {
          cb(changes);
        } catch (e) {
          console.error('Error in table subscriber:', e);
        }
      }
    }
  }

  private notifyStatusChange(): void {
    for (const cb of this.statusListeners) {
      try {
        cb(this._status);
      } catch (e) {
        console.error('Error in status listener:', e);
      }
    }
  }

  // Test helpers

  /** Set schema for a table (for testing) */
  setSchema(tableId: TableId, schema: TableSchema): void {
    const table = this.getOrCreateTable(tableId);
    table.schema = schema;
  }

  /** Clear all tables */
  clear(): void {
    this.tables.clear();
  }

  /** Get number of records in a table */
  getRecordCount(tableId: TableId): number {
    return this.tables.get(String(tableId))?.records.size ?? 0;
  }
}
