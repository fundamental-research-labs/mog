/**
 * Name Manager Dialog
 *
 *
 * Dialog for managing all named ranges. Follows Excel's Name Manager (Ctrl+F3):
 * - List view of all names with columns: Name, Value, Refers To, Scope, Comment
 * - Filter dropdown: All Names, Workbook Scope, Sheet Scope, Names with Errors, Table Names
 * - Search text filter
 * - New/Edit/Delete buttons
 * - Inline editing of Refers To for selected name
 *
 * Architecture:
 * - Dialog state in Zustand (named-ranges-dialog.ts)
 * - CRUD through domain module (NamedRanges.*)
 * - Opens DefineNameDialog for New/Edit operations
 * - Read-only display for table names (Tables are not editable as names)
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CollapsibleRangeInput,
  MinimizableDialog,
  useActiveSheetId,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogToolbar,
  FormField,
  Input,
  Select,
} from '@mog/shell';
import type { NameManagerFilter } from '../../ui-store/slices/dialogs/named-ranges-dialog';
// =============================================================================
// Types
// =============================================================================

interface NameRowData {
  id: string;
  name: string;
  value: string;
  refersTo: string;
  scope: string;
  scopeKey: string | undefined;
  comment: string;
  isTable: boolean;
  hasError: boolean;
}

// =============================================================================
// Filter Options
// =============================================================================

const FILTER_OPTIONS: Array<{ value: NameManagerFilter; label: string }> = [
  { value: 'all', label: 'All Names' },
  { value: 'workbook', label: 'Names Scoped to Workbook' },
  { value: 'sheet', label: 'Names Scoped to Worksheet' },
  { value: 'withErrors', label: 'Names with Errors' },
  { value: 'tables', label: 'Table Names' },
];

// =============================================================================
// Component
// =============================================================================

export function NameManagerDialog() {
  const wb = useWorkbook();
  useActiveSheetId();

  // UI Store state
  const dialogState = useUIStore((s) => s.nameManagerDialog);
  const closeDialog = useUIStore((s) => s.closeNameManagerDialog);
  const setFilter = useUIStore((s) => s.setNameManagerFilter);
  const setSearchText = useUIStore((s) => s.setNameManagerSearchText);
  const setSelectedName = useUIStore((s) => s.setNameManagerSelectedName);
  const openDefineNameDialog = useUIStore((s) => s.openDefineNameDialog);

  // Local state for inline refersTo editing
  const [editingRefersTo, setEditingRefersTo] = useState<string | null>(null);
  const [editedRefersTo, setEditedRefersTo] = useState('');

  const [namedRangesData, setNamedRangesData] = useState<any[]>([]);
  const [tablesData, setTablesData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingMutation, setPendingMutation] = useState(false);
  const pendingMutationRef = useRef(false);
  const refreshRequestId = useRef(0);

  const setMutationPending = useCallback((pending: boolean) => {
    pendingMutationRef.current = pending;
    setPendingMutation(pending);
  }, []);

  const refreshNames = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    setLoading(true);
    try {
      const [names, tables] = await Promise.all([
        wb.names.list(),
        (async () => {
          const allTables: any[] = [];
          for (const sheetName of wb.sheetNames) {
            const ws = await wb.getSheet(sheetName);
            const tableList = await ws.tables.list();
            for (const table of tableList) {
              allTables.push({ ...table, _sheetName: sheetName });
            }
          }
          return allTables;
        })(),
      ]);
      if (requestId !== refreshRequestId.current) return;
      setNamedRangesData(names);
      setTablesData(tables);
    } catch (err) {
      if (requestId === refreshRequestId.current) {
        console.error('Failed to load name manager data:', err);
      }
    } finally {
      if (requestId === refreshRequestId.current) {
        setLoading(false);
      }
    }
  }, [wb]);

  useEffect(() => {
    if (dialogState.isOpen) {
      void refreshNames();
    }
  }, [dialogState.isOpen, dialogState.refreshToken, refreshNames]);

  useEffect(() => {
    const handleNameChange = () => {
      if (dialogState.isOpen) {
        void refreshNames();
      }
    };

    const unsub1 = wb.on('namedRangeChanged', handleNameChange);
    const unsub2 = wb.on('recalc:completed', handleNameChange);

    return () => {
      unsub1();
      unsub2();
    };
  }, [wb, dialogState.isOpen, refreshNames]);

  // Get all names and convert to display format
  const allNames = useMemo((): NameRowData[] => {
    const result: NameRowData[] = [];

    for (const name of namedRangesData) {
      // NamedRangeInfo has: name, reference (A1-style), scope, comment
      const refersToA1 = name.reference ?? '';
      const scopeName = name.scope ?? 'Workbook';
      const scopeKey = name.scope;
      const hasError = refersToA1.includes('#REF!') || refersToA1.includes('#NAME?');

      // Display the refersTo reference as the value (matches Excel for non-evaluated names).
      const displayValue = hasError ? '#REF!' : refersToA1;

      result.push({
        id: `name:${scopeKey ?? 'workbook'}:${name.name}`,
        name: name.name,
        value: displayValue,
        refersTo: refersToA1,
        scope: scopeName,
        scopeKey,
        comment: name.comment ?? '',
        isTable: false,
        hasError,
      });
    }

    // Add table names (read-only) from async-loaded table data
    for (const table of tablesData) {
      const sheetName = table._sheetName ?? 'Unknown';
      const rangeRef = `${sheetName}!${table.range ?? ''}`;
      result.push({
        id: `table:${sheetName}:${table.name}`,
        name: table.name,
        value: rangeRef,
        refersTo: `=${rangeRef}`,
        scope: sheetName,
        scopeKey: sheetName,
        comment: '',
        isTable: true,
        hasError: false,
      });
    }

    return result;
  }, [namedRangesData, tablesData]);

  // Apply filters
  const filteredNames = useMemo(() => {
    let names = allNames;

    // Apply filter
    switch (dialogState.filter) {
      case 'workbook':
        names = names.filter((n) => n.scope === 'Workbook' && !n.isTable);
        break;
      case 'sheet':
        names = names.filter((n) => n.scope !== 'Workbook' && !n.isTable);
        break;
      case 'withErrors':
        names = names.filter((n) => n.hasError);
        break;
      case 'tables':
        names = names.filter((n) => n.isTable);
        break;
      // 'all' - no filtering
    }

    // Apply search text
    if (dialogState.searchText) {
      const searchLower = dialogState.searchText.toLowerCase();
      names = names.filter(
        (n) =>
          n.name.toLowerCase().includes(searchLower) ||
          n.refersTo.toLowerCase().includes(searchLower) ||
          n.comment.toLowerCase().includes(searchLower),
      );
    }

    return names;
  }, [allNames, dialogState.filter, dialogState.searchText]);

  // Get selected name data
  const selectedNameData = useMemo(() => {
    if (!dialogState.selectedNameId) return null;
    return filteredNames.find((n) => n.id === dialogState.selectedNameId) ?? null;
  }, [filteredNames, dialogState.selectedNameId]);

  useEffect(() => {
    if (
      dialogState.selectedNameId &&
      !loading &&
      !allNames.some((name) => name.id === dialogState.selectedNameId)
    ) {
      setSelectedName(null);
    }
  }, [allNames, dialogState.selectedNameId, loading, setSelectedName]);

  // Handle New button
  const handleNew = useCallback(() => {
    openDefineNameDialog({ mode: 'create', parentDialogId: 'name-manager-dialog' });
  }, [openDefineNameDialog]);

  // Handle Edit button
  const handleEdit = useCallback(() => {
    if (!selectedNameData || selectedNameData.isTable) return;
    openDefineNameDialog({
      mode: 'edit',
      editingNameId: selectedNameData.name,
      editingNameScope: selectedNameData.scopeKey ?? null,
      parentDialogId: 'name-manager-dialog',
    });
  }, [selectedNameData, openDefineNameDialog]);

  const controlsDisabled = loading || pendingMutation;

  // Handle Delete button
  const handleDelete = useCallback(async () => {
    if (!selectedNameData || selectedNameData.isTable || pendingMutationRef.current) return;

    // Confirm deletion
    const confirmDelete = window.confirm(
      `Are you sure you want to delete the name "${selectedNameData.name}"?`,
    );
    if (!confirmDelete) return;

    setMutationPending(true);
    try {
      await wb.names.remove(selectedNameData.name, selectedNameData.scopeKey);
      setSelectedName(null);
      await refreshNames();
    } catch (error) {
      // Show error - in production would use a toast/alert
      console.error('Failed to delete name:', error);
    } finally {
      setMutationPending(false);
    }
  }, [refreshNames, selectedNameData, wb, setSelectedName, setMutationPending]);

  // Handle row selection
  const handleRowClick = useCallback(
    (name: NameRowData) => {
      setSelectedName(name.id);
      // Reset inline editing when selection changes
      setEditingRefersTo(null);
    },
    [setSelectedName],
  );

  // Handle inline refersTo editing
  const handleRefersToDoubleClick = useCallback((name: NameRowData) => {
    if (name.isTable || pendingMutationRef.current) return; // Tables can't be edited
    setEditingRefersTo(name.id);
    setEditedRefersTo(name.refersTo);
  }, []);

  // Save inline refersTo edit via Workbook API
  const saveEditedRefersTo = useCallback(async (): Promise<boolean> => {
    if (!editingRefersTo) return true;
    if (pendingMutationRef.current) return false;

    const name = filteredNames.find((n) => n.id === editingRefersTo);
    if (!name || name.isTable) {
      setEditingRefersTo(null);
      return true;
    }

    if (editedRefersTo === name.refersTo) {
      setEditingRefersTo(null);
      return true;
    }

    setMutationPending(true);
    try {
      await wb.names.update(name.name, { reference: editedRefersTo }, name.scopeKey);
      await refreshNames();
      setEditingRefersTo(null);
      return true;
    } catch (error) {
      console.error('Failed to update refersTo:', error);
      return false;
    } finally {
      setMutationPending(false);
    }
  }, [editingRefersTo, filteredNames, wb, editedRefersTo, refreshNames, setMutationPending]);

  const handleRefersToSave = useCallback(() => {
    void saveEditedRefersTo();
  }, [saveEditedRefersTo]);

  const handleSelectedRefersToChange = useCallback(
    (nextValue: string) => {
      if (!selectedNameData || selectedNameData.isTable || pendingMutationRef.current) return;
      setEditingRefersTo(selectedNameData.id);
      setEditedRefersTo(nextValue);
    },
    [selectedNameData],
  );

  const handleClose = useCallback(async () => {
    if (pendingMutationRef.current) return;

    const saved = await saveEditedRefersTo();
    if (saved) {
      closeDialog();
    }
  }, [closeDialog, saveEditedRefersTo]);

  // Cancel inline edit
  const handleRefersToCancel = useCallback(() => {
    setEditingRefersTo(null);
  }, []);

  // Handle keyboard in inline edit
  const handleRefersToKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRefersToSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleRefersToCancel();
      }
    },
    [handleRefersToSave, handleRefersToCancel],
  );

  return (
    <MinimizableDialog
      open={dialogState.isOpen}
      onClose={() => void handleClose()}
      dialogId="name-manager-dialog"
      title="Name Manager"
      width="xl"
    >
      {/* Stable test-id marker for app-eval scenarios polling "is the dialog mounted". */}
      <div data-testid="name-manager-dialog" hidden />
      <DialogHeader onClose={() => void handleClose()}>Name Manager</DialogHeader>

      <DialogToolbar>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleNew}
            size="sm"
            disabled={controlsDisabled}
            data-testid="name-manager-new"
          >
            New...
          </Button>
          <Button
            variant="secondary"
            onClick={handleEdit}
            size="sm"
            disabled={controlsDisabled || !selectedNameData || selectedNameData.isTable}
            data-testid="name-manager-edit"
          >
            Edit...
          </Button>
          <Button
            variant="secondary"
            onClick={handleDelete}
            size="sm"
            disabled={controlsDisabled || !selectedNameData || selectedNameData.isTable}
            data-testid="name-manager-delete"
          >
            Delete
          </Button>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <Select
            options={FILTER_OPTIONS}
            value={dialogState.filter}
            onChange={(value) => setFilter(value as NameManagerFilter)}
            className="w-48"
          />
        </div>
      </DialogToolbar>

      <DialogBody className="p-0">
        {/* Search bar */}
        <div className="px-4 py-2 border-b border-ss-border">
          <Input
            value={dialogState.searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search names..."
            className="w-full"
          />
        </div>

        {/* Names table */}
        <div className="overflow-auto max-h-[400px]">
          <table className="w-full text-ribbon">
            <thead className="bg-ss-surface-secondary sticky top-0">
              <tr className="border-b border-ss-border">
                <th className="px-3 py-2 text-left font-medium text-ss-text-secondary">Name</th>
                <th className="px-3 py-2 text-left font-medium text-ss-text-secondary">Value</th>
                <th className="px-3 py-2 text-left font-medium text-ss-text-secondary">
                  Refers To
                </th>
                <th className="px-3 py-2 text-left font-medium text-ss-text-secondary">Scope</th>
                <th className="px-3 py-2 text-left font-medium text-ss-text-secondary">Comment</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-ss-text-tertiary">
                    Loading names...
                  </td>
                </tr>
              ) : filteredNames.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-ss-text-tertiary">
                    {dialogState.searchText
                      ? 'No names match your search'
                      : 'No defined names found'}
                  </td>
                </tr>
              ) : (
                filteredNames.map((name) => (
                  <tr
                    key={name.id}
                    onClick={() => handleRowClick(name)}
                    onDoubleClick={() => handleRefersToDoubleClick(name)}
                    className={`
 border-b border-ss-border cursor-pointer hover:bg-ss-surface-hover
 ${dialogState.selectedNameId === name.id ? 'bg-ss-row-selected' : ''}
 ${name.hasError ? 'text-ss-error bg-ss-error-bg' : ''}
 ${name.isTable ? 'text-ss-text-secondary italic' : ''}
 `}
                  >
                    <td className="px-3 py-1.5 font-medium">{name.name}</td>
                    <td className="px-3 py-1.5 font-ss-mono text-caption truncate max-w-[120px]">
                      {name.value}
                    </td>
                    <td className="px-3 py-1.5 font-ss-mono text-caption">
                      {editingRefersTo === name.id ? (
                        <Input
                          value={editedRefersTo}
                          onChange={(e) => setEditedRefersTo(e.target.value)}
                          onBlur={handleRefersToSave}
                          onKeyDown={handleRefersToKeyDown}
                          className="h-6 py-0 text-caption font-ss-mono"
                          disabled={pendingMutation}
                          autoFocus
                        />
                      ) : (
                        <span className="truncate block max-w-[200px]" title={name.refersTo}>
                          {name.refersTo}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{name.scope}</td>
                    <td className="px-3 py-1.5 text-ss-text-tertiary truncate max-w-[150px]">
                      {name.comment || (name.isTable ? '(Table)' : '')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Selected name details */}
        {selectedNameData && (
          <div className="px-4 py-3 border-t border-ss-border bg-ss-surface-secondary">
            <FormField label="Refers to:">
              <CollapsibleRangeInput
                value={
                  editingRefersTo === selectedNameData.id
                    ? editedRefersTo
                    : selectedNameData.refersTo
                }
                onChange={handleSelectedRefersToChange}
                onFocus={() => {
                  if (!selectedNameData.isTable) {
                    setEditingRefersTo(selectedNameData.id);
                    setEditedRefersTo(selectedNameData.refersTo);
                  }
                }}
                onBlur={handleRefersToSave}
                onKeyDown={handleRefersToKeyDown}
                disabled={selectedNameData.isTable || pendingMutation}
                dialogId="name-manager-dialog"
                inputId="refers-to-inline"
                className="font-ss-mono"
              />
            </FormField>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="primary" onClick={() => void handleClose()}>
          Close
        </Button>
      </DialogFooter>
    </MinimizableDialog>
  );
}
