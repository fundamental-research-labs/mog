/**
 * DataRibbon
 *
 * Data tab content organized around Mog command groups:
 * 1. Import data (Get Data button with dropdown)
 * 2. Sort & Filter (Sort, Filter, Clear, Reapply, Advanced)
 * 3. Data Tools (Text to Cols, Flash Fill, Remove Dups, Validation, Consolidate)
 * 4. Forecast
 * 5. Outline (Group, Ungroup, Show, Hide, Subtotal)
 *
 * Row/Column Grouping
 * Get Data dropdown with import options (CSV, JSON, Web)
 *
 * Uses RibbonButton for consistent button styling (single source of truth).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useActiveCell, useUIStore } from '../../../internal-api';
import { parseCSV } from '../../../domain/clipboard/clipboard-parser';
import {
  useActiveSheetId,
  useSpreadsheetHostCommandsOptional,
  useWorkbook,
} from '../../../infra/context';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@mog/shell';
import {
  DATA_TOOLS_COLLAPSE_CONFIG,
  FORECAST_COLLAPSE_CONFIG,
  GET_EXTERNAL_DATA_COLLAPSE_CONFIG,
  OUTLINE_COLLAPSE_CONFIG,
  SORT_FILTER_COLLAPSE_CONFIG,
} from '@mog-sdk/contracts/ribbon';
import { useFilterActions } from '../../../hooks/data/use-filter-actions';
import { useGroupingActions } from '../../../hooks/data/use-grouping-actions';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { PRODUCT_VOCABULARY } from '../../../ux/product-vocabulary';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownItem, RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';
import {
  AdvancedFilterIcon,
  CircleInvalidDataIcon,
  ClearFilterIcon,
  ConsolidateIcon,
  DataValidationIcon,
  FilterIcon,
  FlashFillIcon,
  ForecastSheetIcon,
  GetDataIcon,
  GroupIcon,
  HideDetailIcon,
  ReapplyFilterIcon,
  RemoveDuplicatesIcon,
  SettingsIcon,
  ShowDetailIcon,
  SortAscIcon,
  SortDescIcon,
  SubtotalIcon,
  TextToColumnsIcon,
  UngroupIcon,
} from '../primitives/ToolbarIcons';

type JsonRow = Record<string, unknown>;
type JsonCellValue = string | number | boolean | null;
type JsonCellUpdate = { row: number; col: number; value: JsonCellValue };
type CsvCellUpdate = { row: number; col: number; value: string };

function isPlainObject(value: unknown): value is JsonRow {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function flattenJsonValue(value: unknown, prefix = '', out: JsonRow = {}): JsonRow {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      flattenJsonValue(item, prefix ? `${prefix}.${index}` : `${index}`, out),
    );
    return out;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenJsonValue(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out[prefix || 'value'] = value;
  return out;
}

function jsonToRows(value: unknown): { headers: string[]; rows: JsonRow[] } {
  const rows = (Array.isArray(value) ? value : [value]).map((item) => flattenJsonValue(item));
  // Stable table contract: nested keys use dot paths, array indexes are path segments,
  // headers are sorted, and missing fields are written as blank cells.
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).sort();
  return { headers: headers.length > 0 ? headers : ['value'], rows };
}

function cellValueFromJson(value: unknown): string | number | boolean | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

function jsonToCellUpdates(value: unknown, startRow: number, startCol: number): JsonCellUpdate[] {
  const { headers, rows } = jsonToRows(value);
  const updates: JsonCellUpdate[] = headers.map((header, colOffset) => ({
    row: startRow,
    col: startCol + colOffset,
    value: header,
  }));

  rows.forEach((row, rowIndex) => {
    headers.forEach((header, colOffset) => {
      updates.push({
        row: startRow + rowIndex + 1,
        col: startCol + colOffset,
        value: cellValueFromJson(row[header]),
      });
    });
  });

  return updates;
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function csvToCellUpdates(text: string): CsvCellUpdate[] {
  return parseCSV(stripUtf8Bom(text)).flatMap((row, rowIndex) =>
    row.map((value, colIndex) => ({ row: rowIndex, col: colIndex, value })),
  );
}

function isValidImportUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// =============================================================================
// Inline Icons for Get Data dropdown
// =============================================================================

/** CSV File Icon */
function CsvFileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2"
        y="1"
        width="12"
        height="14"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <text x="4" y="11" fontSize="6" fontWeight="bold" fill="currentColor">
        CSV
      </text>
    </svg>
  );
}

/** JSON File Icon */
function JsonFileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2"
        y="1"
        width="12"
        height="14"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <text x="3" y="10" fontSize="5" fontWeight="bold" fill="currentColor">
        {'{ }'}
      </text>
    </svg>
  );
}

/** Web/Globe Icon */
function WebIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <ellipse cx="8" cy="8" rx="3" ry="6" stroke="currentColor" strokeWidth="1" fill="none" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1" />
      <line x1="3" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="0.8" />
      <line x1="3" y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}

interface DataRibbonProps {
  /** Called when data validation is requested */
  onDataValidation?: () => void;
  /** Called when remove duplicates is requested */
  onRemoveDuplicates?: () => void;
  /** Called when text to columns is requested */
  onTextToColumns?: () => void;
  /** Called when subtotals dialog is requested */
  onSubtotals?: () => void;
  /** Called when importing from CSV (Get Data dropdown) */
  onImportCsv?: (file: File) => void;
  /** Called when importing from JSON (Get Data dropdown) */
  onImportJson?: (file: File) => void;
  /** Called when importing from Web (Get Data dropdown) - uses existing Bind Sheet */
  onImportFromWeb?: () => void;
}

export function DataRibbon({
  onDataValidation,
  onRemoveDuplicates,
  onTextToColumns,
  onSubtotals,
  onImportCsv,
  onImportJson,
  onImportFromWeb,
}: DataRibbonProps) {
  const { groupRows, groupColumns, canGroup, canUngroup, canShowDetail, canHideDetail } =
    useGroupingActions();
  const { canClearFilters, canReapplyFilters } = useFilterActions();

  // Get dispatch for action handling
  const dispatch = useDispatch();
  const hostCommands = useSpreadsheetHostCommandsOptional();
  const workbook = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const { row: activeRow, col: activeCol } = useActiveCell();

  // F1: Validation circles state
  const validationCirclesVisible = useUIStore((s) => s.validationCirclesVisible);

  // Get Data dropdown state
  // lifted into the ribbonDropdowns slice so the keytip chord
  // (Alt+A,G) can open it via OPEN_RIBBON_DROPDOWN.
  const isGetDataDropdownOpen = useUIStore((s) => s.ribbonDropdowns['data.get-data'] ?? false);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const [isFromWebDialogOpen, setIsFromWebDialogOpen] = useState(false);
  const [fromWebUrl, setFromWebUrl] = useState('');
  const [fromWebValidationText, setFromWebValidationText] = useState('');
  const fromWebUrlInputRef = useRef<HTMLInputElement>(null);
  const setIsGetDataDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('data.get-data') : closeRibbonDropdown('data.get-data'),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  // Use props if provided, otherwise use dispatch (Architecture Alignment)
  const handleSubtotals = onSubtotals ?? (() => dispatch('OPEN_SUBTOTAL_DIALOG'));
  const handleRemoveDuplicates =
    onRemoveDuplicates ?? (() => dispatch('OPEN_REMOVE_DUPLICATES_DIALOG'));
  const handleTextToColumns = onTextToColumns ?? (() => dispatch('OPEN_TEXT_TO_COLUMNS_DIALOG'));

  // Get Data import handlers
  const handleGetDataClick = useCallback(() => {
    setIsGetDataDropdownOpen(!isGetDataDropdownOpen);
  }, [isGetDataDropdownOpen, setIsGetDataDropdownOpen]);

  const handleImportCsv = useCallback(() => {
    setIsGetDataDropdownOpen(false);
    if (hostCommands) {
      const owner = hostCommands.getOwner('import');
      if (owner === 'disabled') return;
      if (owner === 'host') {
        void hostCommands.request({ command: 'import', format: 'csv', source: 'data-ribbon' });
        return;
      }
    }
    // Create a file input to open file picker
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        if (onImportCsv) {
          onImportCsv(file);
        } else {
          void file.text().then(async (text) => {
            const updates = csvToCellUpdates(text);
            if (updates.length > 0) {
              await workbook.getSheetById(activeSheetId).setCells(updates);
            }
          });
        }
      }
    };
    input.click();
  }, [activeSheetId, hostCommands, onImportCsv, setIsGetDataDropdownOpen, workbook]);

  const handleImportJson = useCallback(() => {
    setIsGetDataDropdownOpen(false);
    if (hostCommands) {
      const owner = hostCommands.getOwner('import');
      if (owner === 'disabled') return;
      if (owner === 'host') {
        void hostCommands.request({ command: 'import', format: 'json', source: 'data-ribbon' });
        return;
      }
    }
    // Create a file input to open file picker
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        if (onImportJson) {
          onImportJson(file);
        } else {
          void file.text().then(async (text) => {
            const parsed = JSON.parse(text);
            const updates = jsonToCellUpdates(parsed, activeRow, activeCol);
            const ws = workbook.getSheetById(activeSheetId);
            if (updates.length > 0) {
              await ws.setCells(updates);
            }
          });
        }
      }
    };
    input.click();
  }, [
    activeCol,
    activeRow,
    activeSheetId,
    hostCommands,
    onImportJson,
    setIsGetDataDropdownOpen,
    workbook,
  ]);

  const closeFromWebDialog = useCallback(() => {
    setIsFromWebDialogOpen(false);
    setFromWebUrl('');
    setFromWebValidationText('');
  }, []);

  const openFromWebDialog = useCallback(() => {
    setFromWebUrl('');
    setFromWebValidationText('');
    setIsFromWebDialogOpen(true);
  }, []);

  const handleImportFromWeb = useCallback(() => {
    setIsGetDataDropdownOpen(false);
    if (hostCommands) {
      const owner = hostCommands.getOwner('import');
      if (owner === 'disabled') return;
      if (owner === 'host') {
        void hostCommands.request({ command: 'import', source: 'data-ribbon:web' });
        return;
      }
    }
    if (onImportFromWeb) {
      onImportFromWeb();
      return;
    }
    openFromWebDialog();
  }, [hostCommands, onImportFromWeb, openFromWebDialog, setIsGetDataDropdownOpen]);

  const handleFromWebUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextUrl = event.currentTarget.value;
    setFromWebUrl(nextUrl);
    setFromWebValidationText(
      nextUrl.length > 0 && !isValidImportUrl(nextUrl) ? 'Enter a valid URL' : '',
    );
  }, []);

  const handleFromWebSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!isValidImportUrl(fromWebUrl)) {
        setFromWebValidationText('Enter a valid URL');
        fromWebUrlInputRef.current?.focus();
        return;
      }
      closeFromWebDialog();
    },
    [closeFromWebDialog, fromWebUrl],
  );

  const handleFromWebKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        closeFromWebDialog();
      }
    },
    [closeFromWebDialog],
  );

  useEffect(() => {
    if (isFromWebDialogOpen) {
      fromWebUrlInputRef.current?.focus();
    }
  }, [isFromWebDialogOpen]);

  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
  const handleGroupClick = useCallback(() => {
    if (!canGroup) return;
    setIsGroupDropdownOpen((open) => !open);
  }, [canGroup]);
  const handleGroupRows = useCallback(() => {
    setIsGroupDropdownOpen(false);
    groupRows();
  }, [groupRows]);
  const handleGroupColumns = useCallback(() => {
    setIsGroupDropdownOpen(false);
    groupColumns();
  }, [groupColumns]);
  const handleUngroupClick = useCallback(() => {
    window.setTimeout(() => dispatch('UNGROUP'), 0);
  }, [dispatch]);

  useEffect(() => {
    if (!canGroup) setIsGroupDropdownOpen(false);
  }, [canGroup]);

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-data.ts` and `keyboard/definitions/data.ts`
  // (V,V data-validation; W,{G,S,T} scenarios chords).)
  // ===========================================================================

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    keyTipRegistry.register({ key: 'G', tabId: 'data', elementId: 'data-get-data' });
    cleanups.push(() => keyTipRegistry.unregister('G', 'data'));

    keyTipRegistry.register({ key: 'A', tabId: 'data', elementId: 'data-sort-asc' });
    cleanups.push(() => keyTipRegistry.unregister('A', 'data'));

    keyTipRegistry.register({ key: 'Z', tabId: 'data', elementId: 'data-sort-desc' });
    cleanups.push(() => keyTipRegistry.unregister('Z', 'data'));

    keyTipRegistry.register({ key: 'F', tabId: 'data', elementId: 'data-filter' });
    cleanups.push(() => keyTipRegistry.unregister('F', 'data'));

    if (onDataValidation) {
      keyTipRegistry.register({ key: 'V', tabId: 'data', elementId: 'data-validation' });
      cleanups.push(() => keyTipRegistry.unregister('V', 'data'));
    }

    if (canGroup) {
      keyTipRegistry.register({ key: 'O', tabId: 'data', elementId: 'data-group' });
      cleanups.push(() => keyTipRegistry.unregister('O', 'data'));
    }

    if (canUngroup) {
      keyTipRegistry.register({ key: 'U', tabId: 'data', elementId: 'data-ungroup' });
      cleanups.push(() => keyTipRegistry.unregister('U', 'data'));
    }

    keyTipRegistry.register({ key: 'SU', tabId: 'data', elementId: 'data-subtotal' });
    cleanups.push(() => keyTipRegistry.unregister('SU', 'data'));

    keyTipRegistry.register({ key: 'W', tabId: 'data', elementId: 'data-whatif-analysis' });
    cleanups.push(() => keyTipRegistry.unregister('W', 'data'));

    keyTipRegistry.register({ key: 'WG', tabId: 'data', elementId: 'data-whatif-goal-seek' });
    cleanups.push(() => keyTipRegistry.unregister('WG', 'data'));

    keyTipRegistry.register({
      key: 'WS',
      tabId: 'data',
      elementId: 'data-whatif-scenario-manager',
    });
    cleanups.push(() => keyTipRegistry.unregister('WS', 'data'));

    keyTipRegistry.register({ key: 'WT', tabId: 'data', elementId: 'data-whatif-data-table' });
    cleanups.push(() => keyTipRegistry.unregister('WT', 'data'));

    return () => cleanups.forEach((c) => c());
  }, [onDataValidation, canGroup, canUngroup]);

  return (
    <>
      {/* 1. Import Data Group - Improved with import options */}
      <ToolbarGroup
        label={PRODUCT_VOCABULARY.importData.label}
        collapseConfig={GET_EXTERNAL_DATA_COLLAPSE_CONFIG}
        dropdownIcon={<GetDataIcon />}
      >
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          <div className="relative inline-flex">
            <RibbonButton
              id="data-get-data"
              layout="vertical"
              height="full"
              width="narrow"
              data-testid="ribbon-dropdown-get-data"
              icon={<GetDataIcon />}
              label={'Import\nData'}
              hasDropdown
              dropdownPosition="inline"
              isOpen={isGetDataDropdownOpen}
              onClick={handleGetDataClick}
              title="Import data from files or web"
              aria-label={PRODUCT_VOCABULARY.importData.label}
              aria-expanded={isGetDataDropdownOpen}
              aria-haspopup="menu"
            />

            {/* Get Data dropdown menu */}
            <RibbonDropdownPanel
              open={isGetDataDropdownOpen}
              onClose={() => setIsGetDataDropdownOpen(false)}
            >
              <div
                data-testid="ribbon-dropdown-menu-get-data"
                className="bg-ss-surface rounded shadow-ss-md border border-ss-border min-w-[180px] py-1"
                role="menu"
                aria-label="Import data options"
              >
                {/* From CSV */}
                <RibbonVisibilityItem item="fromCsv">
                  <RibbonDropdownItem
                    dataValue="csv"
                    icon={<CsvFileIcon />}
                    onClick={handleImportCsv}
                  >
                    From CSV
                  </RibbonDropdownItem>
                </RibbonVisibilityItem>

                {/* From JSON */}
                <RibbonVisibilityItem item="fromJson">
                  <RibbonDropdownItem
                    dataValue="json"
                    icon={<JsonFileIcon />}
                    onClick={handleImportJson}
                  >
                    From JSON
                  </RibbonDropdownItem>
                </RibbonVisibilityItem>

                {/* From Web (uses existing Bind Sheet functionality) */}
                <RibbonVisibilityItem item="fromWeb">
                  <RibbonDropdownItem
                    dataValue="web"
                    icon={<WebIcon />}
                    onClick={handleImportFromWeb}
                  >
                    From Web
                  </RibbonDropdownItem>
                </RibbonVisibilityItem>
              </div>
            </RibbonDropdownPanel>
          </div>
        </div>
      </ToolbarGroup>

      {isFromWebDialogOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center bg-black/20 pt-24"
          onMouseDown={closeFromWebDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="from-web-import-title"
            className="w-[min(420px,calc(100vw-32px))] rounded border border-ss-border bg-ss-surface p-4 shadow-ss-lg"
            onKeyDown={handleFromWebKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <form onSubmit={handleFromWebSubmit} className="flex flex-col gap-3">
              <div>
                <h2 id="from-web-import-title" className="text-sm font-semibold text-ss-text">
                  From Web
                </h2>
                <p className="mt-1 text-xs text-ss-text-secondary">Import data from a web URL.</p>
              </div>
              <label className="flex flex-col gap-1 text-xs font-medium text-ss-text">
                Web URL
                <input
                  ref={fromWebUrlInputRef}
                  type="url"
                  value={fromWebUrl}
                  onChange={handleFromWebUrlChange}
                  aria-invalid={fromWebValidationText ? 'true' : 'false'}
                  aria-describedby="from-web-import-validation"
                  placeholder="https://example.com/data.csv"
                  className="h-8 rounded border border-ss-border bg-ss-surface px-2 text-sm font-normal text-ss-text outline-none focus:border-ss-accent"
                />
              </label>
              <p
                id="from-web-import-validation"
                role={fromWebValidationText ? 'alert' : undefined}
                className="min-h-4 text-xs text-ss-error"
              >
                {fromWebValidationText}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-ss-border px-3 py-1.5 text-sm text-ss-text"
                  onClick={closeFromWebDialog}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-ss-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={!isValidImportUrl(fromWebUrl)}
                >
                  Import
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* 2. Sort & Filter Group */}
      <ToolbarGroup
        label="Sort & Filter"
        collapseConfig={SORT_FILTER_COLLAPSE_CONFIG}
        dropdownIcon={<FilterIcon />}
      >
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          <RibbonButton
            id="data-sort-asc"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<SortAscIcon />}
            label={'Sort\nA-Z'}
            onClick={() => dispatch('SORT_ASCENDING')}
            title="Sort Ascending (A-Z)"
            aria-label="Sort Ascending"
          />
          <RibbonButton
            id="data-sort-desc"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<SortDescIcon />}
            label={'Sort\nZ-A'}
            onClick={() => dispatch('SORT_DESCENDING')}
            title="Sort Descending (Z-A)"
            aria-label="Sort Descending"
          />
          <RibbonButton
            id="data-sort-custom"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<SortAscIcon />}
            label={'Custom\nSort'}
            onClick={() => dispatch('OPEN_CUSTOM_SORT_DIALOG')}
            title="Custom Sort (multi-column sort dialog)"
            aria-label="Custom Sort"
          />
          <RibbonButton
            id="data-filter"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<FilterIcon />}
            label="Filter"
            onClick={() => dispatch('TOGGLE_AUTO_FILTER')}
            title="Toggle AutoFilter (Ctrl+Shift+L)"
            aria-label="Filter"
          />
          <RibbonButton
            id="data-clear-filter"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<ClearFilterIcon />}
            label="Clear"
            onClick={() => dispatch('CLEAR_ALL_FILTERS')}
            disabled={!canClearFilters}
            title={canClearFilters ? 'Clear all filter criteria' : 'Clear (no active filters)'}
            aria-label="Clear All Filters"
          />
          <RibbonButton
            id="data-reapply-filter"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<ReapplyFilterIcon />}
            label="Reapply"
            onClick={() => dispatch('REAPPLY_FILTERS')}
            disabled={!canReapplyFilters}
            title={
              canReapplyFilters
                ? 'Reapply filters after data changes'
                : 'Reapply (no filters on sheet)'
            }
            aria-label="Reapply Filters"
          />
          <RibbonButton
            id="data-advanced-filter"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<AdvancedFilterIcon />}
            label="Advanced"
            onClick={() => dispatch('OPEN_ADVANCED_FILTER_DIALOG')}
            title="Advanced Filter - filter in place or copy to location"
            aria-label="Advanced Filter"
          />
        </div>
      </ToolbarGroup>

      {/* 3. Data Tools Group */}
      <ToolbarGroup
        label="Data Tools"
        collapseConfig={DATA_TOOLS_COLLAPSE_CONFIG}
        dropdownIcon={<DataValidationIcon />}
      >
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<TextToColumnsIcon />}
            label={'Text to\nCols'}
            onClick={handleTextToColumns}
            title="Text to Columns"
            aria-label="Text to Columns"
            visibilityKey="textToColumns"
          />
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<FlashFillIcon />}
            label={'Flash\nFill'}
            onClick={() => dispatch('FLASH_FILL')}
            title="Flash Fill (Ctrl+E) - Detect patterns and fill values"
            aria-label="Flash Fill"
          />
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<RemoveDuplicatesIcon />}
            label={'Remove\nDups'}
            onClick={handleRemoveDuplicates}
            title="Remove Duplicates"
            aria-label="Remove Duplicates"
            visibilityKey="removeDuplicates"
          />
          <RibbonButton
            id="data-validation"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<DataValidationIcon />}
            label="Validation"
            onClick={onDataValidation}
            disabled={!onDataValidation}
            title={onDataValidation ? 'Data Validation' : 'Data Validation (coming soon)'}
            aria-label="Data Validation"
            visibilityKey="dataValidation"
          />
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<CircleInvalidDataIcon />}
            label={validationCirclesVisible ? 'Clear\nCircles' : 'Circle\nInvalid'}
            onClick={() => dispatch('TOGGLE_VALIDATION_CIRCLES')}
            isOpen={validationCirclesVisible}
            title={
              validationCirclesVisible
                ? 'Clear Validation Circles'
                : 'Circle Invalid Data - Show red circles around cells with validation errors'
            }
            aria-label={
              validationCirclesVisible ? 'Clear Validation Circles' : 'Circle Invalid Data'
            }
            visibilityKey={validationCirclesVisible ? 'clearCircles' : 'circleInvalid'}
          />
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<ConsolidateIcon />}
            label="Consolidate"
            onClick={() => dispatch('OPEN_CONSOLIDATE_DIALOG')}
            title="Consolidate"
            aria-label="Consolidate"
            visibilityKey="consolidate"
          />
        </div>
      </ToolbarGroup>

      {/* 4. Forecast Group */}
      <ToolbarGroup
        label="Forecast"
        collapseConfig={FORECAST_COLLAPSE_CONFIG}
        dropdownIcon={<ForecastSheetIcon />}
      >
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          <RibbonButton
            id="data-forecast-sheet"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<ForecastSheetIcon />}
            label="Forecast Sheet"
            onClick={() => dispatch('OPEN_FORECAST_SHEET_DIALOG')}
            title="Forecast Sheet"
            aria-label="Forecast Sheet"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <RibbonButton
                id="data-whatif-analysis"
                layout="vertical"
                height="full"
                width="narrow"
                icon={<SettingsIcon />}
                label={PRODUCT_VOCABULARY.scenarios.label}
                hasDropdown
                title="Scenario tools (Alt+A, W)"
                aria-label={PRODUCT_VOCABULARY.scenarios.label}
                visibilityKey="whatIfAnalysis"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                id="data-whatif-goal-seek"
                onSelect={() => dispatch('OPEN_GOAL_SEEK_DIALOG')}
              >
                Goal Seek... (G)
              </DropdownMenuItem>
              <DropdownMenuItem
                id="data-whatif-scenario-manager"
                onSelect={() => dispatch('OPEN_SCENARIO_MANAGER_DIALOG')}
              >
                Scenario Manager... (S)
              </DropdownMenuItem>
              <DropdownMenuItem
                id="data-whatif-data-table"
                onSelect={() => dispatch('OPEN_DATA_TABLE_DIALOG')}
              >
                Data Table... (T)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ToolbarGroup>

      {/* 5. Outline Group */}
      <ToolbarGroup
        label="Outline"
        isLast
        collapseConfig={OUTLINE_COLLAPSE_CONFIG}
        dropdownIcon={<GroupIcon />}
      >
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          <div className="relative inline-flex">
            <RibbonButton
              id="data-group"
              layout="vertical"
              height="full"
              width="narrow"
              icon={<GroupIcon />}
              label="Group"
              onClick={handleGroupClick}
              disabled={!canGroup}
              isOpen={isGroupDropdownOpen}
              title="Group selected rows or columns"
              aria-label="Group"
              aria-expanded={isGroupDropdownOpen}
              aria-haspopup="menu"
            />
            <RibbonDropdownPanel
              open={isGroupDropdownOpen}
              onClose={() => setIsGroupDropdownOpen(false)}
            >
              <div
                className="bg-ss-surface rounded shadow-ss-md border border-ss-border min-w-[120px] py-1"
                role="menu"
                aria-label="Group rows or columns"
              >
                <RibbonDropdownItem dataValue="rows" icon={<GroupIcon />} onClick={handleGroupRows}>
                  Rows
                </RibbonDropdownItem>
                <RibbonDropdownItem
                  dataValue="columns"
                  icon={<GroupIcon />}
                  onClick={handleGroupColumns}
                >
                  Columns
                </RibbonDropdownItem>
              </div>
            </RibbonDropdownPanel>
          </div>
          <RibbonButton
            id="data-ungroup"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<UngroupIcon />}
            label="Ungroup"
            onClick={handleUngroupClick}
            disabled={!canUngroup}
            title="Ungroup selected rows (Alt+Shift+Left)"
            aria-label="Ungroup"
          />
          <RibbonButton
            id="data-show-detail"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<ShowDetailIcon />}
            label="Show"
            onClick={() => dispatch('SHOW_DETAIL')}
            disabled={!canShowDetail}
            title={
              canShowDetail
                ? 'Show Detail - Expand collapsed groups'
                : 'Show Detail (no collapsed groups)'
            }
            aria-label="Show Detail"
            visibilityKey="showDetail"
          />
          <RibbonButton
            id="data-hide-detail"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<HideDetailIcon />}
            label="Hide"
            onClick={() => dispatch('HIDE_DETAIL')}
            disabled={!canHideDetail}
            title={
              canHideDetail
                ? 'Hide Detail - Collapse expanded groups'
                : 'Hide Detail (no expanded groups)'
            }
            aria-label="Hide Detail"
            visibilityKey="hideDetail"
          />
          <RibbonButton
            id="data-subtotal"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<SubtotalIcon />}
            label="Subtotal"
            onClick={handleSubtotals}
            title="Subtotals - Create subtotals with grouping"
            aria-label="Subtotals"
            visibilityKey="subtotals"
          />
        </div>
      </ToolbarGroup>
    </>
  );
}
