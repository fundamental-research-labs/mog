/**
 * App Table Setup - Ensures app-required tables exist
 *
 * Before rendering an app, ensures all tables declared in manifest.managedTables
 * exist in the workbook. Creates missing tables, adds missing columns, logs
 * conflicts for type mismatches.
 *
 * Also provides helper functions for the app binding system:
 * - createManagedTables: Creates tables on a new dedicated sheet for "Fresh start" flow
 * - resolveBindings: Converts persisted AppInstance bindings to runtime ResolvedBindings
 *
 */

import type {
  AppColumnId,
  AppInstance,
  AppManifest,
  AppTableId,
  AppTableSchema,
  ColumnMapping,
  IAppKernelAPI,
  ResolvedBindings,
  ResolvedTableBinding,
  TableBinding,
} from '@mog-sdk/contracts/apps';
import type { IGatedAppKernelAPI } from '@mog-sdk/contracts/capabilities';

/**
 * Ensures all tables required by an app exist before rendering.
 *
 * For each table in manifest.managedTables:
 * - If table doesn't exist, creates it with full schema
 * - If table exists, reconciles schema (adds missing columns, warns on conflicts)
 *
 * @deprecated This function is deprecated and will be removed in a future release.
 * Table setup is now handled by AppLoader's setup flow via {@link createManagedTables}.
 * The new app binding system allows users to choose between "Start fresh" (creates
 * tables on a dedicated sheet with proper positioning) or "Use existing data"
 * (binds to existing tables with column mapping).
 *
 * This function had a bug where it created all tables at the same position (A1),
 * causing overlaps. The new system avoids this by placing tables sequentially.
 *
 *
 * @param kernel - App Kernel API
 * @param manifest - App manifest with managedTables
 * @returns Map of table name to table ID
 */
export async function ensureAppTables(
  kernel: IAppKernelAPI,
  manifest: AppManifest,
): Promise<Map<string, string>> {
  const tableIds = new Map<string, string>();

  if (!manifest.managedTables || manifest.managedTables.length === 0) {
    return tableIds;
  }

  for (const tableSchema of manifest.managedTables) {
    const tableId = await ensureTable(kernel, manifest.id, tableSchema);
    tableIds.set(tableSchema.name, tableId);
  }

  return tableIds;
}

/**
 * Ensures a single table exists, creating or reconciling as needed.
 */
async function ensureTable(
  kernel: IAppKernelAPI,
  appId: string,
  schema: AppTableSchema,
): Promise<AppTableId> {
  const existing = await kernel.tables.findByName(schema.name);

  if (!existing) {
    // Table doesn't exist - create it
    const table = await kernel.tables.create(schema);
    return table.id;
  }

  // Table exists - reconcile schema
  await reconcileSchema(kernel, appId, existing.id, schema);
  return existing.id;
}

/**
 * Reconciles an existing table's schema with expected schema.
 *
 * Actions:
 * - Adds missing columns
 * - Warns on type mismatches (doesn't modify existing columns)
 * - Logs all changes for debugging
 */
async function reconcileSchema(
  kernel: IAppKernelAPI,
  appId: string,
  tableId: AppTableId,
  expected: AppTableSchema,
): Promise<void> {
  const existingColumns = await kernel.columns.list(tableId);

  for (const expectedCol of expected.columns) {
    const existing = existingColumns.find((c) => c.name === expectedCol.name);

    if (!existing) {
      // Column missing - add it
      await kernel.columns.create(tableId, expectedCol);
      continue;
    }

    // Column exists - check for type mismatch
    if (existing.type.kind !== expectedCol.type.kind) {
      console.warn(
        `[${appId}] Column "${expectedCol.name}" in table "${expected.name}" has type mismatch:\n` +
          `  Expected: ${expectedCol.type.kind}\n` +
          `  Found: ${existing.type.kind}\n` +
          `  Some features may not work correctly.`,
      );
    }
  }
}

// =============================================================================
// App Binding System Functions
// =============================================================================

/**
 * Gap between tables when placing them sequentially on a sheet.
 * 2 rows: 1 empty row + 1 row for potential visual separation.
 */
const TABLE_GAP_ROWS = 2;

/**
 * Default number of data rows to reserve for each table.
 * Tables will have 1 header row + this many data rows initially.
 */
const DEFAULT_DATA_ROWS = 10;

/**
 * Creates managed tables for the "Fresh start" flow.
 *
 * Creates a new sheet named "{appName} Data" and places all managed tables
 * sequentially (vertically stacked) to avoid overlaps.
 *
 * @param kernel - App Kernel API (or gated API with sheets capability)
 * @param appId - App identifier for logging
 * @param appName - App display name (used for sheet naming)
 * @param managedTables - Array of table schemas from manifest
 * @returns Record of table name to TableBinding (with isManaged=true)
 */
export async function createManagedTables(
  kernel: IAppKernelAPI | IGatedAppKernelAPI,
  appId: string,
  appName: string,
  managedTables: AppTableSchema[],
): Promise<Record<string, TableBinding>> {
  const bindings: Record<string, TableBinding> = {};

  if (!managedTables.length) {
    return bindings;
  }

  // Create a new sheet for the app's data
  const sheetName = `${appName} Data`;
  let sheetId: string | undefined;

  // Try to create sheet via gated API first, then fall back to direct
  const gatedKernel = kernel as IGatedAppKernelAPI;
  if (gatedKernel.sheets?.create) {
    const sheet = gatedKernel.sheets.create(sheetName);
    sheetId = sheet.id;
  }

  // Verify required APIs are available
  // Cast to IAppKernelAPI to access tables/columns - these are required for table creation
  const tablesAPI = kernel.tables;
  const columnsAPI = kernel.columns;

  if (!tablesAPI?.create || !columnsAPI?.list) {
    console.error(`[${appId}] tables.create or columns.list API not available`);
    return bindings;
  }

  // Track current row position for table placement
  let currentRow = 1; // Start at row 1 (A1 notation uses 1-based)

  for (const tableSchema of managedTables) {
    // Calculate starting cell (A-based column, 1-based row)
    const startCell = `A${currentRow}`;

    // Create the table
    const table = await tablesAPI.create(tableSchema, {
      sheetId,
      startCell,
    });

    // Build column mappings (for managed tables, columns match exactly)
    const columnMappings: Record<string, ColumnMapping> = {};
    const tableColumns = await columnsAPI.list(table.id);

    for (const col of tableColumns) {
      columnMappings[col.name] = {
        columnId: col.id,
        columnName: col.name,
      };
    }

    bindings[tableSchema.name] = {
      tableId: table.id,
      columnMappings,
      isManaged: true,
    };

    // Move to next position: header row (1) + data rows + gap
    // Estimate table height based on schema
    const tableHeight = 1 + DEFAULT_DATA_ROWS; // 1 header + data rows
    currentRow += tableHeight + TABLE_GAP_ROWS;
  }

  return bindings;
}

/**
 * Resolves persisted AppInstance bindings to runtime ResolvedBindings.
 *
 * Looks up each bound table to verify it still exists and has the expected columns.
 * Returns null if any table is missing (indicating need to rebind).
 *
 * @param kernel - App Kernel API
 * @param instance - Persisted app instance with bindings
 * @returns ResolvedBindings if all tables exist, or null if rebinding is needed
 */
export async function resolveBindings(
  kernel: IAppKernelAPI,
  instance: AppInstance,
): Promise<ResolvedBindings | null> {
  const resolved: ResolvedBindings = {
    tables: {},
  };

  for (const [logicalName, binding] of Object.entries(instance.bindings)) {
    // Skip unbound tables (null tableId)
    if (!binding.tableId) {
      console.warn(`[${instance.appId}] Table "${logicalName}" has no binding, needs rebind`);
      return null;
    }

    // Look up the table
    const table = await kernel.tables.get(binding.tableId);
    if (!table) {
      console.warn(
        `[${instance.appId}] Bound table "${logicalName}" (id: ${binding.tableId}) not found, needs rebind`,
      );
      return null;
    }

    // Build resolved column map
    const columns: Record<string, AppColumnId> = {};
    for (const [colLogicalName, colMapping] of Object.entries(binding.columnMappings)) {
      // Verify column still exists
      const col = await kernel.columns.get(binding.tableId, colMapping.columnId);
      if (!col) {
        console.warn(
          `[${instance.appId}] Column "${colLogicalName}" (id: ${colMapping.columnId}) ` +
            `in table "${logicalName}" not found, needs rebind`,
        );
        return null;
      }
      columns[colLogicalName] = colMapping.columnId;
    }

    const resolvedTable: ResolvedTableBinding = {
      tableId: binding.tableId,
      table,
      columns,
      isManaged: binding.isManaged,
    };

    resolved.tables[logicalName] = resolvedTable;
  }

  return resolved;
}
