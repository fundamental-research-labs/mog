/**
 * NameBoxDropdown Component
 *
 * Interactive name box that shows the current cell address and allows:
 * - Click to select/jump to a named range
 * - Type to navigate to a cell reference (e.g., "A1", "Sheet2!B5")
 * - Dropdown shows defined names, tables, and sheet names
 *
 *
 *
 * Architecture:
 * - Reuses name-completion.ts for listing names/tables/sheets
 * - Uses selection.setSelection for navigation (via coordinator)
 * - Respects Cell Identity model for future `onDefineName` support
 * - Uses useDebouncedSelection hook to avoid re-renders during drag
 *
 * @see engine/src/state/hooks/use-debounced-selection.ts
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useActionDependencies,
  useActiveSheetId,
  useCoordinator,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import { parseCellAddress, parseCellRange } from '@mog-sdk/kernel';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { ParsedCellRange } from '@mog-sdk/contracts/utils';
import {
  createVirtualRef,
  MenuItem,
  MenuSeparator,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@mog/shell';
import { toA1 } from '@mog/spreadsheet-utils/a1';
import { validateName } from '@mog/spreadsheet-utils/data/named-ranges';
import { dispatch } from '../../actions';
import { createSelectionCommands } from '../../coordinator/actor-access';
import {
  getNameSuggestionIcon,
  getNameSuggestions,
  type NameCompletionStoreLike,
  type NameSuggestion,
} from '../../domain/editor/name-completion';
import { useDebouncedSelection } from '../../hooks';
import { formatNameBoxSelection } from './name-box-display';

// =============================================================================
// Types
// =============================================================================

export interface NameBoxDropdownProps {
  className?: string;
}

const INVALID_NAME_MESSAGE = 'The name you entered is not valid.';

// =============================================================================
// Store Adapter
// =============================================================================

function rangeFromParsedCellRange(parsedRange: ParsedCellRange): CellRange {
  return {
    startRow: parsedRange.startRow,
    startCol: parsedRange.startCol,
    endRow: parsedRange.endRow,
    endCol: parsedRange.endCol,
    ...(parsedRange.isFullColumn ? { isFullColumn: true } : {}),
    ...(parsedRange.isFullRow ? { isFullRow: true } : {}),
  };
}

/**
 * Create a NameCompletionStoreLike adapter from cached async data.
 */
function createStoreAdapter(
  cachedNamedRanges: any[],
  cachedTables: Array<{
    name: string;
    sheetName: string;
    range: string;
    columns: Array<{ name: string }>;
  }>,
  cachedSheets: Array<{ id: string; name: string }>,
): NameCompletionStoreLike {
  return {
    getDefinedNames(): Record<string, { refersTo: string; scope?: string; comment?: string }> {
      const result: Record<string, { refersTo: string; scope?: string; comment?: string }> = {};

      for (const name of cachedNamedRanges) {
        if (name.refersTo) {
          result[name.name] = {
            refersTo: name.refersTo,
            scope: name.scope,
            comment: name.comment,
          };
        }
      }

      return result;
    },

    getTables() {
      return cachedTables;
    },

    getTable(name: string) {
      return cachedTables.find((t) => t.name === name);
    },

    getSheets() {
      return cachedSheets;
    },
  };
}

// =============================================================================
// Component
// =============================================================================

export const NameBoxDropdown = memo(function NameBoxDropdown({
  className = '',
}: NameBoxDropdownProps) {
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  // Get setSelection command via coordinator
  const coordinator = useCoordinator();

  // =============================================================================
  // DEBOUNCED SELECTION STATE
  // Performance fix: Uses the useDebouncedSelection hook which only updates when
  // selection settles (transitions to 'idle' state), preventing re-renders during drag.
  // @see engine/src/state/hooks/use-debounced-selection.ts
  // =============================================================================
  const { ranges, activeCell } = useDebouncedSelection(0);

  const selectionCommands = useMemo(
    () => createSelectionCommands(coordinator.grid.access.actors.selection),
    [coordinator],
  );
  const setActiveSheetId = useUIStore((s) => s.setActiveSheet);
  // Define New Name from Name Box
  const openDefineNameDialog = useUIStore((s) => s.openDefineNameDialog);
  const deps = useActionDependencies();

  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [filterText, setFilterText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load named ranges, tables, sheets from Workbook/Worksheet API (async) for dropdown
  const [cachedNamedRanges, setCachedNamedRanges] = useState<any[]>([]);
  const [cachedTables, setCachedTables] = useState<
    Array<{ name: string; sheetName: string; range: string; columns: Array<{ name: string }> }>
  >([]);
  const [cachedSheets, setCachedSheets] = useState<Array<{ id: string; name: string }>>([]);
  const referenceDataLoadedRef = useRef(false);
  const referenceDataLoadRef = useRef<Promise<void> | null>(null);
  const referenceDataGenerationRef = useRef(0);
  const isMountedRef = useRef(true);

  /**
   * Refresh just the cached named ranges. Used after a name is created/updated/deleted
   * (either via the Name Box itself or by an external API caller / event).
   */
  const refreshNamedRanges = useCallback(
    async (force = false): Promise<void> => {
      if (!force && !referenceDataLoadedRef.current && !referenceDataLoadRef.current) {
        return;
      }
      try {
        const generation = referenceDataGenerationRef.current;
        const namedRanges = await wb.names.list();
        if (!isMountedRef.current || referenceDataGenerationRef.current !== generation) return;
        setCachedNamedRanges(
          namedRanges.map((nr) => ({
            name: nr.name,
            refersTo: nr.reference,
            scope: nr.scope,
            comment: nr.comment,
          })),
        );
      } catch {
        // Silent: degrade gracefully if list() fails transiently.
      }
    },
    [wb],
  );

  const loadReferenceData = useCallback(async (): Promise<void> => {
    if (referenceDataLoadedRef.current) return;
    if (referenceDataLoadRef.current) return referenceDataLoadRef.current;

    const generation = referenceDataGenerationRef.current;
    const load = (async () => {
      try {
        // Load named ranges via Workbook API
        const namedRanges = await wb.names.list();

        // Load sheets via Workbook API
        const sheetNames = await wb.getSheetNames();
        const sheets: Array<{ id: SheetId; name: string }> = [];
        for (const name of sheetNames) {
          const ws = await wb.getSheet(name);
          sheets.push({ id: ws.getSheetId(), name });
        }

        // Load tables from all sheets via Worksheet API
        const tables: Array<{
          name: string;
          sheetName: string;
          range: string;
          columns: Array<{ name: string }>;
        }> = [];
        for (const sheet of sheets) {
          const ws = wb.getSheetById(sheet.id);
          const sheetTables = await ws.tables.list();
          for (const t of sheetTables) {
            tables.push({
              name: t.name,
              sheetName: sheet.name,
              range: t.range ?? '',
              columns: (t.columns ?? []).map((c) => ({ name: c.name })),
            });
          }
        }

        if (!isMountedRef.current || referenceDataGenerationRef.current !== generation) return;

        setCachedNamedRanges(
          namedRanges.map((nr) => ({
            name: nr.name,
            refersTo: nr.reference,
            scope: nr.scope,
            comment: nr.comment,
          })),
        );
        setCachedSheets(sheets);
        setCachedTables(tables);
        referenceDataLoadedRef.current = true;
      } catch {
        // Silent: dropdown degrades gracefully without data
      } finally {
        if (referenceDataGenerationRef.current === generation) {
          referenceDataLoadRef.current = null;
        }
      }
    })();

    referenceDataLoadRef.current = load;
    return load;
  }, [wb]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      referenceDataGenerationRef.current += 1;
      referenceDataLoadRef.current = null;
    };
  }, []);

  useEffect(() => {
    referenceDataGenerationRef.current += 1;
    referenceDataLoadedRef.current = false;
    referenceDataLoadRef.current = null;
    setCachedNamedRanges([]);
    setCachedTables([]);
    setCachedSheets([]);
  }, [wb]);

  useEffect(() => {
    if (isOpen || isEditing) {
      void loadReferenceData();
    }
  }, [isOpen, isEditing, loadReferenceData]);

  // Keep the cached named-ranges list in sync with workbook-level mutations.
  // Without this, names added programmatically (or via other UI paths) wouldn't
  // be visible to the Name Box until a remount, breaking type-and-Enter
  // navigation for names that already exist in the workbook.
  useEffect(() => {
    const unsub = wb.on('namedRangeChanged', () => {
      void refreshNamedRanges();
    });
    return () => {
      unsub();
    };
  }, [wb, refreshNamedRanges]);

  // Name Box context menu state
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });

  /**
   * Display value for the name box.
   * - Single cell: shows "A1"
   * - Range: shows "A1:B5"
   * - Full column/row: shows "A:A" / "1:1"
   * - Whole sheet: shows active cell, matching Excel's select-all corner display
   * - Multiple ranges: shows comma-separated notation, Excel-style
   */
  // Active sheet name for reverse-lookup against named-range refers-to strings,
  // and for qualifying refersTo when defining a new name.
  const activeSheetName = useMemo(
    () => wb.getSheetById(activeSheetId)?.name ?? '',
    [wb, activeSheetId],
  );

  const cellAddress = useMemo(() => {
    // Excel parity: when the current single-range selection exactly matches a
    // defined name's refers-to, show the name in place of A1 coordinates.
    if (ranges.length === 1 && cachedNamedRanges.length > 0) {
      const r = ranges[0];
      for (const nr of cachedNamedRanges) {
        if (!nr.refersTo) continue;
        const ref = String(nr.refersTo).replace(/^=/, '').replace(/\$/g, '');
        const parsed = parseCellRange(ref);
        if (!parsed) continue;
        // refersTo may be sheet-qualified; ignore sheet mismatches via the
        // active sheet (selection is always anchored to the active sheet here).
        const refSheet = parsed.sheetName;
        if (refSheet && refSheet.toLowerCase() !== activeSheetName.toLowerCase()) {
          continue;
        }
        if (
          parsed.startRow === r.startRow &&
          parsed.startCol === r.startCol &&
          parsed.endRow === r.endRow &&
          parsed.endCol === r.endCol
        ) {
          return nr.name;
        }
      }
    }

    return formatNameBoxSelection(ranges, activeCell);
  }, [ranges, activeCell.row, activeCell.col, cachedNamedRanges, activeSheetName]);

  // Create store adapter for name suggestions (all data from cached async loads)
  const storeAdapter = useMemo(
    () => createStoreAdapter(cachedNamedRanges, cachedTables, cachedSheets),
    [cachedNamedRanges, cachedTables, cachedSheets],
  );

  // Get filtered suggestions
  const suggestions = useMemo(
    () => getNameSuggestions(filterText, storeAdapter, activeSheetId),
    [filterText, storeAdapter, activeSheetId],
  );

  // Group suggestions by type for display
  const groupedSuggestions = useMemo(() => {
    const definedNames = suggestions.filter((s) => s.type === 'definedName');
    const tables = suggestions.filter((s) => s.type === 'table');
    const sheets = suggestions.filter((s) => s.type === 'sheetName');
    return { definedNames, tables, sheets };
  }, [suggestions]);

  // Handle clicking on the name box to open dropdown
  const handleNameBoxClick = useCallback(() => {
    if (!isEditing) {
      setValidationError(null);
      setIsEditing(true);
      setInputValue(cellAddress);
      setIsOpen(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing, cellAddress]);

  // Handle double-click to edit (navigate by typing)
  const handleDoubleClick = useCallback(() => {
    setValidationError(null);
    setIsEditing(true);
    setInputValue(cellAddress);
    setIsOpen(false);
    // Focus input on next tick
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [cellAddress]);

  // Handle input change while editing
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValidationError(null);
    setInputValue(e.target.value);
  }, []);

  /**
   * Navigate to a cell address or named range.
   * Name Box Direct Name Typing - looks up named ranges before A1 parsing.
   *
   * Priority:
   * 1. Check for matching defined name (case-insensitive)
   * 2. Check for matching table name (case-insensitive)
   * 3. Parse as A1 notation
   */
  const navigateToAddress = useCallback(
    async (address: string) => {
      // First check for named ranges (defined names and tables)
      // This enables typing a name directly to navigate to it
      const trimmedAddress = address.trim();

      // Fast synchronous path: if the address contains a colon it is a cell
      // range ("A1:A100", "Sheet1!A1:C10") and can never be a defined name or
      // table name (identifiers don't contain colons). Skip the async name-lookup
      // and resolve directly. This makes range navigation via the Name Box
      // synchronous so callers don't have to race against an async dispatch.
      const activateSheetByName = async (sheetName: string): Promise<void> => {
        try {
          const targetSheet = await wb.getSheet(sheetName);
          const targetSheetId = targetSheet.getSheetId();
          if (targetSheetId !== activeSheetId) {
            setActiveSheetId(targetSheetId);
          }
        } catch {
          // Ignore unresolved sheet names; parsing still resolves the active-sheet coordinates.
        }
      };

      const setCellSelection = (
        range: CellRange,
        nextActiveCell: { row: number; col: number },
      ): void => {
        deps.commands.object.deselectAll();
        deps.commands.chart.deselectAll();
        selectionCommands.setSelection([range], nextActiveCell, nextActiveCell);
      };

      if (trimmedAddress.includes(':')) {
        const parsedRange = parseCellRange(trimmedAddress);
        if (parsedRange) {
          if (parsedRange.sheetName) {
            await activateSheetByName(parsedRange.sheetName);
          }
          setCellSelection(rangeFromParsedCellRange(parsedRange), {
            row: parsedRange.startRow,
            col: parsedRange.startCol,
          });
          return;
        }
      }

      // Look up defined names (case-insensitive)
      const definedNames = storeAdapter.getDefinedNames();
      const lowerAddress = trimmedAddress.toLowerCase();
      const matchingName = Object.entries(definedNames).find(
        ([name]) => name.toLowerCase() === lowerAddress,
      );

      // Helper: navigate to a named range given its refersTo string
      const navigateToNamedRangeRef = async (refersTo: string): Promise<boolean> => {
        const ref = refersTo.replace(/^=/, '').replace(/\$/g, '');
        const parsedRange = parseCellRange(ref);
        if (!parsedRange) return false;
        if (parsedRange.sheetName) {
          await activateSheetByName(parsedRange.sheetName);
        }
        setCellSelection(rangeFromParsedCellRange(parsedRange), {
          row: parsedRange.startRow,
          col: parsedRange.startCol,
        });
        return true;
      };

      if (matchingName) {
        // Found a defined name in cache - navigate to its range.
        // Excel parity: select the FULL range (not just its anchor) so the
        // user lands with the named range visually highlighted.
        const [, nameData] = matchingName;
        await navigateToNamedRangeRef(nameData.refersTo);
        return;
      }

      // Cache miss: the namedRangeChanged event may not have refreshed the
      // cache yet (timing). Fall back to a direct API lookup before treating
      // the address as a new-name definition.
      try {
        const apiEntry = await wb.names.get(trimmedAddress);
        if (apiEntry && apiEntry.reference) {
          if (await navigateToNamedRangeRef(apiEntry.reference)) {
            return;
          }
        }
      } catch {
        // Ignore errors; fall through to table / A1 / new-name branches.
      }

      // Look up table names (case-insensitive)
      const tables = storeAdapter.getTables();
      const matchingTable = tables.find((t) => t.name.toLowerCase() === lowerAddress);

      if (matchingTable) {
        // Found a table - navigate to start of table range
        const refStart = matchingTable.range.split(':')[0];
        const parsed = parseCellAddress(`${matchingTable.sheetName}!${refStart}`);
        if (parsed) {
          // Switch to table's sheet if different
          await activateSheetByName(matchingTable.sheetName);
          setCellSelection(
            {
              startRow: parsed.row,
              startCol: parsed.col,
              endRow: parsed.row,
              endCol: parsed.col,
            },
            { row: parsed.row, col: parsed.col },
          );
        }
        return;
      }

      // Fall back to A1 notation parsing (handles both single cells "A1" and
      // ranges "A1:A100" — parseCellRange is a superset of parseCellAddress).
      const parsed = parseCellRange(address);
      if (parsed) {
        const currentRange = ranges[0];
        const isSingleCellRef =
          !trimmedAddress.includes(':') &&
          parsed.startRow === parsed.endRow &&
          parsed.startCol === parsed.endCol;
        const isNoOpSelection =
          ranges.length === 1 &&
          currentRange != null &&
          currentRange.startRow === parsed.startRow &&
          currentRange.startCol === parsed.startCol &&
          currentRange.endRow === parsed.endRow &&
          currentRange.endCol === parsed.endCol &&
          activeCell.row === parsed.startRow &&
          activeCell.col === parsed.startCol;

        if (isSingleCellRef && isNoOpSelection) {
          setValidationError(INVALID_NAME_MESSAGE);
          return;
        }

        // If sheet is specified and different, switch sheets first
        if (parsed.sheetName) {
          await activateSheetByName(parsed.sheetName);
        }

        // Set selection to the range (or single cell when start === end);
        // the viewport-follow coordinator scrolls into view via the SET_SELECTION emit.
        setCellSelection(rangeFromParsedCellRange(parsed), {
          row: parsed.startRow,
          col: parsed.startCol,
        });
        return;
      }

      // Define New Name from Name Box.
      // Excel parity: typing a fresh, valid identifier into the Name Box and
      // pressing Enter immediately registers a workbook-scoped named range
      // whose refers-to is the current selection (qualified to the active
      // sheet). No intermediate dialog.
      const nameValidation = validateName(trimmedAddress, new Set(), undefined);
      if (nameValidation.valid) {
        const currentRange = ranges[0];
        if (!currentRange) return;

        const sheetPrefix = activeSheetName ? `${activeSheetName}!` : '';
        const refersTo = `=${sheetPrefix}${toA1(currentRange.startRow, currentRange.startCol)}:${toA1(currentRange.endRow, currentRange.endCol)}`;

        try {
          await wb.names.add(trimmedAddress, refersTo);
          // Refresh immediately so the cellAddress reverse-lookup picks up
          // the new entry on the very next render. The 'namedRangeChanged'
          // subscription will also fire, but explicit refresh avoids any
          // event-loop ordering surprises with the test harness.
          await refreshNamedRanges(true);
        } catch (_err) {
          // Unexpected failure (validation already filtered the typical
          // cases). Fall back to the dialog so the user can correct it.
          openDefineNameDialog({
            mode: 'create',
            initialName: trimmedAddress,
            initialRefersTo: refersTo,
          });
        }
      } else {
        setValidationError(INVALID_NAME_MESSAGE);
      }
    },
    [
      ranges,
      activeCell.row,
      activeCell.col,
      selectionCommands,
      storeAdapter,
      activeSheetId,
      activeSheetName,
      setActiveSheetId,
      openDefineNameDialog,
      wb,
      refreshNamedRanges,
      deps.commands.object,
      deps.commands.chart,
    ],
  );

  // Navigate to a named range
  const navigateToName = useCallback(
    (suggestion: NameSuggestion) => {
      if (suggestion.type === 'sheetName') {
        // Switch to the sheet
        const sheets = storeAdapter.getSheets();
        const targetSheet = sheets.find(
          (s) => s.name === suggestion.name || `'${s.name}'` === suggestion.name,
        );
        if (targetSheet) {
          setActiveSheetId(targetSheet.id);
        }
      } else if (suggestion.type === 'definedName' || suggestion.type === 'table') {
        // For defined names, prefer typing the name itself so the existing
        // named-range branch in navigateToAddress runs (selects the FULL
        // range, sets the active cell to the anchor). Tables fall back to
        // their refers-to body since they aren't in the names registry.
        if (suggestion.type === 'definedName') {
          void navigateToAddress(suggestion.name);
        } else {
          // Parse refersTo to navigate
          // refersTo format: "Sheet1!$A$1:$B$10" or "=Sheet1!$A$1"
          const ref = suggestion.refersTo.replace(/^=/, '').replace(/\$/g, '');
          void navigateToAddress(ref);
        }
      }
      setIsOpen(false);
    },
    [storeAdapter, setActiveSheetId, navigateToAddress],
  );

  // Handle input key events
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Read straight from the DOM so test harnesses (Playwright `fill`)
        // and rapid user input both commit the actual typed value, even if
        // the `inputValue` state hasn't flushed yet.
        const typed = e.currentTarget.value ?? inputValue;
        void navigateToAddress(typed);
        setIsEditing(false);
        // Radix's PopoverTrigger toggle fires on the initial button click and
        // sets isOpen=true even though we immediately override with setIsOpen(false)
        // in handleNameBoxClick. The toggle survives because Radix fires after the
        // child's onClick handler. That latent isOpen=true becomes visible once
        // isEditing goes false (open = isOpen && !isEditing). Force-close here so
        // the dropdown doesn't open after the user commits the name-box value.
        setIsOpen(false);
        // Return focus to the grid canvas. Without this, the just-unmounted
        // input drops focus to <body>, and subsequent typing is consumed by
        // whatever default-focus target the browser picks (often nothing).
        // Excel/Sheets parity: a navigator owns the focus contract — it both
        // moves the selection AND returns focus to the destination.
        coordinator.input.focusGrid();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setValidationError(null);
        setIsEditing(false);
        setIsOpen(false);
        coordinator.input.focusGrid();
      }
    },
    [inputValue, navigateToAddress, coordinator],
  );

  // Handle input blur
  const handleInputBlur = useCallback(() => {
    setIsEditing(false);
    setIsOpen(false);
  }, []);

  // Handle dropdown filter change
  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(e.target.value);
  }, []);

  // Handle context menu on name box
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuOpen(true);
    setIsOpen(false); // Close dropdown if open
  }, []);

  // Context menu actions
  const handleDefineNameFromContextMenu = useCallback(() => {
    const currentRange = ranges[0];
    const refersTo = currentRange
      ? `=${toA1(currentRange.startRow, currentRange.startCol)}:${toA1(currentRange.endRow, currentRange.endCol)}`
      : '';

    openDefineNameDialog({
      mode: 'create',
      initialName: '',
      initialRefersTo: refersTo,
    });
    setContextMenuOpen(false);
  }, [ranges, openDefineNameDialog]);

  const handleGoToFromContextMenu = useCallback(() => {
    dispatch('OPEN_GO_TO_DIALOG', deps);
    setContextMenuOpen(false);
  }, [deps]);

  // Focus filter input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      // Focus the filter input
      const filterInput = containerRef.current?.querySelector(
        'input[data-role="filter"]',
      ) as HTMLInputElement | null;
      filterInput?.focus();
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <Popover open={isOpen && !isEditing} onOpenChange={setIsOpen}>
        {isEditing ? (
          // Editing mode - show input for typing address
          <input
            ref={inputRef}
            type="text"
            data-testid="name-box"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            className="w-[80px] h-[22px] px-2 border border-ss-primary rounded bg-ss-surface text-ribbon font-medium text-text focus:outline-none focus:ring-2 focus:ring-ss-primary/20"
            spellCheck={false}
          />
        ) : (
          // Display mode - show address with dropdown trigger
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="name-box"
              value={cellAddress}
              onClick={handleNameBoxClick}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              className="w-[80px] h-[22px] px-2 border border-ss-border rounded bg-ss-surface-secondary text-ribbon font-medium text-text hover:bg-ss-surface-hover focus:outline-none focus:ring-2 focus:ring-ss-primary/20 flex items-center justify-between cursor-pointer"
            >
              <span className="truncate">{cellAddress}</span>
              <svg
                className="w-3 h-3 text-ss-text-secondary ml-1 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </PopoverTrigger>
        )}

        {/* Dropdown */}
        <PopoverContent width={240} side="bottom" align="start" sideOffset={0} role="menu">
          {/* Filter input */}
          <div className="px-2 py-1 border-b border-ss-border">
            <input
              data-role="filter"
              type="text"
              value={filterText}
              onChange={handleFilterChange}
              placeholder="Search names..."
              className="w-full h-6 px-2 text-ribbon bg-ss-surface border border-ss-border rounded focus:outline-none focus:border-ss-primary"
              spellCheck={false}
            />
          </div>

          {/* Suggestions */}
          <div className="max-h-[240px] overflow-y-auto">
            {/* Defined Names */}
            {groupedSuggestions.definedNames.length > 0 && (
              <>
                <div className="px-3 py-1 text-caption text-ss-text-tertiary font-medium uppercase">
                  Defined Names
                </div>
                {groupedSuggestions.definedNames.map((s) => (
                  <MenuItem key={`name-${s.name}`} onSelect={() => navigateToName(s)}>
                    <span className="flex items-center gap-2">
                      <span className="text-ribbon">{getNameSuggestionIcon(s.type)}</span>
                      <span className="font-medium">{s.name}</span>
                      <span className="text-ss-text-tertiary text-caption truncate">
                        {s.refersTo}
                      </span>
                    </span>
                  </MenuItem>
                ))}
              </>
            )}

            {/* Tables */}
            {groupedSuggestions.tables.length > 0 && (
              <>
                {groupedSuggestions.definedNames.length > 0 && <MenuSeparator />}
                <div className="px-3 py-1 text-caption text-ss-text-tertiary font-medium uppercase">
                  Tables
                </div>
                {groupedSuggestions.tables.map((s) => (
                  <MenuItem key={`table-${s.name}`} onSelect={() => navigateToName(s)}>
                    <span className="flex items-center gap-2">
                      <span className="text-ribbon">{getNameSuggestionIcon(s.type)}</span>
                      <span className="font-medium">{s.name}</span>
                      <span className="text-ss-text-tertiary text-caption truncate">
                        {s.refersTo}
                      </span>
                    </span>
                  </MenuItem>
                ))}
              </>
            )}

            {/* Sheets */}
            {groupedSuggestions.sheets.length > 0 && (
              <>
                {(groupedSuggestions.definedNames.length > 0 ||
                  groupedSuggestions.tables.length > 0) && <MenuSeparator />}
                <div className="px-3 py-1 text-caption text-ss-text-tertiary font-medium uppercase">
                  Sheets
                </div>
                {groupedSuggestions.sheets.map((s) => (
                  <MenuItem key={`sheet-${s.name}`} onSelect={() => navigateToName(s)}>
                    <span className="flex items-center gap-2">
                      <span className="text-ribbon">{getNameSuggestionIcon(s.type)}</span>
                      <span className="font-medium">{s.name}</span>
                    </span>
                  </MenuItem>
                ))}
              </>
            )}

            {/* Empty state */}
            {suggestions.length === 0 && (
              <div className="px-3 py-4 text-ribbon text-ss-text-tertiary text-center">
                {filterText ? 'No matches found' : 'No defined names or tables'}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {validationError && (
        <div
          role="alert"
          data-testid="name-box-validation-error"
          className="absolute left-0 top-full z-ss-popover mt-1 w-[220px] rounded border border-red-200 bg-ss-surface px-2 py-1 text-caption text-red-600 shadow-ss-md"
        >
          {validationError}
        </div>
      )}

      {/* Name Box Context Menu */}
      <Popover open={contextMenuOpen} onOpenChange={(open) => !open && setContextMenuOpen(false)}>
        <PopoverAnchor
          virtualRef={{
            current: createVirtualRef(contextMenuPosition.x, contextMenuPosition.y),
          }}
        />
        <PopoverContent side="bottom" align="start" sideOffset={0} role="menu">
          <MenuItem onSelect={handleDefineNameFromContextMenu}>Define Name...</MenuItem>
          <MenuItem onSelect={handleGoToFromContextMenu} shortcut="Ctrl+G">
            Go To...
          </MenuItem>
        </PopoverContent>
      </Popover>
    </div>
  );
});
