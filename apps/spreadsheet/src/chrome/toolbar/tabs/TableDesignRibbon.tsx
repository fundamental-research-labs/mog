/**
 * TableDesignRibbon
 *
 * Contextual ribbon tab shown when selection is inside a table.
 * Provides table properties, style options, and style gallery.
 *
 * Tables
 *
 * MIGRATION: Tailwind + UI primitives
 * - Replaced inline styles with Tailwind classes
 * - Removed JS hover handlers - using CSS hover: variants
 * - Using Button, Checkbox, Input primitives from ../ui/
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from 'react';

import { DARK_STYLES, getTableStyleColors, LIGHT_STYLES, MEDIUM_STYLES } from '@mog/grid-renderer';
import { useUIStore } from '../../../internal-api';
import { Checkbox, Input } from '@mog/shell';
import {
  TABLE_PROPERTIES_COLLAPSE_CONFIG,
  TABLE_STYLE_OPTIONS_COLLAPSE_CONFIG,
  TABLE_STYLES_COLLAPSE_CONFIG,
  TABLE_TOOLS_COLLAPSE_CONFIG,
} from '@mog-sdk/contracts/ribbon';
import type { TableStylePreset } from '@mog-sdk/contracts/tables';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownItem, RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';
import {
  ConvertToRangeIcon,
  DeleteTableIcon,
  DropdownArrowIcon,
  PivotTableIcon,
  RemoveDuplicatesIcon,
  SlicerIcon,
  TableIcon,
} from '../primitives/ToolbarIcons';

// =============================================================================
// Types
// =============================================================================

interface TableDesignRibbonProps {
  /** Table name */
  tableName: string | null;
  /** Current style preset */
  stylePreset: TableStylePreset | undefined;
  /** Style options */
  showBandedRows: boolean;
  showBandedColumns: boolean;
  showFirstColumnHighlight: boolean;
  showLastColumnHighlight: boolean;
  hasHeaderRow: boolean;
  hasTotalRow: boolean;
  /** Whether filter buttons are shown */
  showFilterButtons: boolean;
  // Actions
  onRenameTable: (name: string) => void;
  onSetStylePreset: (preset: TableStylePreset) => void;
  onToggleBandedRows: () => void;
  onToggleBandedColumns: () => void;
  onToggleFirstColumnHighlight: () => void;
  onToggleLastColumnHighlight: () => void;
  onToggleHeaderRow: () => void;
  onToggleTotalRow: () => void;
  /** Toggle filter buttons visibility */
  onToggleFilterButtons: () => void;
  onDeleteTable: () => void;
  onConvertToRange: () => void;
}

// =============================================================================
// Style Gallery Component
// =============================================================================

function isA1StyleCellReference(name: string): boolean {
  const match = /^([A-Za-z]{1,3})([0-9]+)$/.exec(name);
  if (!match) return false;

  const row = Number(match[2]);
  if (!Number.isInteger(row) || row < 1 || row > 1_048_576) return false;

  let col = 0;
  for (const char of match[1].toUpperCase()) {
    col = col * 26 + (char.charCodeAt(0) - 64);
  }

  return col >= 1 && col <= 16_384;
}

function isValidTableNameSyntax(name: string): boolean {
  if (name.trim().length === 0) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  return !isA1StyleCellReference(name);
}

interface StyleSwatchProps {
  preset: TableStylePreset;
  isSelected: boolean;
  onClick: () => void;
}

function StyleSwatch({ preset, isSelected, onClick }: StyleSwatchProps) {
  const colors = getTableStyleColors(preset);

  return (
    <button
      type="button"
      onClick={onClick}
      title={preset}
      className={`w-8 h-6 flex flex-col overflow-hidden rounded-ss-sm cursor-pointer transition-colors duration-ss-fast p-0 ${
        isSelected ? 'border-2 border-ss-primary' : 'border border-ss-border'
      }`}
      style={{
        backgroundColor: colors.rowBackground1,
      }}
    >
      {/* Header row preview */}
      <div
        className="h-1.5 w-full"
        style={{
          backgroundColor: colors.headerBackground,
        }}
      />
      {/* Data rows preview */}
      <div className="h-1.5 w-full" style={{ backgroundColor: colors.rowBackground1 }} />
      <div className="h-1.5 w-full" style={{ backgroundColor: colors.rowBackground2 }} />
      <div className="h-1.5 w-full" style={{ backgroundColor: colors.rowBackground1 }} />
    </button>
  );
}

interface StyleGalleryProps {
  currentPreset: TableStylePreset | undefined;
  onSelectPreset: (preset: TableStylePreset) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

function StyleGallery({ currentPreset, onSelectPreset, isOpen, onOpenChange }: StyleGalleryProps) {
  // Get all style presets organized by category
  const lightStyles = Object.keys(LIGHT_STYLES) as TableStylePreset[];
  const mediumStyles = Object.keys(MEDIUM_STYLES) as TableStylePreset[];
  const darkStyles = Object.keys(DARK_STYLES) as TableStylePreset[];

  // Show first 7 styles inline
  const inlineStyles = mediumStyles.slice(0, 7);

  return (
    <div className="relative inline-flex">
      <div className="flex gap-[var(--ribbon-group-items-gap)] items-center">
        {inlineStyles.map((preset) => (
          <StyleSwatch
            key={preset}
            preset={preset}
            isSelected={currentPreset === preset}
            onClick={() => onSelectPreset(preset)}
          />
        ))}
        <RibbonButton
          id="table-style-gallery"
          layout="icon-only"
          icon={<DropdownArrowIcon />}
          onClick={() => onOpenChange(!isOpen)}
          isOpen={isOpen}
          title="More table styles"
          aria-label="More table styles"
          aria-expanded={isOpen}
          aria-haspopup="menu"
        />
      </div>

      {/* Portal-based dropdown - escapes stacking context issues */}
      <RibbonDropdownPanel open={isOpen} onClose={() => onOpenChange(false)}>
        <div
          className="bg-ss-surface border border-ss-border rounded shadow-ss-md p-2 max-h-80 overflow-y-auto w-70"
          role="menu"
          aria-label="Table Style Gallery"
          data-testid="ribbon-dropdown-menu-table-design-style-gallery"
        >
          {/* Light styles */}
          <div className="mb-2">
            <div className="text-ribbon-group font-semibold text-ss-text-tertiary mb-1">Light</div>
            <div className="flex flex-wrap gap-[var(--ribbon-group-items-gap)]">
              {lightStyles.map((preset) => (
                <StyleSwatch
                  key={preset}
                  preset={preset}
                  isSelected={currentPreset === preset}
                  onClick={() => {
                    onSelectPreset(preset);
                    onOpenChange(false);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Medium styles */}
          <div className="mb-2">
            <div className="text-ribbon-group font-semibold text-ss-text-tertiary mb-1">Medium</div>
            <div className="flex flex-wrap gap-[var(--ribbon-group-items-gap)]">
              {mediumStyles.map((preset) => (
                <StyleSwatch
                  key={preset}
                  preset={preset}
                  isSelected={currentPreset === preset}
                  onClick={() => {
                    onSelectPreset(preset);
                    onOpenChange(false);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Dark styles */}
          <div>
            <div className="text-ribbon-group font-semibold text-ss-text-tertiary mb-1">Dark</div>
            <div className="flex flex-wrap gap-[var(--ribbon-group-items-gap)]">
              {darkStyles.map((preset) => (
                <StyleSwatch
                  key={preset}
                  preset={preset}
                  isSelected={currentPreset === preset}
                  onClick={() => {
                    onSelectPreset(preset);
                    onOpenChange(false);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Clear style option */}
          <div className="mt-2 border-t border-ss-border-light pt-2">
            <RibbonDropdownItem
              onClick={() => {
                onSelectPreset('none');
                onOpenChange(false);
              }}
              closeOnClick={false}
            >
              Clear Table Style
            </RibbonDropdownItem>
          </div>
        </div>
      </RibbonDropdownPanel>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function TableDesignRibbon({
  tableName,
  stylePreset,
  showBandedRows,
  showBandedColumns,
  showFirstColumnHighlight,
  showLastColumnHighlight,
  hasHeaderRow,
  hasTotalRow,
  showFilterButtons,
  onRenameTable,
  onSetStylePreset,
  onToggleBandedRows,
  onToggleBandedColumns,
  onToggleFirstColumnHighlight,
  onToggleLastColumnHighlight,
  onToggleHeaderRow,
  onToggleTotalRow,
  onToggleFilterButtons,
  onDeleteTable,
  onConvertToRange,
}: TableDesignRibbonProps) {
  const [localName, setLocalName] = useState(tableName ?? '');
  const localNameRef = useRef(tableName ?? '');
  const dispatch = useDispatch();

  // style gallery dropdown lifted into the ribbonDropdowns slice so
  // the keytip chord (Alt+J,T,S) can open it via OPEN_RIBBON_DROPDOWN.
  const styleGalleryOpen = useUIStore(
    (s) => s.ribbonDropdowns['table-design.style-gallery'] ?? false,
  );
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const setStyleGalleryOpen = useCallback(
    (open: boolean) =>
      open
        ? openRibbonDropdown('table-design.style-gallery')
        : closeRibbonDropdown('table-design.style-gallery'),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  const handleNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    localNameRef.current = e.target.value;
    setLocalName(e.target.value);
  }, []);

  const handleNameBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      const nextName = localNameRef.current || e.currentTarget.value;
      if (!isValidTableNameSyntax(nextName)) {
        localNameRef.current = tableName ?? '';
        setLocalName(tableName ?? '');
        return;
      }
      if (nextName !== tableName) {
        onRenameTable(nextName);
      }
    },
    [tableName, onRenameTable],
  );

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        localNameRef.current = tableName ?? '';
        setLocalName(tableName ?? '');
        e.currentTarget.blur();
      }
    },
    [tableName],
  );

  // Update local name when the selected table changes, without clobbering an
  // in-progress edit on every controlled-input render.
  useEffect(() => {
    if (tableName === null || document.activeElement?.tagName === 'INPUT') return;
    localNameRef.current = tableName;
    setLocalName(tableName);
  }, [tableName]);

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-table-design.ts`.)
  // ===========================================================================

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    keyTipRegistry.register({
      key: 'C',
      tabId: 'tableDesign',
      elementId: 'table-convert-to-range',
    });
    cleanups.push(() => keyTipRegistry.unregister('C', 'tableDesign'));

    keyTipRegistry.register({ key: 'D', tabId: 'tableDesign', elementId: 'table-delete' });
    cleanups.push(() => keyTipRegistry.unregister('D', 'tableDesign'));

    keyTipRegistry.register({ key: 'R', tabId: 'tableDesign', elementId: 'table-resize' });
    cleanups.push(() => keyTipRegistry.unregister('R', 'tableDesign'));

    keyTipRegistry.register({ key: 'P', tabId: 'tableDesign', elementId: 'table-summarize-pivot' });
    cleanups.push(() => keyTipRegistry.unregister('P', 'tableDesign'));

    keyTipRegistry.register({
      key: 'M',
      tabId: 'tableDesign',
      elementId: 'table-remove-duplicates',
    });
    cleanups.push(() => keyTipRegistry.unregister('M', 'tableDesign'));

    keyTipRegistry.register({ key: 'I', tabId: 'tableDesign', elementId: 'table-insert-slicer' });
    cleanups.push(() => keyTipRegistry.unregister('I', 'tableDesign'));

    keyTipRegistry.register({ key: 'S', tabId: 'tableDesign', elementId: 'table-style-gallery' });
    cleanups.push(() => keyTipRegistry.unregister('S', 'tableDesign'));

    keyTipRegistry.register({ key: 'H', tabId: 'tableDesign', elementId: 'table-header-row' });
    cleanups.push(() => keyTipRegistry.unregister('H', 'tableDesign'));

    keyTipRegistry.register({ key: 'T', tabId: 'tableDesign', elementId: 'table-total-row' });
    cleanups.push(() => keyTipRegistry.unregister('T', 'tableDesign'));

    keyTipRegistry.register({ key: 'B', tabId: 'tableDesign', elementId: 'table-banded-rows' });
    cleanups.push(() => keyTipRegistry.unregister('B', 'tableDesign'));

    keyTipRegistry.register({ key: 'F', tabId: 'tableDesign', elementId: 'table-filter-button' });
    cleanups.push(() => keyTipRegistry.unregister('F', 'tableDesign'));

    return () => cleanups.forEach((c) => c());
  }, []);

  return (
    <>
      {/* Properties Group */}
      <ToolbarGroup
        label="Properties"
        visibilityKey="tableProperties"
        collapseConfig={TABLE_PROPERTIES_COLLAPSE_CONFIG}
        dropdownIcon={<TableIcon />}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <TableIcon />
            <span className="text-ribbon text-ss-text-tertiary">Table Name:</span>
          </div>
          <RibbonVisibilityItem item="tableName">
            <Input
              type="text"
              value={localName}
              onChange={handleNameChange}
              onBlur={handleNameBlur}
              onKeyDown={handleNameKeyDown}
              className="w-25 px-1 py-0.5 text-ribbon"
              title="Table name (used in structured references)"
              aria-label="Table Name"
            />
          </RibbonVisibilityItem>
        </div>
      </ToolbarGroup>

      {/* Table Style Options Group */}
      <ToolbarGroup
        label="Table Style Options"
        collapseConfig={TABLE_STYLE_OPTIONS_COLLAPSE_CONFIG}
        dropdownIcon={<TableIcon />}
      >
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          {/* Row options */}
          <div className="flex gap-2">
            <RibbonVisibilityItem item="headerRow">
              <Checkbox
                id="table-header-row"
                checked={hasHeaderRow}
                onChange={onToggleHeaderRow}
                label="Header Row"
                className="text-ribbon"
              />
            </RibbonVisibilityItem>
            <RibbonVisibilityItem item="totalRow">
              <Checkbox
                id="table-total-row"
                checked={hasTotalRow}
                onChange={onToggleTotalRow}
                label="Total Row"
                className="text-ribbon"
              />
            </RibbonVisibilityItem>
            <RibbonVisibilityItem item="bandedRows">
              <Checkbox
                id="table-banded-rows"
                checked={showBandedRows}
                onChange={onToggleBandedRows}
                label="Banded Rows"
                className="text-ribbon"
              />
            </RibbonVisibilityItem>
          </div>
          {/* Column options */}
          <div className="flex gap-2">
            <RibbonVisibilityItem item="firstColumn">
              <Checkbox
                checked={showFirstColumnHighlight}
                onChange={onToggleFirstColumnHighlight}
                label="First Column"
                className="text-ribbon"
              />
            </RibbonVisibilityItem>
            <RibbonVisibilityItem item="lastColumn">
              <Checkbox
                checked={showLastColumnHighlight}
                onChange={onToggleLastColumnHighlight}
                label="Last Column"
                className="text-ribbon"
              />
            </RibbonVisibilityItem>
            <RibbonVisibilityItem item="bandedColumns">
              <Checkbox
                checked={showBandedColumns}
                onChange={onToggleBandedColumns}
                label="Banded Columns"
                className="text-ribbon"
              />
            </RibbonVisibilityItem>
            {/* Filter Button Toggle */}
            <RibbonVisibilityItem item="filterButton">
              <Checkbox
                id="table-filter-button"
                checked={showFilterButtons}
                onChange={onToggleFilterButtons}
                label="Filter Button"
                className="text-ribbon"
              />
            </RibbonVisibilityItem>
          </div>
        </div>
      </ToolbarGroup>

      {/* Table Styles Group */}
      <ToolbarGroup
        label="Table Styles"
        collapseConfig={TABLE_STYLES_COLLAPSE_CONFIG}
        dropdownIcon={<TableIcon />}
      >
        <StyleGallery
          currentPreset={stylePreset}
          onSelectPreset={onSetStylePreset}
          isOpen={styleGalleryOpen}
          onOpenChange={setStyleGalleryOpen}
        />
      </ToolbarGroup>

      {/* Tools Group */}
      <ToolbarGroup
        label="Tools"
        isLast
        collapseConfig={TABLE_TOOLS_COLLAPSE_CONFIG}
        dropdownIcon={<ConvertToRangeIcon />}
      >
        <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
          <RibbonButton
            id="table-resize"
            layout="vertical"
            height="full"
            icon={<TableIcon />}
            label="Resize"
            onClick={() => {
              if (tableName) dispatch('OPEN_RESIZE_TABLE_DIALOG', { tableId: tableName });
            }}
            title="Resize Table"
            aria-label="Resize Table"
            disabled={!tableName}
          />
          <RibbonButton
            id="table-summarize-pivot"
            layout="vertical"
            height="full"
            icon={<PivotTableIcon />}
            label="PivotTable"
            onClick={() => {
              if (tableName) dispatch('OPEN_PIVOT_DIALOG', { tableId: tableName });
            }}
            title="Summarize with PivotTable"
            aria-label="Summarize with PivotTable"
            disabled={!tableName}
          />
          <RibbonButton
            id="table-remove-duplicates"
            layout="vertical"
            height="full"
            icon={<RemoveDuplicatesIcon />}
            label="Duplicates"
            onClick={() => {
              if (tableName) dispatch('OPEN_REMOVE_DUPLICATES_DIALOG', { tableId: tableName });
            }}
            title="Remove Duplicates"
            aria-label="Remove Duplicates"
            disabled={!tableName}
          />
          <RibbonButton
            id="table-insert-slicer"
            layout="vertical"
            height="full"
            icon={<SlicerIcon />}
            label="Slicer"
            onClick={() => {
              if (tableName) dispatch('OPEN_INSERT_SLICER_DIALOG', { tableId: tableName });
            }}
            title="Insert Slicer"
            aria-label="Insert Slicer"
            disabled={!tableName}
          />
          <RibbonButton
            id="table-convert-to-range"
            layout="vertical"
            height="full"
            icon={<ConvertToRangeIcon />}
            label="Convert to Range"
            onClick={onConvertToRange}
            title="Convert table to regular range (keeps data, removes table formatting)"
            aria-label="Convert to Range"
          />
          <RibbonButton
            id="table-delete"
            layout="vertical"
            height="full"
            icon={<DeleteTableIcon />}
            label="Delete"
            onClick={onDeleteTable}
            title="Delete table (removes table and data)"
            aria-label="Delete Table"
            visibilityKey="delete"
          />
        </div>
      </ToolbarGroup>
    </>
  );
}
