/**
 * Kernel Services Interfaces
 *
 * System services that survive app switches.
 *
 * These are the canonical interface definitions for kernel services.
 * Implementations are in @mog-sdk/kernel/services.
 *
 */

import type { CallableDisposable } from '@mog/types-core/disposable'; // Now re-defined as type alias in disposable.ts
import type { Result } from '@mog/types-core/result';

// =============================================================================
// Clipboard Service
// =============================================================================

/** Clipboard operation type */
export type ClipboardOperation = 'copy' | 'cut' | null;

/** Clipboard state machine states */
export type ClipboardState = 'empty' | 'hasCopy' | 'hasCut' | 'pasting';

/** Kernel clipboard service snapshot for consumers */
export interface KernelClipboardSnapshot {
  /** Current state of the clipboard */
  state: ClipboardState;
  /** Current operation (copy/cut/null) */
  operation: ClipboardOperation;
  /** Whether clipboard has data */
  hasData: boolean;
  /** Whether data is stale (source changed) */
  isStale: boolean;
  /** Any error message from paste operations */
  error: string | null;
}

/**
 * CANONICAL clipboard format. All views export TO this, import FROM this.
 *
 * Key insight: `cells` is ALWAYS present (universal format).
 * `tableContext` is OPTIONAL (enables smart paste when available).
 *
 * This is 2N translations (each view: export + import), NOT N x N.
 */
export interface ClipboardPayload {
  /**
   * Cell values as 2D array. ALWAYS present.
   */
  cells: {
    values: unknown[][]; // CellValue[][]
    formulas?: (string | null)[][];
    formats?: (Record<string, unknown> | null)[][]; // Partial<CellFormat>[][]
    rowCount: number;
    colCount: number;
  };

  /**
   * Present when copying from a table context.
   */
  tableContext?: {
    tableId: string;
    rowIds: string[];
    colIds: string[];
    columnSchemas: unknown[]; // ColumnSchema[]
  };

  /**
   * Source view information.
   */
  source: {
    viewType: string; // ViewType
    viewId: string | null;
    sheetId: string | null;
  };

  /**
   * Tab-separated values (TSV) for system clipboard.
   */
  text: string;

  /**
   * HTML table for rich paste into Excel/Google Sheets.
   */
  html?: string;
}

/** Clipboard service interface */
export interface IClipboardService {
  /** Get current clipboard snapshot */
  getSnapshot(): KernelClipboardSnapshot;

  /** Get clipboard payload data */
  getPayload(): ClipboardPayload | null;

  /** Copy data to clipboard */
  copy(payload: ClipboardPayload): void;

  /** Cut data to clipboard */
  cut(payload: ClipboardPayload): void;

  /** Start a paste operation */
  startPaste(): void;

  /** Complete a paste operation */
  completePaste(): void;

  /** Mark paste as failed with error */
  errorPaste(message: string): void;

  /** Clear clipboard */
  clear(): void;

  /** Mark clipboard as stale (source changed) */
  markStale(): void;

  /** Mark clipboard as fresh */
  markFresh(): void;

  /** Subscribe to clipboard changes. Returns CallableDisposable — call directly or .dispose() to unsubscribe. */
  subscribe(listener: (snapshot: KernelClipboardSnapshot) => void): CallableDisposable;

  /** Cleanup resources */
  dispose(): void;
}

// =============================================================================
// Undo Service
// =============================================================================

/** Undo stack item metadata */
export interface UndoStackItem {
  /** Description of the operation */
  description: string | null;
}

/** Undo service state */
export interface UndoServiceState {
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Number of items in undo stack */
  undoStackSize: number;
  /** Number of items in redo stack */
  redoStackSize: number;
  /** Description of next undo operation */
  nextUndoDescription: string | null;
  /** Description of next redo operation */
  nextRedoDescription: string | null;
}

/** Undo state change event */
export interface UndoStateChangeEvent {
  /** Current state */
  state: UndoServiceState;
  /** What triggered this change */
  trigger: 'undo' | 'redo' | 'push' | 'clear' | 'external';
}

/**
 * Typed error enum for undo/redo operations.
 * Mirrors Rust-style discriminated unions for exhaustive handling.
 */
export type UndoError =
  | { type: 'nothing-to-undo' }
  | { type: 'nothing-to-redo' }
  | { type: 'rust-failed'; reason: string };

/** Undo service interface */
export interface IUndoService {
  // State
  getState(): UndoServiceState;
  canUndo(): boolean;
  canRedo(): boolean;
  getNextUndoDescription(): string | null;
  getNextRedoDescription(): string | null;

  // Commands
  undo(): Promise<Result<void, UndoError>>;
  redo(): Promise<Result<void, UndoError>>;
  clear(): void;
  setNextDescription(description: string): void;
  stopCapturing(): void;
  listDescriptions(): string[];

  /**
   * Notify the service that a forward mutation was applied.
   * Refreshes cached undo state from Rust and emits change events.
   * This is ONLY for forward mutations — never call this for undo/redo operations.
   */
  notifyForwardMutation(): Promise<void>;

  // Subscriptions
  subscribe(listener: (event: UndoStateChangeEvent) => void): CallableDisposable;

  // Lifecycle
  dispose(): void;
}

// =============================================================================
// Notifications Service
// =============================================================================

/** Notification severity levels */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

/** Branded type for notification IDs — prevents accidental use of arbitrary strings. */
export type NotificationId = string & { readonly __brand: 'NotificationId' };

/** A single notification */
export interface Notification {
  /** Unique ID for the notification */
  id: NotificationId;
  /** Notification type/severity */
  type: NotificationType;
  /** Short title (optional) */
  title?: string;
  /** Main message content */
  message: string;
  /** Timestamp when created */
  timestamp: number;
  /** Auto-dismiss after this many ms (null = manual dismiss only) */
  duration: number | null;
  /** Whether the notification can be dismissed */
  dismissible: boolean;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/** Options for creating a notification */
export interface NotificationOptions {
  /** Notification type/severity (default: 'info') */
  type?: NotificationType;
  /** Short title */
  title?: string;
  /** Auto-dismiss duration in ms (default: 5000, null for no auto-dismiss) */
  duration?: number | null;
  /** Whether dismissible (default: true) */
  dismissible?: boolean;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/** Notifications service state */
export interface NotificationsState {
  /** Current active notifications (ordered by timestamp, newest first) */
  notifications: Notification[];
  /** Maximum number of notifications to show at once */
  maxVisible: number;
}

/** Notifications service interface */
export interface INotificationsService {
  // State
  getAll(): Notification[];
  getCount(): number;

  // Commands
  notify(message: string, options?: NotificationOptions): NotificationId;
  info(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;
  success(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;
  warning(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;
  error(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;
  dismiss(id: NotificationId): void;
  dismissAll(): void;

  // Subscriptions
  subscribe(listener: (notifications: Notification[]) => void): CallableDisposable;

  // Lifecycle
  dispose(): void;
}

// =============================================================================
// Query Executor Service
// =============================================================================

/** Query executor service interface (minimal contract) */
export interface IQueryExecutor {
  /** Set or replace the external connection resolver */
  setConnectionResolver(resolver: unknown): void;

  /** Register a database connection */
  registerConnection(name: string, config: unknown): void;

  /** Get a connection by name */
  getConnection(name: string): { id: string; [key: string]: unknown } | undefined;

  /** List all registered connection names */
  listConnections(): string[];

  /** Remove a connection by name */
  removeConnection(name: string): void;

  /** Execute a query against a database connection */
  executeQuery(connectionName: string, sql: string, params?: unknown[]): Promise<unknown>;

  /** Get a cached query result */
  getCachedResult(cacheKey: string): unknown[][] | undefined;

  /** Set a cached query result */
  setCachedResult(cacheKey: string, result: unknown[][], metadata?: unknown): void;

  /** Build a cache key from query parameters */
  buildCacheKey(connectionName: string, sql: string, params?: unknown[]): string;

  /** Invalidate cache entries */
  invalidateCache(connectionName?: string): void;

  /** Get cache statistics */
  getCacheStats(): { size: number; hits: number; misses: number };

  /** Register a callback for query completion events */
  onQueryComplete(callback: (event: unknown) => void): CallableDisposable;

  /** Dispose the query executor and clean up resources */
  dispose(): void;
}

// =============================================================================
// Kernel Services Namespace
// =============================================================================

/**
 * Kernel services namespace.
 * These are system services that survive app switches.
 */
export interface IKernelServices {
  /** Cross-app clipboard service */
  readonly clipboard: IClipboardService;

  /** Cross-app undo/redo service */
  readonly undo: IUndoService;

  /** Cross-app notifications/toast service */
  readonly notifications: INotificationsService;

  /** Cross-app query executor service */
  readonly queryExecutor: IQueryExecutor;
}
