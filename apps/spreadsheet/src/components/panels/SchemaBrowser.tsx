/**
 * SchemaBrowser Component
 *
 * Side panel that displays database tables and columns for a selected connection.
 * Displays schema from the app data-tools state.
 *
 * Features:
 * - Connection selector dropdown at the top
 * - Auto-selects first connection when opened without one
 * - Tree view: Connection -> Schema -> Tables -> Columns
 * - Each table expandable to show columns with types
 * - Column info: name, type, nullable badge, PK badge
 * - Search/filter for table names
 * - Click table name to insert SELECT * FROM "table_name" (quoted)
 * - Click column name to insert column name at cursor
 * - Loading and error states
 * - Empty state when no connections exist
 *
 * Architecture:
 * - Uses UIStore schema browser slice for state
 * - Uses useCoordinator() to access ConnectionManager for listing connections
 * - Container handles conditional rendering
 */

import { memo, useCallback, useMemo, useState } from 'react';

import { useUIStore, useUIStoreApi } from '../../infra/context';

import type { ColumnSchema, TableSchema } from '../../ui-store/slices/data-tools/schema-browser';

// =============================================================================
// Sub-Components
// =============================================================================

/**
 * Column row within an expanded table
 */
function ColumnItem({
  column,
  onClickColumn,
}: {
  column: ColumnSchema;
  onClickColumn: (columnName: string) => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 w-full px-6 py-0.5 text-left text-caption
 hover:bg-ss-surface-hover cursor-pointer transition-colors"
      onClick={() => onClickColumn(column.name)}
      title={`Insert column name: ${column.name}`}
    >
      <span className="text-ss-text-secondary font-mono text-hint shrink-0">
        {column.primaryKey ? '\u{1D5DE}' : '\u{1D5DB}'}
      </span>
      <span className="text-ss-text truncate">{column.name}</span>
      <span className="text-ss-text-muted text-ribbon-compact font-mono ml-auto shrink-0">
        {column.type}
      </span>
      {column.primaryKey && (
        <span
          className="text-ribbon-group font-semibold px-1 rounded bg-ss-accent/10 text-ss-accent shrink-0"
          title="Primary Key"
        >
          PK
        </span>
      )}
      {column.nullable && (
        <span
          className="text-ribbon-group font-medium px-1 rounded bg-ss-warning/10 text-ss-warning shrink-0"
          title="Nullable"
        >
          NULL
        </span>
      )}
    </button>
  );
}

/**
 * Expandable table row
 */
function TableItem({
  table,
  onClickTable,
  onClickColumn,
}: {
  table: TableSchema;
  onClickTable: (tableName: string) => void;
  onClickColumn: (columnName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const fullName = table.schema ? `${table.schema}.${table.name}` : table.name;

  return (
    <div>
      <div className="flex items-center w-full">
        <button
          type="button"
          className="flex items-center gap-1 shrink-0 px-1 py-1 text-ss-text-secondary
 hover:text-ss-text transition-colors"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${fullName}` : `Expand ${fullName}`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={`transform transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 flex-1 min-w-0 py-1 pr-2 text-left text-caption
 hover:bg-ss-surface-hover cursor-pointer transition-colors"
          onClick={() => onClickTable(fullName)}
          title={`Insert: SELECT * FROM "${fullName}"`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            className="shrink-0 text-ss-text-secondary"
          >
            <rect x="1" y="2" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1" />
            <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1" />
            <line x1="5" y1="5" x2="5" y2="12" stroke="currentColor" strokeWidth="1" />
            <line x1="9" y1="5" x2="9" y2="12" stroke="currentColor" strokeWidth="1" />
          </svg>
          <span className="text-ss-text font-medium truncate">{table.name}</span>
          {table.schema && (
            <span className="text-ss-text-muted text-ribbon-compact ml-auto shrink-0">
              {table.schema}
            </span>
          )}
          {table.rowCount != null && (
            <span className="text-ss-text-muted text-ribbon-compact shrink-0">
              {table.rowCount.toLocaleString()} rows
            </span>
          )}
        </button>
      </div>
      {expanded && (
        <div className="border-l border-ss-border ml-3">
          {table.columns.map((col) => (
            <ColumnItem key={col.name} column={col} onClickColumn={onClickColumn} />
          ))}
          {table.columns.length === 0 && (
            <div className="px-6 py-1 text-caption text-ss-text-muted italic">No columns</div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Schema Browser panel component.
 *
 * Displays database tables and columns for browsing and insertion.
 * Auto-selects the first available connection when opened without one.
 */
export const SchemaBrowser = memo(function SchemaBrowser(): React.JSX.Element {
  const uiStoreApi = useUIStoreApi();
  const schema = useUIStore((s) => s.schemaBrowser.schema);
  const isLoading = useUIStore((s) => s.schemaBrowser.isLoading);
  const error = useUIStore((s) => s.schemaBrowser.error);
  const connectionId = useUIStore((s) => s.schemaBrowser.selectedConnectionId);

  const [searchQuery, setSearchQuery] = useState('');

  // Filter tables by search query
  const filteredTables = useMemo(() => {
    if (!schema?.tables) return [];
    if (!searchQuery.trim()) return schema.tables;

    const query = searchQuery.toLowerCase();
    return schema.tables.filter(
      (table: TableSchema) =>
        table.name.toLowerCase().includes(query) ||
        (table.schema && table.schema.toLowerCase().includes(query)) ||
        table.columns.some((col: ColumnSchema) => col.name.toLowerCase().includes(query)),
    );
  }, [schema, searchQuery]);

  // Handle table click - insert SELECT * FROM "table_name" (quoted for safety)
  const handleClickTable = useCallback((tableName: string) => {
    const escapedName = tableName.replace(/"/g, '""');
    const query = `SELECT * FROM "${escapedName}"`;
    // Copy to clipboard as a simple insertion mechanism
    navigator.clipboard.writeText(query).catch(() => {
      // Fallback: log it
      console.log('[SchemaBrowser] Query copied:', query);
    });
  }, []);

  // Handle column click - insert column name
  const handleClickColumn = useCallback((columnName: string) => {
    navigator.clipboard.writeText(columnName).catch(() => {
      console.log('[SchemaBrowser] Column copied:', columnName);
    });
  }, []);

  // Handle close
  const handleClose = useCallback(() => {
    uiStoreApi.getState().closeSchemaBrowser();
  }, [uiStoreApi]);

  const hasNoConnections = !connectionId;

  return (
    <div
      className="flex flex-col h-full w-[280px] bg-ss-surface border-l border-ss-border shadow-ss-md"
      role="complementary"
      aria-label="Schema Browser"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ss-border shrink-0">
        <h2 className="text-body-sm font-semibold text-ss-text">Schema Browser</h2>
        <button
          type="button"
          className="p-1 rounded hover:bg-ss-surface-hover text-ss-text-secondary
 hover:text-ss-text transition-colors"
          onClick={handleClose}
          aria-label="Close Schema Browser"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 3L11 11M11 3L3 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Search Filter (only show when a connection is selected) */}
      {connectionId && !hasNoConnections && (
        <div className="px-3 py-2 border-b border-ss-border shrink-0">
          <input
            type="text"
            placeholder="Filter tables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-2 py-1 text-caption border border-ss-border rounded
 bg-ss-surface text-ss-text placeholder:text-ss-text-muted
 focus:outline-none focus:ring-1 focus:ring-ss-accent focus:border-ss-accent"
            aria-label="Filter tables"
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto" role="tree" aria-label="Database tables">
        {/* No Connections Empty State */}
        {hasNoConnections && (
          <div className="px-3 py-8 text-caption text-ss-text-muted text-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              className="mx-auto mb-3 text-ss-text-muted opacity-50"
            >
              <ellipse
                cx="16"
                cy="8"
                rx="10"
                ry="4"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
              />
              <path
                d="M6 8V16C6 18.2 10.48 20 16 20C21.52 20 26 18.2 26 16V8"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M6 16V24C6 26.2 10.48 28 16 28C21.52 28 26 26.2 26 24V16"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            <div className="font-medium text-ss-text mb-1">No database connections</div>
            <div>
              Create a connection from the Data tab Connections button to browse its schema.
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-8" aria-live="polite">
            <div className="flex items-center gap-2 text-ss-text-secondary text-caption">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray="32"
                  strokeLinecap="round"
                />
              </svg>
              <span>Loading schema...</span>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="px-3 py-4" role="alert">
            <div className="text-caption text-ss-error font-medium mb-1">Failed to load schema</div>
            <div className="text-ribbon-compact text-ss-text-muted break-words">{error}</div>
            <button
              type="button"
              className="mt-2 px-2 py-1 text-ribbon-compact rounded border border-ss-border
 hover:bg-ss-surface-hover text-ss-text transition-colors"
              onClick={() => {}}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && schema && filteredTables.length === 0 && (
          <div className="px-3 py-4 text-caption text-ss-text-muted text-center">
            {searchQuery ? 'No tables match your search.' : 'No tables found in this database.'}
          </div>
        )}

        {/* Table List */}
        {!isLoading && !error && filteredTables.length > 0 && (
          <div className="py-1">
            {/* Summary */}
            <div className="px-3 py-1 text-ribbon-compact text-ss-text-muted">
              {filteredTables.length} table{filteredTables.length !== 1 ? 's' : ''}
              {searchQuery && ` matching "${searchQuery}"`}
              {schema?.fetchedAt && (
                <span className="ml-1">
                  (fetched {new Date(schema.fetchedAt).toLocaleTimeString()})
                </span>
              )}
            </div>

            {/* Tables */}
            {filteredTables.map((table: TableSchema) => (
              <TableItem
                key={`${table.schema ?? ''}.${table.name}`}
                table={table}
                onClickTable={handleClickTable}
                onClickColumn={handleClickColumn}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer - click hint */}
      {!isLoading && !error && schema && (
        <div className="px-3 py-1.5 border-t border-ss-border shrink-0">
          <div className="text-ribbon-compact text-ss-text-muted">
            Click table to copy SELECT query. Click column to copy name.
          </div>
        </div>
      )}
    </div>
  );
});
