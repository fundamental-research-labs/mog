/**
 * Permission Enforcer
 *
 * Enforces permission requirements for extension API calls.
 * All permissions are checked on the host side - extensions are untrusted.
 *
 * @module extensions/permissions
 */

import type { ExtensionPermission } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a permission check
 */
export interface PermissionCheckResult {
  /** Whether the permission check passed */
  allowed: boolean;
  /** If denied, the missing permissions */
  missingPermissions?: ExtensionPermission[];
  /** If denied, a human-readable message */
  denialReason?: string;
}

/**
 * Method permission requirement
 */
export interface MethodPermission {
  /** Required permissions (ALL must be present) */
  required: ExtensionPermission[];
  /** Optional description for documentation */
  description?: string;
}

/**
 * Options for creating a PermissionEnforcer
 */
export interface PermissionEnforcerOptions {
  /**
   * Custom permission map to use instead of the default.
   * Useful for testing or extending the default permissions.
   */
  permissionMap?: Map<string, MethodPermission>;

  /**
   * If true, unknown methods are allowed (returns empty required permissions).
   * Default: false (deny by default)
   */
  allowUnknownMethods?: boolean;

  /**
   * Callback when a permission is denied.
   * Useful for logging/auditing.
   */
  onDenied?: (
    method: string,
    granted: ExtensionPermission[],
    required: ExtensionPermission[],
  ) => void;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base error for permission-related errors
 */
export class PermissionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

/**
 * Error thrown when a method requires permissions the extension doesn't have
 */
export class PermissionDeniedError extends PermissionError {
  constructor(
    public readonly method: string,
    public readonly requiredPermissions: ExtensionPermission[],
    public readonly grantedPermissions: ExtensionPermission[],
  ) {
    const missing = requiredPermissions.filter((p) => !grantedPermissions.includes(p));
    super('PERMISSION_DENIED', `Method '${method}' requires permissions: ${missing.join(', ')}`, {
      method,
      required: requiredPermissions,
      granted: grantedPermissions,
      missing,
    });
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Error thrown when an unknown method is called (and allowUnknownMethods is false)
 */
export class MethodNotFoundError extends PermissionError {
  constructor(public readonly method: string) {
    super('METHOD_NOT_FOUND', `Unknown method: '${method}'`, { method });
    this.name = 'MethodNotFoundError';
  }
}

// =============================================================================
// Default Permission Map
// =============================================================================

/**
 * Default permission requirements for all API methods.
 * This maps method names to the permissions required to call them.
 *
 * Security principle: Deny by default. If a method is not in this map,
 * it cannot be called by extensions.
 */
export const DEFAULT_PERMISSION_MAP: Map<string, MethodPermission> = new Map([
  // ---------------------------------------------------------------------------
  // Spreadsheet Read Operations
  // ---------------------------------------------------------------------------
  ['sheet.getCell', { required: ['spreadsheet:read'], description: 'Read a single cell value' }],
  ['sheet.getRange', { required: ['spreadsheet:read'], description: 'Read a range of cells' }],
  ['sheet.getFormula', { required: ['spreadsheet:read'], description: 'Read a cell formula' }],
  [
    'sheet.getFormulas',
    { required: ['spreadsheet:read'], description: 'Read formulas in a range' },
  ],
  ['sheet.getValues', { required: ['spreadsheet:read'], description: 'Read values in a range' }],
  [
    'sheet.getUsedRange',
    { required: ['spreadsheet:read'], description: 'Get the used range of a sheet' },
  ],
  ['sheet.getSheetNames', { required: ['spreadsheet:read'], description: 'Get all sheet names' }],
  [
    'sheet.getActiveSheet',
    { required: ['spreadsheet:read'], description: 'Get the active sheet info' },
  ],
  ['sheet.getRowCount', { required: ['spreadsheet:read'], description: 'Get number of rows' }],
  [
    'sheet.getColumnCount',
    { required: ['spreadsheet:read'], description: 'Get number of columns' },
  ],

  // ---------------------------------------------------------------------------
  // Spreadsheet Write Operations
  // ---------------------------------------------------------------------------
  ['sheet.setCell', { required: ['spreadsheet:write'], description: 'Write a single cell value' }],
  ['sheet.setRange', { required: ['spreadsheet:write'], description: 'Write values to a range' }],
  ['sheet.setFormula', { required: ['spreadsheet:write'], description: 'Set a cell formula' }],
  [
    'sheet.setFormulas',
    { required: ['spreadsheet:write'], description: 'Set formulas in a range' },
  ],
  ['sheet.setValues', { required: ['spreadsheet:write'], description: 'Set values in a range' }],
  ['sheet.clear', { required: ['spreadsheet:write'], description: 'Clear a range' }],
  ['sheet.clearContents', { required: ['spreadsheet:write'], description: 'Clear contents only' }],

  // ---------------------------------------------------------------------------
  // Spreadsheet Format Operations
  // ---------------------------------------------------------------------------
  ['sheet.setFormat', { required: ['spreadsheet:format'], description: 'Set cell formatting' }],
  ['sheet.setNumberFormat', { required: ['spreadsheet:format'], description: 'Set number format' }],
  ['sheet.setFont', { required: ['spreadsheet:format'], description: 'Set font properties' }],
  ['sheet.setFill', { required: ['spreadsheet:format'], description: 'Set fill/background' }],
  ['sheet.setBorder', { required: ['spreadsheet:format'], description: 'Set borders' }],
  ['sheet.setAlignment', { required: ['spreadsheet:format'], description: 'Set alignment' }],
  ['sheet.clearFormat', { required: ['spreadsheet:format'], description: 'Clear formatting' }],
  [
    'sheet.autoFitColumns',
    { required: ['spreadsheet:format'], description: 'Auto-fit column widths' },
  ],
  ['sheet.autoFitRows', { required: ['spreadsheet:format'], description: 'Auto-fit row heights' }],
  ['sheet.setColumnWidth', { required: ['spreadsheet:format'], description: 'Set column width' }],
  ['sheet.setRowHeight', { required: ['spreadsheet:format'], description: 'Set row height' }],
  ['sheet.merge', { required: ['spreadsheet:format'], description: 'Merge cells' }],
  ['sheet.unmerge', { required: ['spreadsheet:format'], description: 'Unmerge cells' }],

  // ---------------------------------------------------------------------------
  // Spreadsheet Structure Operations
  // ---------------------------------------------------------------------------
  ['sheet.insertRow', { required: ['spreadsheet:structure'], description: 'Insert a row' }],
  [
    'sheet.insertRows',
    { required: ['spreadsheet:structure'], description: 'Insert multiple rows' },
  ],
  ['sheet.deleteRow', { required: ['spreadsheet:structure'], description: 'Delete a row' }],
  [
    'sheet.deleteRows',
    { required: ['spreadsheet:structure'], description: 'Delete multiple rows' },
  ],
  ['sheet.insertColumn', { required: ['spreadsheet:structure'], description: 'Insert a column' }],
  [
    'sheet.insertColumns',
    { required: ['spreadsheet:structure'], description: 'Insert multiple columns' },
  ],
  ['sheet.deleteColumn', { required: ['spreadsheet:structure'], description: 'Delete a column' }],
  [
    'sheet.deleteColumns',
    { required: ['spreadsheet:structure'], description: 'Delete multiple columns' },
  ],
  ['sheet.addSheet', { required: ['spreadsheet:structure'], description: 'Add a new sheet' }],
  ['sheet.deleteSheet', { required: ['spreadsheet:structure'], description: 'Delete a sheet' }],
  ['sheet.renameSheet', { required: ['spreadsheet:structure'], description: 'Rename a sheet' }],
  [
    'sheet.duplicateSheet',
    { required: ['spreadsheet:structure'], description: 'Duplicate a sheet' },
  ],
  ['sheet.moveSheet', { required: ['spreadsheet:structure'], description: 'Move sheet position' }],
  ['sheet.hideSheet', { required: ['spreadsheet:structure'], description: 'Hide a sheet' }],
  ['sheet.showSheet', { required: ['spreadsheet:structure'], description: 'Show a hidden sheet' }],

  // ---------------------------------------------------------------------------
  // Selection Operations
  // ---------------------------------------------------------------------------
  ['selection.get', { required: ['selection:read'], description: 'Get current selection' }],
  ['selection.getRange', { required: ['selection:read'], description: 'Get selection range' }],
  [
    'selection.getValues',
    { required: ['selection:read', 'spreadsheet:read'], description: 'Get selected values' },
  ],
  ['selection.set', { required: ['selection:write'], description: 'Set selection' }],
  ['selection.select', { required: ['selection:write'], description: 'Select a range' }],

  // ---------------------------------------------------------------------------
  // Chart Read Operations
  // ---------------------------------------------------------------------------
  ['chart.get', { required: ['charts:read'], description: 'Get chart by ID' }],
  ['chart.getAll', { required: ['charts:read'], description: 'Get all charts' }],
  ['chart.getData', { required: ['charts:read'], description: 'Get chart data' }],

  // ---------------------------------------------------------------------------
  // Chart Write Operations
  // ---------------------------------------------------------------------------
  ['chart.create', { required: ['charts:write'], description: 'Create a chart' }],
  ['chart.update', { required: ['charts:write'], description: 'Update a chart' }],
  ['chart.delete', { required: ['charts:write'], description: 'Delete a chart' }],
  ['chart.setTitle', { required: ['charts:write'], description: 'Set chart title' }],
  ['chart.setType', { required: ['charts:write'], description: 'Change chart type' }],
  ['chart.setDataRange', { required: ['charts:write'], description: 'Set chart data range' }],

  // ---------------------------------------------------------------------------
  // User Operations (Future)
  // ---------------------------------------------------------------------------
  ['user.getName', { required: ['user:read'], description: 'Get user name' }],
  ['user.getEmail', { required: ['user:read'], description: 'Get user email' }],

  // ---------------------------------------------------------------------------
  // Network Operations (Future)
  // ---------------------------------------------------------------------------
  ['network.fetch', { required: ['network:fetch'], description: 'Make network request via host' }],
]);

// =============================================================================
// PermissionEnforcer Class
// =============================================================================

/**
 * Enforces permission requirements for extension API calls.
 *
 * Usage:
 * ```typescript
 * const enforcer = new PermissionEnforcer();
 * const granted: ExtensionPermission[] = ['spreadsheet:read', 'selection:read'];
 *
 * // Check if allowed
 * const result = enforcer.check('sheet.getCell', granted);
 * if (!result.allowed) {
 * console.error(result.denialReason);
 * }
 *
 * // Or throw on denial
 * enforcer.enforce('sheet.getCell', granted); // throws if not allowed
 * ```
 */
export class PermissionEnforcer {
  private readonly permissionMap: Map<string, MethodPermission>;
  private readonly allowUnknownMethods: boolean;
  private readonly onDenied?: (
    method: string,
    granted: ExtensionPermission[],
    required: ExtensionPermission[],
  ) => void;

  constructor(options: PermissionEnforcerOptions = {}) {
    this.permissionMap = options.permissionMap ?? new Map(DEFAULT_PERMISSION_MAP);
    this.allowUnknownMethods = options.allowUnknownMethods ?? false;
    this.onDenied = options.onDenied;
  }

  // ---------------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------------

  /**
   * Check if the given permissions allow calling the method.
   * Does not throw - returns a result object.
   */
  check(method: string, grantedPermissions: ExtensionPermission[]): PermissionCheckResult {
    const methodPermission = this.permissionMap.get(method);

    // Unknown method
    if (!methodPermission) {
      if (this.allowUnknownMethods) {
        return { allowed: true };
      }
      return {
        allowed: false,
        denialReason: `Unknown method: '${method}'`,
      };
    }

    // Check all required permissions
    const missing = methodPermission.required.filter((p) => !grantedPermissions.includes(p));

    if (missing.length > 0) {
      this.onDenied?.(method, grantedPermissions, methodPermission.required);
      return {
        allowed: false,
        missingPermissions: missing,
        denialReason: `Method '${method}' requires permissions: ${missing.join(', ')}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Enforce permission requirements for a method.
   * Throws PermissionDeniedError or MethodNotFoundError if not allowed.
   */
  enforce(method: string, grantedPermissions: ExtensionPermission[]): void {
    const methodPermission = this.permissionMap.get(method);

    // Unknown method
    if (!methodPermission) {
      if (this.allowUnknownMethods) {
        return;
      }
      throw new MethodNotFoundError(method);
    }

    // Check all required permissions
    const missing = methodPermission.required.filter((p) => !grantedPermissions.includes(p));

    if (missing.length > 0) {
      this.onDenied?.(method, grantedPermissions, methodPermission.required);
      throw new PermissionDeniedError(method, methodPermission.required, grantedPermissions);
    }
  }

  /**
   * Get the required permissions for a method.
   * Returns undefined if the method is not in the permission map.
   */
  getRequiredPermissions(method: string): ExtensionPermission[] | undefined {
    return this.permissionMap.get(method)?.required;
  }

  /**
   * Check if a method is known (in the permission map).
   */
  isKnownMethod(method: string): boolean {
    return this.permissionMap.has(method);
  }

  /**
   * Get all known methods.
   */
  getKnownMethods(): string[] {
    return Array.from(this.permissionMap.keys());
  }

  /**
   * Get all methods that require a specific permission.
   */
  getMethodsRequiringPermission(permission: ExtensionPermission): string[] {
    const methods: string[] = [];
    for (const [method, { required }] of Array.from(this.permissionMap.entries())) {
      if (required.includes(permission)) {
        methods.push(method);
      }
    }
    return methods;
  }

  /**
   * Get the full permission map (for documentation/debugging).
   */
  getPermissionMap(): ReadonlyMap<string, MethodPermission> {
    return this.permissionMap;
  }

  /**
   * Add or update a method's permission requirements.
   * Useful for extending the default permissions.
   */
  setMethodPermission(method: string, permission: MethodPermission): void {
    this.permissionMap.set(method, permission);
  }

  /**
   * Remove a method from the permission map.
   */
  removeMethodPermission(method: string): boolean {
    return this.permissionMap.delete(method);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new PermissionEnforcer with the given options.
 */
export function createPermissionEnforcer(
  options: PermissionEnforcerOptions = {},
): PermissionEnforcer {
  return new PermissionEnforcer(options);
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultEnforcer: PermissionEnforcer | null = null;

/**
 * Get the default PermissionEnforcer instance (singleton).
 */
export function getDefaultPermissionEnforcer(): PermissionEnforcer {
  if (!defaultEnforcer) {
    defaultEnforcer = new PermissionEnforcer();
  }
  return defaultEnforcer;
}

/**
 * Reset the default enforcer (for testing).
 */
export function resetDefaultPermissionEnforcer(): void {
  defaultEnforcer = null;
}
