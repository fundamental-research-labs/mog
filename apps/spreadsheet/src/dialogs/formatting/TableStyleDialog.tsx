/**
 * Table Style Dialog
 *
 * A dialog for creating, modifying, and duplicating custom table styles.
 * Follows Excel's "New Table Style" dialog pattern with tabs for each element.
 *
 * Tabs:
 * - Name: Style name input
 * - Whole Table: Default table styling
 * - Header Row: Header row formatting
 * - Total Row: Total row formatting
 * - First Column: First column highlighting
 * - Last Column: Last column highlighting
 * - Row Stripes: Banded row pattern
 * - Column Stripes: Banded column pattern
 *
 *
 * Architecture Compliance:
 * - All user interactions use dispatch()
 * - UIStore slice for dialog state
 * - Draft pattern: changes staged in UIStore, applied via dispatch on OK
 */

import { useCallback, useEffect, useRef } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input, Label } from '@mog/shell';
import type {
  CustomTableStyleDefinition,
  StripePattern,
  TableElementStyle,
  TableStyleDialogTab,
} from '../../ui-store/slices';

// =============================================================================
// Constants
// =============================================================================

const TAB_LABELS: Record<TableStyleDialogTab, string> = {
  name: 'Name',
  wholeTable: 'Whole Table',
  headerRow: 'Header Row',
  totalRow: 'Total Row',
  firstColumn: 'First Column',
  lastColumn: 'Last Column',
  rowStripes: 'Row Stripes',
  columnStripes: 'Column Stripes',
};

const TABS: TableStyleDialogTab[] = [
  'name',
  'wholeTable',
  'headerRow',
  'totalRow',
  'firstColumn',
  'lastColumn',
  'rowStripes',
  'columnStripes',
];

// =============================================================================
// Sub-components for Tabs
// =============================================================================

interface NameTabProps {
  name: string;
  onChange: (name: string) => void;
  mode: 'create' | 'modify' | 'duplicate';
}

function NameTab({ name, onChange, mode }: NameTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input when tab becomes active
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const modeLabel =
    mode === 'create'
      ? 'New Table Style'
      : mode === 'modify'
        ? 'Modify Table Style'
        : 'Duplicate Table Style';

  return (
    <div className="space-y-4">
      <div className="text-body-sm text-ss-text-secondary">{modeLabel}</div>
      <div className="flex items-center gap-3">
        <Label htmlFor="style-name-input" className="mb-0 whitespace-nowrap min-w-[80px]">
          Name:
        </Label>
        <Input
          ref={inputRef}
          id="style-name-input"
          type="text"
          value={name}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
          placeholder="Enter style name"
        />
      </div>
      <div className="text-caption text-ss-text-secondary">
        Enter a unique name for this table style. The name will appear in the Table Styles gallery.
      </div>
    </div>
  );
}

interface ElementStyleTabProps {
  label: string;
  style: TableElementStyle;
  onChange: (style: Partial<TableElementStyle>) => void;
}

function ElementStyleTab({ label, style, onChange }: ElementStyleTabProps) {
  return (
    <div className="space-y-4">
      <div className="text-body-sm font-medium">{label} Formatting</div>

      {/* Fill Color */}
      <div className="flex items-center gap-3">
        <Label htmlFor={`${label}-fill`} className="mb-0 whitespace-nowrap min-w-[100px]">
          Fill Color:
        </Label>
        <Input
          id={`${label}-fill`}
          type="color"
          value={style.fill || '#ffffff'}
          onChange={(e) => onChange({ fill: e.target.value })}
          className="w-12 h-8 p-0 border rounded"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ fill: undefined })}
          className="text-caption"
        >
          Clear
        </Button>
      </div>

      {/* Border options would go here - simplified for initial implementation */}
      <div className="text-caption text-ss-text-secondary mt-4">
        Additional formatting options (borders, font) can be configured in the Format Cells dialog
        after applying the style.
      </div>
    </div>
  );
}

interface StripePatternTabProps {
  label: string;
  pattern: StripePattern;
  onChange: (pattern: Partial<StripePattern>) => void;
}

function StripePatternTab({ label, pattern, onChange }: StripePatternTabProps) {
  return (
    <div className="space-y-4">
      <div className="text-body-sm font-medium">{label} Pattern</div>

      {/* Stripe Size */}
      <div className="flex items-center gap-3">
        <Label htmlFor={`${label}-size`} className="mb-0 whitespace-nowrap min-w-[100px]">
          Stripe Size:
        </Label>
        <select
          id={`${label}-size`}
          value={pattern.stripeSize}
          onChange={(e) => onChange({ stripeSize: parseInt(e.target.value) })}
          className="border rounded px-2 py-1"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n} {label === 'Row Stripes' ? 'row' : 'column'}
              {n > 1 ? 's' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Stripe 1 Color */}
      <div className="flex items-center gap-3">
        <Label htmlFor={`${label}-stripe1`} className="mb-0 whitespace-nowrap min-w-[100px]">
          Stripe 1:
        </Label>
        <Input
          id={`${label}-stripe1`}
          type="color"
          value={pattern.stripe1Fill || '#ffffff'}
          onChange={(e) => onChange({ stripe1Fill: e.target.value })}
          className="w-12 h-8 p-0 border rounded"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ stripe1Fill: undefined })}
          className="text-caption"
        >
          Clear
        </Button>
      </div>

      {/* Stripe 2 Color */}
      <div className="flex items-center gap-3">
        <Label htmlFor={`${label}-stripe2`} className="mb-0 whitespace-nowrap min-w-[100px]">
          Stripe 2:
        </Label>
        <Input
          id={`${label}-stripe2`}
          type="color"
          value={pattern.stripe2Fill || '#f0f0f0'}
          onChange={(e) => onChange({ stripe2Fill: e.target.value })}
          className="w-12 h-8 p-0 border rounded"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ stripe2Fill: undefined })}
          className="text-caption"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Preview Component
// =============================================================================

interface StylePreviewProps {
  style: CustomTableStyleDefinition | null;
  enabled: boolean;
}

function StylePreview({ style, enabled }: StylePreviewProps) {
  if (!enabled || !style) {
    return (
      <div className="border rounded p-4 bg-ss-surface-secondary text-center text-caption text-ss-text-secondary">
        Preview disabled
      </div>
    );
  }

  // Simple preview grid showing the style applied
  return (
    <div className="border rounded overflow-hidden">
      <div className="text-caption text-ss-text-secondary px-2 py-1 bg-ss-surface-secondary">
        Preview
      </div>
      <table className="w-full text-body-sm">
        <thead>
          <tr>
            <th
              className="border px-2 py-1 text-left"
              style={{ backgroundColor: style.headerRow.fill || '#4472C4', color: 'white' }}
            >
              Column 1
            </th>
            <th
              className="border px-2 py-1 text-left"
              style={{ backgroundColor: style.headerRow.fill || '#4472C4', color: 'white' }}
            >
              Column 2
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td
              className="border px-2 py-1"
              style={{ backgroundColor: style.rowStripes.stripe1Fill || 'white' }}
            >
              Data 1
            </td>
            <td
              className="border px-2 py-1"
              style={{ backgroundColor: style.rowStripes.stripe1Fill || 'white' }}
            >
              Data 2
            </td>
          </tr>
          <tr>
            <td
              className="border px-2 py-1"
              style={{ backgroundColor: style.rowStripes.stripe2Fill || '#D9E2F3' }}
            >
              Data 3
            </td>
            <td
              className="border px-2 py-1"
              style={{ backgroundColor: style.rowStripes.stripe2Fill || '#D9E2F3' }}
            >
              Data 4
            </td>
          </tr>
          <tr>
            <td
              className="border px-2 py-1"
              style={{
                backgroundColor: style.totalRow.fill || '#4472C4',
                color: style.totalRow.fill ? 'white' : undefined,
              }}
            >
              Total
            </td>
            <td
              className="border px-2 py-1"
              style={{
                backgroundColor: style.totalRow.fill || '#4472C4',
                color: style.totalRow.fill ? 'white' : undefined,
              }}
            >
              100
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function TableStyleDialog() {
  const deps = useActionDependencies();

  // UIStore state
  const dialogState = useUIStore((s) => s.customTableStyleDialog);
  const setActiveTab = useUIStore((s) => s.setTableStyleDialogTab);
  const updateEditingStyle = useUIStore((s) => s.updateEditingStyle);
  const updateHeaderRowStyle = useUIStore((s) => s.updateHeaderRowStyle);
  const updateTotalRowStyle = useUIStore((s) => s.updateTotalRowStyle);
  const updateFirstColumnStyle = useUIStore((s) => s.updateFirstColumnStyle);
  const updateLastColumnStyle = useUIStore((s) => s.updateLastColumnStyle);
  const updateRowStripes = useUIStore((s) => s.updateRowStripes);
  const updateColumnStripes = useUIStore((s) => s.updateColumnStripes);
  const updateWholeTableStyle = useUIStore((s) => s.updateWholeTableStyle);
  const togglePreview = useUIStore((s) => s.toggleTableStylePreview);

  const { isOpen, mode, activeTab, editingStyle, originalStyleId, previewEnabled } = dialogState;

  // Handle tab change
  const handleTabChange = useCallback(
    (tabId: string) => {
      setActiveTab(tabId as TableStyleDialogTab);
    },
    [setActiveTab],
  );

  // Handle OK button
  const handleOk = useCallback(() => {
    if (!editingStyle?.name?.trim()) {
      return; // Name is required
    }

    if (mode === 'create' || mode === 'duplicate') {
      dispatch('CREATE_CUSTOM_TABLE_STYLE', deps, {
        name: editingStyle.name,
        style: {
          headerRow: editingStyle.headerRow,
          totalRow: editingStyle.totalRow,
          firstColumn: editingStyle.firstColumn,
          lastColumn: editingStyle.lastColumn,
          rowStripes: editingStyle.rowStripes,
          columnStripes: editingStyle.columnStripes,
          wholeTable: editingStyle.wholeTable,
        },
      });
    } else if (mode === 'modify' && originalStyleId) {
      dispatch('MODIFY_TABLE_STYLE', deps, {
        styleId: originalStyleId,
        updates: {
          name: editingStyle.name,
          headerRow: editingStyle.headerRow,
          totalRow: editingStyle.totalRow,
          firstColumn: editingStyle.firstColumn,
          lastColumn: editingStyle.lastColumn,
          rowStripes: editingStyle.rowStripes,
          columnStripes: editingStyle.columnStripes,
          wholeTable: editingStyle.wholeTable,
        },
      });
    }
  }, [mode, editingStyle, originalStyleId, deps]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_CUSTOM_TABLE_STYLE_DIALOG', deps);
  }, [deps]);

  // Validation
  const isValid = editingStyle?.name?.trim() !== '';

  if (!isOpen) return null;

  const dialogTitle =
    mode === 'create'
      ? 'New Table Style'
      : mode === 'modify'
        ? 'Modify Table Style'
        : 'Duplicate Table Style';

  return (
    <Dialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleCancel}
      dialogId="table-style-dialog"
      width={600}
    >
      <DialogHeader onClose={handleCancel}>{dialogTitle}</DialogHeader>

      <DialogBody>
        <div className="flex gap-4">
          {/* Main content area with tabs */}
          <div className="flex-1">
            {/* Tab list */}
            <div className="flex flex-wrap gap-1 mb-4 border-b pb-2">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => handleTabChange(tab)}
                  className={`px-3 py-1 text-body-sm rounded-t ${
                    activeTab === tab
                      ? 'bg-ss-surface-primary border border-b-0 font-medium'
                      : 'text-ss-text-secondary hover:bg-ss-surface-hover'
                  }`}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>

            {/* Tab panels - show/hide based on activeTab */}
            <div className="min-h-[150px]">
              {activeTab === 'name' && (
                <NameTab
                  name={editingStyle?.name || ''}
                  onChange={(name) => updateEditingStyle({ name })}
                  mode={mode}
                />
              )}

              {activeTab === 'wholeTable' && (
                <ElementStyleTab
                  label="Whole Table"
                  style={editingStyle?.wholeTable || {}}
                  onChange={updateWholeTableStyle}
                />
              )}

              {activeTab === 'headerRow' && (
                <ElementStyleTab
                  label="Header Row"
                  style={editingStyle?.headerRow || {}}
                  onChange={updateHeaderRowStyle}
                />
              )}

              {activeTab === 'totalRow' && (
                <ElementStyleTab
                  label="Total Row"
                  style={editingStyle?.totalRow || {}}
                  onChange={updateTotalRowStyle}
                />
              )}

              {activeTab === 'firstColumn' && (
                <ElementStyleTab
                  label="First Column"
                  style={editingStyle?.firstColumn || {}}
                  onChange={updateFirstColumnStyle}
                />
              )}

              {activeTab === 'lastColumn' && (
                <ElementStyleTab
                  label="Last Column"
                  style={editingStyle?.lastColumn || {}}
                  onChange={updateLastColumnStyle}
                />
              )}

              {activeTab === 'rowStripes' && (
                <StripePatternTab
                  label="Row Stripes"
                  pattern={editingStyle?.rowStripes || { stripeSize: 1 }}
                  onChange={updateRowStripes}
                />
              )}

              {activeTab === 'columnStripes' && (
                <StripePatternTab
                  label="Column Stripes"
                  pattern={editingStyle?.columnStripes || { stripeSize: 1 }}
                  onChange={updateColumnStripes}
                />
              )}
            </div>
          </div>

          {/* Preview panel */}
          <div className="w-48">
            <div className="flex items-center justify-between mb-2">
              <span className="text-caption">Preview</span>
              <button
                onClick={togglePreview}
                className="text-caption text-ss-text-secondary hover:text-text-ss-primary"
              >
                {previewEnabled ? 'Hide' : 'Show'}
              </button>
            </div>
            <StylePreview style={editingStyle} enabled={previewEnabled} />
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk} disabled={!isValid}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
