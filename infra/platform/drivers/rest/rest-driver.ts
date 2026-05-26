import type { TableDriverCapabilities } from '@mog-sdk/contracts/storage';
import type {
  ConnectionStatus,
  RestConnectionConfig,
  RowId,
  TableId,
} from '@mog-sdk/contracts/storage';
import { rowId as createRowId } from '../../storage/connection';
import type { FilterCondition, FilterGroup, Query } from '@mog-sdk/contracts/storage';
import type {
  DriverError,
  ITableDriver,
  PingResult,
  RecordData,
  TableRecord,
  TableSchema,
  Unsubscribe,
} from '@mog-sdk/contracts/storage';

/**
 * Configuration for how to map API responses to records
 */
export interface RestSchemaMapping {
  /** Path to the array of records in the response (e.g., "data.items") */
  recordsPath?: string;
  /** Path to the total count (for pagination) */
  totalPath?: string;
  /** Field to use as row ID */
  idField?: string;
}

/**
 * REST API table driver.
 * Connects to external REST APIs for data access.
 */
export class RestTableDriver implements ITableDriver {
  readonly id: string;
  readonly type = 'rest' as const;

  private _status: ConnectionStatus = 'disconnected';
  private _lastSync: number | null = null;
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private errorListeners: Set<(error: DriverError) => void> = new Set();
  private schemaMapping: RestSchemaMapping;

  constructor(
    private config: RestConnectionConfig,
    schemaMapping?: RestSchemaMapping,
  ) {
    this.id = config.id;
    this.schemaMapping = schemaMapping ?? {
      recordsPath: 'data',
      idField: 'id',
    };
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get lastSync(): number | null {
    return this._lastSync;
  }

  get capabilities(): TableDriverCapabilities {
    return {
      canCreate: !!this.config.endpoints.create,
      canUpdate: !!this.config.endpoints.update,
      canDelete: !!this.config.endpoints.delete,
      canStream: false,
      isLocal: false,
      supportsTransactions: false,
      supportsNativeQuery: false,
      supportsBatch: false,
      supportsWatch: false,
    };
  }

  async connect(): Promise<void> {
    this._status = 'connecting';
    this.notifyStatusChange();

    try {
      // Test connection with a simple request
      const pingResult = await this.ping();
      if ('error' in pingResult) {
        throw new Error(pingResult.error);
      }

      this._status = 'connected';
      this._lastSync = Date.now();
      this.notifyStatusChange();
    } catch (error) {
      this._status = 'error';
      this.notifyStatusChange();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this._status = 'disconnected';
    this.notifyStatusChange();
  }

  async getSchema(_tableId: TableId): Promise<TableSchema> {
    // REST APIs typically don't expose schema
    // Could fetch a sample record and infer types
    return { columns: [] };
  }

  async getRecords(tableId: TableId, query?: Query): Promise<TableRecord[]> {
    if (!this.config.endpoints.list) {
      throw new Error('List endpoint not configured');
    }

    const url = this.buildUrl(this.config.endpoints.list, tableId, query);
    const response = await this.fetch(url);

    this._lastSync = Date.now();

    const data = await response.json();
    const records = this.extractRecords(data);

    return records.map((r) => this.toTableRecord(r));
  }

  async createRecord(tableId: TableId, data: RecordData): Promise<RowId> {
    if (!this.config.endpoints.create) {
      throw new Error('Create endpoint not configured');
    }

    const url = this.buildUrl(this.config.endpoints.create, tableId);
    const response = await this.fetch(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });

    this._lastSync = Date.now();

    const result = await response.json();
    const idField = this.schemaMapping.idField ?? 'id';
    return createRowId(String(result[idField] ?? result.data?.[idField] ?? crypto.randomUUID()));
  }

  async updateRecord(tableId: TableId, rowId: RowId, data: Partial<RecordData>): Promise<void> {
    if (!this.config.endpoints.update) {
      throw new Error('Update endpoint not configured');
    }

    const url = this.buildUrl(this.config.endpoints.update, tableId, undefined, rowId);
    await this.fetch(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    });

    this._lastSync = Date.now();
  }

  async deleteRecord(tableId: TableId, rowId: RowId): Promise<void> {
    if (!this.config.endpoints.delete) {
      throw new Error('Delete endpoint not configured');
    }

    const url = this.buildUrl(this.config.endpoints.delete, tableId, undefined, rowId);
    await this.fetch(url, { method: 'DELETE' });

    this._lastSync = Date.now();
  }

  // Status listeners
  onStatusChange(cb: (status: ConnectionStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onError(cb: (error: DriverError) => void): Unsubscribe {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  async ping(): Promise<PingResult> {
    const start = performance.now();
    try {
      // Try to hit the list endpoint with limit=1
      const url = new URL(this.config.baseUrl);
      const response = await fetch(url.toString(), {
        method: 'HEAD',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return { error: `HTTP ${response.status}` };
      }

      return { latencyMs: performance.now() - start };
    } catch (e) {
      return { error: String(e) };
    }
  }

  async refresh(_tableId: TableId): Promise<void> {
    // Just update lastSync - actual refresh happens on next getRecords
    this._lastSync = Date.now();
  }

  // ===== Private helpers =====

  private buildUrl(endpointTemplate: string, tableId: TableId, query?: Query, rowId?: RowId): URL {
    // Replace placeholders in endpoint
    const endpoint = endpointTemplate
      .replace('{tableId}', String(tableId))
      .replace('{id}', rowId ? String(rowId) : '');

    const url = new URL(endpoint, this.config.baseUrl);

    // Add query parameters
    if (query) {
      // Filters
      if (query.where) {
        this.addFilterParams(url.searchParams, query.where);
      }

      // Pagination
      if (this.config.pagination) {
        const { pageParam = 'page', limitParam = 'limit' } = this.config.pagination;

        if (query.limit) {
          url.searchParams.set(limitParam, String(query.limit));
        }
        if (query.offset && this.config.pagination.type === 'offset') {
          const page = Math.floor(query.offset / (query.limit ?? 10));
          url.searchParams.set(pageParam, String(page));
        }
      }

      // Sorting
      if (query.orderBy && query.orderBy.length > 0) {
        const sortValue = query.orderBy
          .map((s) => (s.direction === 'desc' ? `-${s.column}` : s.column))
          .join(',');
        url.searchParams.set('sort', sortValue);
      }
    }

    return url;
  }

  private addFilterParams(params: URLSearchParams, filter: FilterGroup): void {
    // Simple filter mapping - APIs vary widely
    for (const cond of filter.conditions) {
      if ('column' in cond) {
        const fc = cond as FilterCondition;
        const paramName = `filter[${fc.column}]`;

        switch (fc.operator) {
          case 'eq':
            params.set(paramName, String(fc.value));
            break;
          case 'neq':
            params.set(`${paramName}[ne]`, String(fc.value));
            break;
          case 'gt':
            params.set(`${paramName}[gt]`, String(fc.value));
            break;
          case 'gte':
            params.set(`${paramName}[gte]`, String(fc.value));
            break;
          case 'lt':
            params.set(`${paramName}[lt]`, String(fc.value));
            break;
          case 'lte':
            params.set(`${paramName}[lte]`, String(fc.value));
            break;
          case 'contains':
            params.set(`${paramName}[contains]`, String(fc.value));
            break;
          case 'in':
            params.set(`${paramName}[in]`, fc.value.join(','));
            break;
          // Add more as needed
        }
      }
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.config.headers,
    };
  }

  private async fetch(url: URL, options?: RequestInit): Promise<Response> {
    const response = await fetch(url.toString(), {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...(options?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const error: DriverError = {
        type: 'query_failed',
        query: url.toString(),
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
      this.notifyError(error);
      throw new Error(error.message);
    }

    return response;
  }

  private extractRecords(data: unknown): unknown[] {
    if (!this.schemaMapping.recordsPath) {
      return Array.isArray(data) ? data : [data];
    }

    const path = this.schemaMapping.recordsPath.split('.');
    let current: unknown = data;

    for (const key of path) {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        return [];
      }
      current = (current as Record<string, unknown>)[key];
    }

    return Array.isArray(current) ? current : [];
  }

  private toTableRecord(data: unknown): TableRecord {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      const rowId = createRowId(crypto.randomUUID());
      return { _rowId: rowId };
    }
    const record = data as Record<string, unknown>;
    const idField = this.schemaMapping.idField ?? 'id';
    const rowId = createRowId(String(record[idField] ?? crypto.randomUUID()));
    return { _rowId: rowId, ...record };
  }

  private notifyStatusChange(): void {
    for (const cb of this.statusListeners) {
      try {
        cb(this._status);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private notifyError(error: DriverError): void {
    for (const cb of this.errorListeners) {
      try {
        cb(error);
      } catch (e) {
        console.error(e);
      }
    }
  }
}
