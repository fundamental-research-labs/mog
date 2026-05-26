/**
 * Gated API Interfaces - Capability-based API access (Types Only)
 *
 * This file defines ONLY type/interface definitions:
 * - IGatedAppKernelAPI interface (optional interfaces per capability)
 * - ICapabilityIntrospection interface
 * - Gated sub-API interfaces
 *
 * Runtime code (type guard functions: hasTableReadAccess, hasTableFullAccess,
 * hasFilesystemAccess, hasNetworkAccess) has been moved to
 * @mog-sdk/kernel/services/capabilities (gated-api.ts).
 *
 */

import type {
  IAppClipboardAPI,
  IAppColumnsAPI,
  IAppEventsAPI,
  IAppRecordsAPI,
  IAppRelationsAPI,
  IAppTablesAPI,
} from '../apps/api';
import type { INotificationsService, IUndoService } from '../services';
import type { CapabilityScope } from './scope';
import type { CapabilityType } from './types';

// =============================================================================
// Capability Introspection
// =============================================================================

/**
 * Interface for apps to introspect their granted capabilities.
 *
 * Apps can use this to:
 * - Check what capabilities they have before trying to use APIs
 * - Adapt UI based on available capabilities
 * - Determine if they have scoped or full access
 */
export interface ICapabilityIntrospection {
  /**
   * Check if the app has a specific capability.
   *
   * This checks for both direct grants and implied capabilities.
   * For example, if the app has 'cells:write', has('cells:read') returns true.
   *
   * @param capability - The capability to check
   * @returns True if the app has this capability
   */
  has(capability: CapabilityType): boolean;

  /**
   * List all capabilities the app currently has.
   *
   * Includes both directly granted capabilities and implied capabilities.
   *
   * @returns Array of all effective capabilities
   */
  list(): CapabilityType[];

  /**
   * Check if a capability is scoped (limited to specific resources).
   *
   * @param capability - The capability to check
   * @returns True if the capability is scoped
   */
  isScoped(capability: CapabilityType): boolean;

  /**
   * Get the scope for a capability.
   *
   * @param capability - The capability to get scope for
   * @returns The scope, or null if unscoped or not granted
   */
  getScope(capability: CapabilityType): CapabilityScope | null;

  /**
   * Check if the app has access to a specific resource.
   *
   * This is a convenience method combining has() and scope checking.
   *
   * @param capability - The capability required
   * @param resourceType - The type of resource (e.g., 'table')
   * @param resourceId - The ID of the resource (e.g., 'contacts')
   * @returns True if the app can access this resource
   */
  hasAccessTo(capability: CapabilityType, resourceType: string, resourceId: string): boolean;

  /**
   * Request a capability at runtime.
   *
   * This triggers the consent flow for the requested capability.
   * Returns a promise that resolves to true if granted, false if denied.
   *
   * @param capability - The capability to request
   * @param reason - User-facing reason for the request
   * @returns Promise resolving to grant result
   */
  request(capability: CapabilityType, reason: string): Promise<boolean>;

  /**
   * Subscribe to capability changes.
   *
   * Called when capabilities are granted, revoked, or expire.
   * Apps can use this to adapt their UI in real-time.
   *
   * @param callback - Called when capabilities change
   * @returns Unsubscribe function
   */
  onChange(callback: (capabilities: CapabilityType[]) => void): () => void;

  /**
   * Subscribe to capability expiration warnings.
   *
   * Called when a session-only capability is about to expire.
   * Default warning is 60 seconds before expiration.
   *
   * @param callback - Called with the expiring capability
   * @returns Unsubscribe function
   */
  onExpiring(callback: (capability: CapabilityType, expiresInMs: number) => void): () => void;
}

// =============================================================================
// Gated Sub-APIs
// =============================================================================

/**
 * Gated cells API - only methods allowed by granted capabilities.
 */
export interface IGatedCellsAPI {
  // cells:read methods
  readonly get?: (sheetId: string, row: number, col: number) => unknown;
  readonly getRange?: (sheetId: string, range: string) => unknown[][];

  // cells:write methods
  readonly set?: (sheetId: string, row: number, col: number, value: unknown) => void;
  readonly setRange?: (sheetId: string, range: string, values: unknown[][]) => void;
}

/**
 * Gated sheets API - only methods allowed by granted capabilities.
 */
export interface IGatedSheetsAPI {
  // sheets:read methods
  readonly list?: () => Array<{ id: string; name: string }>;
  readonly get?: (sheetId: string) => { id: string; name: string } | null;

  // sheets:create methods
  readonly create?: (name: string) => { id: string; name: string };

  // sheets:delete methods
  readonly delete?: (sheetId: string) => void;

  // sheets:rename methods
  readonly rename?: (sheetId: string, newName: string) => void;
}

/**
 * Gated formulas API - only methods allowed by granted capabilities.
 */
export interface IGatedFormulasAPI {
  // formulas:read methods
  readonly get?: (sheetId: string, row: number, col: number) => string | null;

  // formulas:write methods
  readonly set?: (sheetId: string, row: number, col: number, formula: string) => void;
}

/**
 * Gated formatting API - only methods allowed by granted capabilities.
 */
export interface IGatedFormattingAPI {
  // formatting:read methods
  readonly get?: (sheetId: string, row: number, col: number) => Record<string, unknown>;

  // formatting:write methods
  readonly set?: (
    sheetId: string,
    row: number,
    col: number,
    format: Record<string, unknown>,
  ) => void;
}

/**
 * Gated checkpoints API - only methods allowed by granted capabilities.
 */
export interface IGatedCheckpointsAPI {
  // checkpoints:read methods
  readonly list?: () => Array<{ id: string; name: string; createdAt: number }>;

  // checkpoints:create methods
  readonly create?: (name: string) => { id: string; name: string; createdAt: number };

  // checkpoints:restore methods
  readonly restore?: (checkpointId: string) => void;
}

/**
 * Gated filesystem API - only methods allowed by granted capabilities.
 */
export interface IGatedFilesystemAPI {
  // filesystem:read methods
  readonly read?: (path: string) => Promise<ArrayBuffer>;
  readonly readText?: (path: string) => Promise<string>;
  readonly exists?: (path: string) => Promise<boolean>;
  readonly list?: (path: string) => Promise<string[]>;

  // filesystem:write methods
  readonly write?: (path: string, data: ArrayBuffer) => Promise<void>;
  readonly writeText?: (path: string, text: string) => Promise<void>;

  // filesystem:delete methods
  readonly delete?: (path: string) => Promise<void>;
}

/**
 * Gated dialogs API - only methods allowed by granted capabilities.
 */
export interface IGatedDialogsAPI {
  // dialogs:open methods
  readonly open?: (options?: {
    filters?: Array<{ name: string; extensions: string[] }>;
    multiple?: boolean;
  }) => Promise<string[] | null>;

  // dialogs:save methods
  readonly save?: (options?: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<string | null>;
}

/**
 * Gated shell API - only methods allowed by granted capabilities.
 */
export interface IGatedShellAPI {
  // shell:windowTitle methods
  readonly setWindowTitle?: (title: string) => void;

  // shell:openExternal methods
  readonly openExternal?: (url: string) => Promise<void>;
}

/**
 * Gated network API - only methods allowed by granted capabilities.
 */
export interface IGatedNetworkAPI {
  /**
   * Make an HTTP request.
   *
   * The allowed URLs depend on the granted network capabilities:
   * - network:sameorigin: Only same-origin URLs
   * - network:allowlist: Only user-approved domains
   * - network:localhost: localhost/127.0.0.1
   * - network:any: Any remote URL (excludes localhost unless also granted)
   *
   * Throws CapabilityDeniedError if URL is not allowed.
   */
  readonly fetch?: (url: string, options?: RequestInit) => Promise<Response>;

  /**
   * Get the list of allowed domains (for network:allowlist).
   */
  readonly getAllowedDomains?: () => string[];

  /**
   * Request to add a domain to the allowlist (shows consent dialog).
   */
  readonly requestDomain?: (domain: string, reason: string) => Promise<boolean>;
}

/**
 * Gated connections API - only methods allowed by granted capabilities.
 */
export interface IGatedConnectionsAPI {
  // connections:read methods
  readonly list?: () => Array<{ id: string; name: string; type: string }>;
  readonly query?: (connectionId: string, query: unknown) => Promise<unknown[]>;

  // connections:write methods
  readonly execute?: (connectionId: string, mutation: unknown) => Promise<unknown>;

  // connections:create methods
  readonly create?: (config: unknown) => Promise<{ id: string }>;
  readonly delete?: (connectionId: string) => Promise<void>;

  // connections:native methods
  readonly executeNative?: (connectionId: string, rawQuery: string) => Promise<unknown>;
}

// =============================================================================
// Main Gated API Interface
// =============================================================================

/**
 * The Capability-Gated App Kernel API.
 *
 * Unlike IAppKernelAPI where all interfaces are always present,
 * IGatedAppKernelAPI only exposes interfaces for granted capabilities.
 *
 * Apps check if interfaces exist before using them:
 * ```typescript
 * if (api.tables) {
 *   const tables = api.tables.list();
 * }
 * ```
 *
 * Or use capability introspection:
 * ```typescript
 * if (api.capabilities.has('tables:read')) {
 *   const tables = api.tables!.list();
 * }
 * ```
 *
 * Design:
 * - All sub-APIs are optional (undefined if not granted)
 * - Methods within sub-APIs may also be optional based on read/write capabilities
 * - capabilities introspection is ALWAYS available
 * - undoGroup() is always available (validates capabilities per operation)
 */
export interface IGatedAppKernelAPI {
  // =========================================================================
  // Capability Introspection (Always Available)
  // =========================================================================

  /**
   * Capability introspection - always available.
   * Apps can check their capabilities and request new ones.
   */
  readonly capabilities: ICapabilityIntrospection;

  // =========================================================================
  // Tier 0: Spreadsheet Core (Optional)
  // =========================================================================

  /** Cell operations (requires cells:read and/or cells:write) */
  readonly cells?: IGatedCellsAPI;

  /** Sheet operations (requires sheets:* capabilities) */
  readonly sheets?: IGatedSheetsAPI;

  /** Formula operations (requires formulas:read and/or formulas:write) */
  readonly formulas?: IGatedFormulasAPI;

  /** Formatting operations (requires formatting:read and/or formatting:write) */
  readonly formatting?: IGatedFormattingAPI;

  /** Trigger recalculation (requires recalc:trigger) */
  readonly recalc?: {
    readonly trigger: () => void;
  };

  // =========================================================================
  // Tier 1: Data (Optional)
  // =========================================================================

  /**
   * Table operations (requires tables:* capabilities).
   * From base IAppTablesAPI, but methods may be undefined based on capabilities.
   */
  readonly tables?: Partial<IAppTablesAPI>;

  /**
   * Column operations (requires tables:* capabilities).
   */
  readonly columns?: Partial<IAppColumnsAPI>;

  /**
   * Record operations (requires tables:* capabilities).
   */
  readonly records?: Partial<IAppRecordsAPI>;

  /**
   * Relation operations (requires tables:read).
   */
  readonly relations?: Partial<IAppRelationsAPI>;

  // =========================================================================
  // Tier 2: Services (Optional)
  // =========================================================================

  /**
   * Event subscriptions (requires events:subscribe).
   * Events are filtered by the app's read capabilities.
   */
  readonly events?: IAppEventsAPI;

  /**
   * Clipboard operations (requires clipboard:read and/or clipboard:write).
   */
  readonly clipboard?: Partial<IAppClipboardAPI>;

  /**
   * Undo/redo operations (requires undo:read and/or undo:write).
   */
  readonly undo?: Partial<IUndoService>;

  /**
   * Notifications (requires notifications:send).
   */
  readonly notifications?: Pick<
    INotificationsService,
    'notify' | 'info' | 'success' | 'warning' | 'error'
  >;

  /**
   * Checkpoint operations (requires checkpoints:* capabilities).
   */
  readonly checkpoints?: IGatedCheckpointsAPI;

  // =========================================================================
  // Tier 3: Platform (Optional)
  // =========================================================================

  /**
   * Filesystem operations (requires filesystem:* capabilities).
   */
  readonly filesystem?: IGatedFilesystemAPI;

  /**
   * File dialogs (requires dialogs:open and/or dialogs:save).
   */
  readonly dialogs?: IGatedDialogsAPI;

  /**
   * Shell operations (requires shell:* capabilities).
   */
  readonly shell?: IGatedShellAPI;

  // =========================================================================
  // Tier 4: External (Optional)
  // =========================================================================

  /**
   * Network operations (requires network:* capabilities).
   */
  readonly network?: IGatedNetworkAPI;

  /**
   * Database connections (requires connections:* capabilities).
   */
  readonly connections?: IGatedConnectionsAPI;

  // =========================================================================
  // Undo Grouping (Always Available)
  // =========================================================================

  /**
   * Execute multiple operations as a single undo step.
   *
   * Operations are validated individually as they execute via the scoped APIs.
   * If an operation fails capability checks mid-group, prior operations within
   * the group have already executed. The undo group ensures all successful
   * operations can be reverted as a single undo step.
   *
   * @param fn - Function containing operations to group
   * @param description - Description for undo history
   */
  undoGroup<T>(fn: () => Promise<T> | T, description?: string): Promise<T>;
}
