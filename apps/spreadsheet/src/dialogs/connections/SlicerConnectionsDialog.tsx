/**
 * Slicer Connections Dialog (Report Connections)
 *
 * Dialog for configuring which tables/PivotTables a slicer is connected to.
 * In Excel, this is called "Report Connections" and allows a single slicer
 * to filter multiple data sources simultaneously.
 *
 *
 * Architecture Compliance:
 * - All user interactions use dispatch()
 * - UIStore slice for dialog state
 */

import { useCallback, useEffect, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore, useWorkbook } from '../../internal-api';

import { Button, Checkbox, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import type { TableInfo } from '@mog-sdk/contracts/api';
// =============================================================================
// Types
// =============================================================================

interface ConnectionItem {
  /** Table ID */
  id: string;
  /** Display name */
  name: string;
  /** Type of connection (table or pivot) */
  type: 'table' | 'pivot';
  /** Whether this table is currently connected */
  connected: boolean;
  /** Whether the slicer column exists in this table */
  hasColumn: boolean;
}

// =============================================================================
// Component
// =============================================================================

/**
 * SlicerConnectionsDialog - Dialog for managing slicer connections to tables.
 *
 * Shows a list of available tables and allows the user to select which ones
 * the slicer should filter. Tables must have a column matching the slicer's
 * source column to be connectable.
 */
export function SlicerConnectionsDialog() {
  const deps = useActionDependencies();
  const wb = useWorkbook();

  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.slicerConnectionsDialog?.isOpen ?? false);
  const slicerId = useUIStore((s) => s.slicerConnectionsDialog?.slicerId ?? null);
  const currentConnections = useUIStore((s) => s.slicerConnectionsDialog?.currentConnections ?? []);
  const sourceColumnName = useUIStore((s) => s.slicerConnectionsDialog?.sourceColumnName ?? '');

  // Local state for connection selections
  const [selectedConnections, setSelectedConnections] = useState<Set<string>>(new Set());

  // Fetch all tables via Workbook/Worksheet API (async).
  const [availableTables, setAvailableTables] = useState<ConnectionItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    void (async () => {
      try {
        const sheetNames = wb.sheetNames;
        const allTables: TableInfo[] = [];
        for (const sheetName of sheetNames) {
          const ws = await wb.getSheet(sheetName);
          const sheetTables = await ws.tables.list();
          allTables.push(...sheetTables);
        }

        if (cancelled) return;

        const items: ConnectionItem[] = allTables.map((table) => {
          const hasColumn = table.columns.some(
            (col) => col.name.toLowerCase() === sourceColumnName.toLowerCase(),
          );
          const tableId = table.id ?? table.name;
          return {
            id: tableId,
            name: table.name,
            type: 'table' as const,
            connected: currentConnections.includes(tableId),
            hasColumn,
          };
        });

        setAvailableTables(items);
      } catch {
        if (!cancelled) {
          setAvailableTables([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wb, isOpen, currentConnections, sourceColumnName]);

  // Initialize selections when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedConnections(new Set(currentConnections));
    }
  }, [isOpen, currentConnections]);

  // Handle checkbox change
  const handleConnectionToggle = useCallback((tableId: string) => {
    setSelectedConnections((prev) => {
      const next = new Set(prev);
      if (next.has(tableId)) {
        next.delete(tableId);
      } else {
        next.add(tableId);
      }
      return next;
    });
  }, []);

  // Handle OK button - apply connection changes
  const handleConfirm = useCallback(() => {
    if (!slicerId) return;

    dispatch('UPDATE_SLICER_CONNECTIONS', deps, {
      slicerId,
      connections: Array.from(selectedConnections),
    });
  }, [deps, slicerId, selectedConnections]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_SLICER_CONNECTIONS_DIALOG', deps);
  }, [deps]);

  // Count of selected connections
  const selectedCount = selectedConnections.size;

  // Tables that can be connected (have the matching column)
  const connectableTables = availableTables.filter((t) => t.hasColumn);
  const nonConnectableTables = availableTables.filter((t) => !t.hasColumn);

  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={handleCancel}
      dialogId="slicer-connections-dialog"
      width="md"
    >
      <DialogHeader onClose={handleCancel}>Report Connections</DialogHeader>
      <DialogBody>
        <p className="text-body text-text m-0 mb-3">Select tables to filter with this slicer:</p>

        {sourceColumnName && (
          <p className="text-body-sm text-ss-text-secondary mb-4">
            Filtering by column: <strong>{sourceColumnName}</strong>
          </p>
        )}

        {/* Connectable tables */}
        {connectableTables.length > 0 ? (
          <div className="space-y-2 mb-4">
            <p className="text-body-sm font-medium text-text">Available Tables</p>
            <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-1">
              {connectableTables.map((table) => (
                <div
                  key={table.id}
                  className="flex items-center gap-2 py-1 px-2 hover:bg-ss-surface-secondary rounded"
                >
                  <Checkbox
                    id={`connection-${table.id}`}
                    checked={selectedConnections.has(table.id)}
                    onChange={() => handleConnectionToggle(table.id)}
                  />
                  <label
                    htmlFor={`connection-${table.id}`}
                    className="flex-1 text-body cursor-pointer"
                  >
                    {table.name}
                  </label>
                  <span className="text-caption text-ss-text-secondary">
                    {table.type === 'pivot' ? 'PivotTable' : 'Table'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-ss-surface-secondary rounded mb-4 text-center">
            <p className="text-body-sm text-ss-text-secondary">
              No tables found with column &quot;{sourceColumnName}&quot;
            </p>
          </div>
        )}

        {/* Non-connectable tables (for reference) */}
        {nonConnectableTables.length > 0 && (
          <div className="space-y-2">
            <p className="text-body-sm font-medium text-ss-text-secondary">
              Tables without matching column (cannot connect)
            </p>
            <div className="max-h-24 overflow-y-auto border rounded p-2 space-y-1 opacity-60">
              {nonConnectableTables.map((table) => (
                <div
                  key={table.id}
                  className="flex items-center gap-2 py-1 px-2 text-ss-text-disabled"
                >
                  <Checkbox
                    id={`connection-disabled-${table.id}`}
                    checked={false}
                    onChange={() => {}}
                    disabled
                  />
                  <label
                    htmlFor={`connection-disabled-${table.id}`}
                    className="flex-1 text-body-sm cursor-not-allowed"
                  >
                    {table.name}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selection summary */}
        <div className="mt-4 text-body-sm text-ss-text-secondary">
          {selectedCount === 0 ? (
            <p className="m-0">No tables selected. Slicer will not filter any data.</p>
          ) : selectedCount === 1 ? (
            <p className="m-0">1 table selected for filtering.</p>
          ) : (
            <p className="m-0">{selectedCount} tables selected for filtering.</p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleConfirm}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
