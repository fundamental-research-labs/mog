import { KernelError } from '../../errors';
import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';
import { toDisposable } from '@mog/spreadsheet-utils/disposable';
import type { IDisposable } from '../primitives';
import { TypedEventEmitter } from '../primitives';
import type { ConnectionStatus, RowId, SourceConfig, TableBinding, TableId } from './connection';
import type { Query } from './query';
import type {
  ITableDriver,
  RecordData,
  TableChange,
  TableRecord,
  TableSchema,
} from './table-driver';

type Unsubscribe = () => void;

/**
 * Event types for the table registry (discriminated union, kept for backward compat)
 */
export type TableRegistryEvent =
  | { type: 'driver-registered'; driverId: string }
  | { type: 'driver-removed'; driverId: string }
  | { type: 'table-bound'; tableId: TableId; driverId: string }
  | { type: 'table-unbound'; tableId: TableId }
  | { type: 'connection-status-changed'; driverId: string; status: ConnectionStatus };

/**
 * Typed event map for the table registry.
 * Each key maps to its specific payload from the RegistryEvent union.
 */
export type TableRegistryEvents = {
  'driver-registered': { driverId: string };
  'driver-removed': { driverId: string };
  'table-bound': { tableId: TableId; driverId: string };
  'table-unbound': { tableId: TableId };
  'connection-status-changed': { driverId: string; status: ConnectionStatus };
};

// =============================================================================
// ITableRegistry Interface
// =============================================================================

/**
 * Public interface for the Table Registry service.
 *
 * Routes table operations to the appropriate driver. Apps interact with tables
 * through this interface without knowing which driver handles the data.
 */
export interface ITableRegistry extends IDisposable {
  // ===========================================================================
  // Driver Management
  // ===========================================================================

  /** Register a driver with the registry. */
  registerDriver(driver: ITableDriver): void;

  /** Remove a driver from the registry. */
  removeDriver(driverId: string): void;

  /** Set the default driver (used when table has no explicit binding). */
  setDefaultDriver(driverId: string): void;

  /** Get a driver by ID. */
  getDriver(driverId: string): ITableDriver | undefined;

  /** Get all registered drivers. */
  getAllDrivers(): ITableDriver[];

  // ===========================================================================
  // Table Bindings
  // ===========================================================================

  /** Bind a table to a specific driver. */
  bindTable(tableId: TableId, driverId: string, sourceConfig: SourceConfig): void;

  /** Remove a table binding. */
  unbindTable(tableId: TableId): void;

  /** Get the binding for a table. */
  getBinding(tableId: TableId): TableBinding | undefined;

  /** Get all table bindings. */
  getAllBindings(): TableBinding[];

  /** Get the driver for a table (respects bindings, falls back to default). */
  getDriverForTable(tableId: TableId): ITableDriver;

  // ===========================================================================
  // CRUD Operations (delegate to drivers)
  // ===========================================================================

  getSchema(tableId: TableId): Promise<TableSchema>;
  getRecords(tableId: TableId, query?: Query): Promise<TableRecord[]>;
  createRecord(tableId: TableId, data: RecordData): Promise<RowId>;
  updateRecord(tableId: TableId, rowId: RowId, data: Partial<RecordData>): Promise<void>;
  deleteRecord(tableId: TableId, rowId: RowId): Promise<void>;

  // Batch operations (with fallback to sequential)
  createRecords(tableId: TableId, dataList: RecordData[]): Promise<RowId[]>;
  updateRecords(
    tableId: TableId,
    updates: Array<{ rowId: RowId; data: Partial<RecordData> }>,
  ): Promise<void>;
  deleteRecords(tableId: TableId, rowIds: RowId[]): Promise<void>;

  // ===========================================================================
  // Subscriptions & Refresh
  // ===========================================================================

  /** Subscribe to table changes from the driver. */
  subscribe(tableId: TableId, cb: (changes: TableChange[]) => void): Unsubscribe;

  /** Manual refresh (for external sources). */
  refresh(tableId: TableId): Promise<void>;

  // ===========================================================================
  // Event Subscriptions (from TypedEventEmitter)
  // ===========================================================================

  /** Subscribe to a named event. Returns CallableDisposable for unsubscription. */
  on<K extends keyof TableRegistryEvents>(
    event: K,
    handler: (data: TableRegistryEvents[K]) => void,
  ): CallableDisposable;

  /** Subscribe to the next occurrence of a named event only. */
  once<K extends keyof TableRegistryEvents>(
    event: K,
    handler: (data: TableRegistryEvents[K]) => void,
  ): CallableDisposable;

  /** Subscribe to all registry events (convenience wrapper). */
  onEvent(cb: (event: TableRegistryEvent) => void): CallableDisposable;

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /** Connect all disconnected drivers. */
  connectAll(): Promise<void>;

  /** Disconnect all connected drivers. */
  disconnectAll(): Promise<void>;
}

/**
 * Table Registry - routes table operations to the appropriate driver.
 *
 * Apps interact with tables through the registry without knowing which
 * driver handles the data. The registry:
 *
 * 1. Manages driver registration and lifecycle
 * 2. Maintains table → driver bindings
 * 3. Provides a unified API for CRUD operations
 * 4. Handles fallbacks for drivers without batch operations
 *
 * Extends TypedEventEmitter for typed, error-isolated event subscriptions.
 * Use `on('driver-registered', handler)` for specific events, or
 * `onEvent(handler)` for all events (backward compat convenience).
 */
class TableRegistry extends TypedEventEmitter<TableRegistryEvents> implements ITableRegistry {
  private drivers: Map<string, ITableDriver> = new Map();
  private bindings: Map<string, TableBinding> = new Map(); // tableId → binding
  private defaultDriverId: string | null = null;

  /**
   * Register a driver with the registry.
   */
  registerDriver(driver: ITableDriver): void {
    if (this.drivers.has(driver.id)) {
      throw new KernelError('REGISTRY_DRIVER_EXISTS', `Driver already registered: ${driver.id}`);
    }

    this.drivers.set(driver.id, driver);

    // Set as default if it's local and we don't have one
    if (driver.capabilities.isLocal && !this.defaultDriverId) {
      this.defaultDriverId = driver.id;
    }

    this.emit('driver-registered', { driverId: driver.id });
  }

  /**
   * Remove a driver from the registry.
   */
  removeDriver(driverId: string): void {
    const driver = this.drivers.get(driverId);
    if (!driver) return;

    // Disconnect if connected
    if (driver.status === 'connected') {
      driver.disconnect().catch(console.error);
    }

    // Remove any bindings using this driver
    for (const [tableId, binding] of this.bindings) {
      if (binding.connectionId === driverId) {
        this.bindings.delete(tableId);
        this.emit('table-unbound', { tableId: tableId as TableId });
      }
    }

    this.drivers.delete(driverId);

    if (this.defaultDriverId === driverId) {
      this.defaultDriverId = null;
    }

    this.emit('driver-removed', { driverId });
  }

  /**
   * Set the default driver (used when table has no explicit binding).
   */
  setDefaultDriver(driverId: string): void {
    if (!this.drivers.has(driverId)) {
      throw new KernelError('REGISTRY_DRIVER_NOT_FOUND', `Driver not found: ${driverId}`);
    }
    this.defaultDriverId = driverId;
  }

  /**
   * Get a driver by ID.
   */
  getDriver(driverId: string): ITableDriver | undefined {
    return this.drivers.get(driverId);
  }

  /**
   * Get all registered drivers.
   */
  getAllDrivers(): ITableDriver[] {
    return Array.from(this.drivers.values());
  }

  /**
   * Bind a table to a specific driver.
   */
  bindTable(tableId: TableId, driverId: string, sourceConfig: SourceConfig): void {
    if (!this.drivers.has(driverId)) {
      throw new KernelError('REGISTRY_DRIVER_NOT_FOUND', `Driver not found: ${driverId}`);
    }

    this.bindings.set(String(tableId), {
      tableId,
      connectionId: driverId,
      sourceConfig,
    });

    this.emit('table-bound', { tableId, driverId });
  }

  /**
   * Remove a table binding.
   */
  unbindTable(tableId: TableId): void {
    const key = String(tableId);
    if (this.bindings.has(key)) {
      this.bindings.delete(key);
      this.emit('table-unbound', { tableId });
    }
  }

  /**
   * Get the binding for a table.
   */
  getBinding(tableId: TableId): TableBinding | undefined {
    return this.bindings.get(String(tableId));
  }

  /**
   * Get all table bindings.
   */
  getAllBindings(): TableBinding[] {
    return Array.from(this.bindings.values());
  }

  /**
   * Get the driver for a table (respects bindings, falls back to default).
   */
  getDriverForTable(tableId: TableId): ITableDriver {
    const binding = this.bindings.get(String(tableId));

    if (binding) {
      const driver = this.drivers.get(binding.connectionId);
      if (driver) return driver;
    }

    if (this.defaultDriverId) {
      const defaultDriver = this.drivers.get(this.defaultDriverId);
      if (defaultDriver) return defaultDriver;
    }

    throw new KernelError('REGISTRY_DRIVER_NOT_FOUND', `No driver available for table: ${tableId}`);
  }

  // ===== CRUD Operations (delegate to drivers) =====

  async getSchema(tableId: TableId): Promise<TableSchema> {
    const driver = this.getDriverForTable(tableId);
    return driver.getSchema(tableId);
  }

  async getRecords(tableId: TableId, query?: Query): Promise<TableRecord[]> {
    const driver = this.getDriverForTable(tableId);
    return driver.getRecords(tableId, query);
  }

  async createRecord(tableId: TableId, data: RecordData): Promise<RowId> {
    const driver = this.getDriverForTable(tableId);
    return driver.createRecord(tableId, data);
  }

  async updateRecord(tableId: TableId, rowId: RowId, data: Partial<RecordData>): Promise<void> {
    const driver = this.getDriverForTable(tableId);
    return driver.updateRecord(tableId, rowId, data);
  }

  async deleteRecord(tableId: TableId, rowId: RowId): Promise<void> {
    const driver = this.getDriverForTable(tableId);
    return driver.deleteRecord(tableId, rowId);
  }

  // Batch operations with fallback

  async createRecords(tableId: TableId, dataList: RecordData[]): Promise<RowId[]> {
    const driver = this.getDriverForTable(tableId);

    if (driver.createRecords) {
      return driver.createRecords(tableId, dataList);
    }

    // Fallback to sequential creates
    const ids: RowId[] = [];
    for (const data of dataList) {
      const id = await driver.createRecord(tableId, data);
      ids.push(id);
    }
    return ids;
  }

  async updateRecords(
    tableId: TableId,
    updates: Array<{ rowId: RowId; data: Partial<RecordData> }>,
  ): Promise<void> {
    const driver = this.getDriverForTable(tableId);

    if (driver.updateRecords) {
      return driver.updateRecords(tableId, updates);
    }

    // Fallback to sequential updates
    for (const { rowId, data } of updates) {
      await driver.updateRecord(tableId, rowId, data);
    }
  }

  async deleteRecords(tableId: TableId, rowIds: RowId[]): Promise<void> {
    const driver = this.getDriverForTable(tableId);

    if (driver.deleteRecords) {
      return driver.deleteRecords(tableId, rowIds);
    }

    // Fallback to sequential deletes
    for (const rowId of rowIds) {
      await driver.deleteRecord(tableId, rowId);
    }
  }

  // Subscriptions

  subscribe(tableId: TableId, cb: (changes: TableChange[]) => void): Unsubscribe {
    const driver = this.getDriverForTable(tableId);

    if (!driver.subscribe) {
      console.warn(`Driver ${driver.id} does not support subscriptions`);
      return () => {};
    }

    return driver.subscribe(tableId, cb);
  }

  // Manual refresh (for external sources)

  async refresh(tableId: TableId): Promise<void> {
    const driver = this.getDriverForTable(tableId);

    if (driver.refresh) {
      return driver.refresh(tableId);
    }

    // No-op for drivers without refresh
  }

  // Event listeners

  /**
   * Subscribe to all registry events (convenience wrapper).
   * Returns CallableDisposable — call directly or .dispose() to unsubscribe from all events.
   *
   * For typed per-event subscriptions, use `on('driver-registered', handler)` etc.
   */
  onEvent(cb: (event: TableRegistryEvent) => void): CallableDisposable {
    const subs = [
      this.on('driver-registered', (data) => cb({ type: 'driver-registered', ...data })),
      this.on('driver-removed', (data) => cb({ type: 'driver-removed', ...data })),
      this.on('table-bound', (data) => cb({ type: 'table-bound', ...data })),
      this.on('table-unbound', (data) => cb({ type: 'table-unbound', ...data })),
      this.on('connection-status-changed', (data) =>
        cb({ type: 'connection-status-changed', ...data }),
      ),
    ];

    return toDisposable(() => {
      for (const sub of subs) sub.dispose();
    });
  }

  // Connection management

  async connectAll(): Promise<void> {
    const promises = Array.from(this.drivers.values())
      .filter((d) => d.status === 'disconnected')
      .map((d) => d.connect().catch((e) => console.error(`Failed to connect ${d.id}:`, e)));

    await Promise.all(promises);
  }

  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.drivers.values())
      .filter((d) => d.status === 'connected')
      .map((d) => d.disconnect().catch((e) => console.error(`Failed to disconnect ${d.id}:`, e)));

    await Promise.all(promises);
  }

  // Lifecycle

  protected _dispose(): void {
    this.drivers.clear();
    this.bindings.clear();
    this.defaultDriverId = null;
    super._dispose(); // clears event handlers
  }
}

// Singleton instance for the kernel
let registryInstance: TableRegistry | null = null;

export function getTableRegistry(): ITableRegistry {
  if (!registryInstance) {
    registryInstance = new TableRegistry();
  }
  return registryInstance;
}

export function resetTableRegistry(): void {
  if (registryInstance) {
    registryInstance.disconnectAll().catch(console.error);
    registryInstance.dispose();
  }
  registryInstance = null;
}
