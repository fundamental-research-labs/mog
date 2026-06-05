/**
 * Pivot Table Context Menu Component
 *
 * Right-click context menu for pivot table operations.
 * Follows the established pattern from CellContextMenu.tsx.
 *
 * Features:
 * - Edit pivot (open field panel)
 * - Refresh pivot data
 * - Expand/Collapse operations
 * - Sort operations
 * - Summarize Values By (aggregate functions)
 * - Delete pivot
 * - Uses Radix ContextMenu (wraps pivot trigger area, positioned from native event)
 *
 * @module components/pivot/PivotContextMenu
 */

import { useCallback, useMemo, useState } from 'react';

import {
  CloseSvg,
  CollapseSvg,
  DeleteSvg,
  EditSvg,
  ExpandSvg,
  RefreshSvg,
  SortAscendingSvg,
  SortDescendingSvg,
  SumSvg,
  wrapIcon,
} from '@mog/icons';
import type { AggregateFunction } from '@mog-sdk/contracts/pivot';
import { quoteSheetName } from '@mog/spreadsheet-utils/a1';

import type { ContextMenuTarget } from '../context-menu/types';

import type { ShowValuesAsType } from '../../hooks/data/use-pivot-context-menu-actions';
import { usePivotContextMenuActions } from '../../hooks/data/use-pivot-context-menu-actions';
import { rangeToA1 } from '../../systems/shared/types';
import {
  Button,
  ContextMenuContent,
  ContextMenuItem as ContextMenuItemComponent,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
} from '@mog/shell/components/ui';
import { CollapsibleRangeInput } from '../ui/CollapsibleRangeInput';
import { MinimizableDialog } from '../ui/radix/MinimizableDialog';

// =============================================================================
// Types
// =============================================================================

export interface PivotContextMenuProps {
  /** Target type (pivot, pivot-row-header, etc.) */
  target: ContextMenuTarget;
  /** The pivot table ID */
  pivotId: string;
  /** Header key if clicking on a header */
  headerKey?: string;
  /** Field ID if clicking on a specific field */
  fieldId?: string;
  /** Called when menu should close */
  onClose: () => void;
}

// MenuItemProps removed - using Radix ContextMenuItemComponent instead

// =============================================================================
// Icon Components (wrapped from @mog/icons)
// =============================================================================

const EditIcon = wrapIcon(EditSvg, 'toolbar');
const RefreshIcon = wrapIcon(RefreshSvg, 'toolbar');
const DeleteIcon = wrapIcon(DeleteSvg, 'toolbar');
const ExpandIcon = wrapIcon(ExpandSvg, 'toolbar');
const CollapseIcon = wrapIcon(CollapseSvg, 'toolbar');
const SortAscIcon = wrapIcon(SortAscendingSvg, 'toolbar');
const SortDescIcon = wrapIcon(SortDescendingSvg, 'toolbar');
const SumIcon = wrapIcon(SumSvg, 'toolbar');
const RemoveIcon = wrapIcon(CloseSvg, 'toolbar');

// =============================================================================
// Aggregate Function Options
// =============================================================================

const AGGREGATE_FUNCTIONS: { type: AggregateFunction; label: string }[] = [
  { type: 'sum', label: 'Sum' },
  { type: 'count', label: 'Count' },
  { type: 'counta', label: 'Count (Non-Empty)' },
  { type: 'countunique', label: 'Count Unique' },
  { type: 'average', label: 'Average' },
  { type: 'min', label: 'Min' },
  { type: 'max', label: 'Max' },
  { type: 'product', label: 'Product' },
  { type: 'stdev', label: 'StdDev' },
  { type: 'stdevp', label: 'StdDevP' },
  { type: 'var', label: 'Var' },
  { type: 'varp', label: 'VarP' },
];

// =============================================================================
// Show Values As Options
// =============================================================================

const SHOW_VALUES_AS_OPTIONS: { type: ShowValuesAsType; label: string; disabled?: boolean }[] = [
  { type: 'noCalculation', label: 'No Calculation' },
  { type: 'percentOfGrandTotal', label: '% of Grand Total' },
  { type: 'percentOfColumnTotal', label: '% of Column Total' },
  { type: 'percentOfRowTotal', label: '% of Row Total' },
  { type: 'percentOfParentRowTotal', label: '% of Parent Row Total' },
  { type: 'percentOfParentColumnTotal', label: '% of Parent Column Total' },
  { type: 'difference', label: 'Difference From...', disabled: true },
  { type: 'percentDifference', label: '% Difference From...', disabled: true },
  { type: 'runningTotal', label: 'Running Total In...', disabled: true },
  { type: 'percentRunningTotal', label: '% Running Total In...', disabled: true },
  { type: 'rankAscending', label: 'Rank Smallest to Largest', disabled: true },
  { type: 'rankDescending', label: 'Rank Largest to Smallest', disabled: true },
  { type: 'index', label: 'Index' },
];

const GRAND_TOTAL_OPTIONS = [
  {
    key: 'rows-columns',
    label: 'On for Rows and Columns',
    showRowGrandTotals: true,
    showColumnGrandTotals: true,
  },
  {
    key: 'rows',
    label: 'On for Rows Only',
    showRowGrandTotals: true,
    showColumnGrandTotals: false,
  },
  {
    key: 'columns',
    label: 'On for Columns Only',
    showRowGrandTotals: false,
    showColumnGrandTotals: true,
  },
  {
    key: 'off',
    label: 'Off for Rows and Columns',
    showRowGrandTotals: false,
    showColumnGrandTotals: false,
  },
] as const;

type PivotFilterDrafts = Record<string, string[]>;

// MenuItem and MenuDivider removed - using Radix ContextMenuItemComponent/ContextMenuSeparator

// =============================================================================
// Component
// =============================================================================

function formatQualifiedDataSource(sheetName: string, range: string): string {
  return `${quoteSheetName(sheetName)}!${range}`;
}

function normalizeQualifiedDataSource(input: string, fallbackSheetName: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('!')) return trimmed;
  return formatQualifiedDataSource(fallbackSheetName, trimmed);
}

function pivotItemLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(blank)';
  return String(value);
}

function currentVisibleFilterValues(
  field: ReturnType<typeof usePivotContextMenuActions>['pivotFilterFields'][number],
): string[] {
  const allValues = field.items.map((item) => String(item.value ?? ''));
  const includeValues = field.currentFilter?.includeValues;
  if (includeValues) return includeValues.map((value) => String(value ?? ''));

  const excludeValues = new Set(
    (field.currentFilter?.excludeValues ?? []).map((value) => String(value ?? '')),
  );
  return allValues.filter((value) => !excludeValues.has(value));
}

function makeCalculatedFieldId(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || `CalculatedField_${Date.now()}`;
}

export function PivotContextMenu({
  target,
  pivotId,
  headerKey,
  fieldId,
  onClose,
}: PivotContextMenuProps) {
  // Get pivot actions
  const actions = usePivotContextMenuActions({
    pivotId,
    headerKey,
    fieldId,
  });
  const [isChangeSourceOpen, setIsChangeSourceOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [filterDrafts, setFilterDrafts] = useState<PivotFilterDrafts>({});
  const [isCalculatedFieldOpen, setIsCalculatedFieldOpen] = useState(false);
  const [calculatedFieldName, setCalculatedFieldName] = useState('');
  const [calculatedFieldFormula, setCalculatedFieldFormula] = useState('=');
  const [calculatedFieldError, setCalculatedFieldError] = useState<string | null>(null);
  const canEditFields = actions.pivotCapabilities?.canEditFields ?? false;
  const canRemoveFields = actions.pivotCapabilities?.canRemoveFields ?? false;
  const canChangeAggregate = actions.pivotCapabilities?.canChangeAggregate ?? false;
  const canRefresh = actions.pivotCapabilities?.canRefresh ?? false;
  const canDelete = actions.pivotCapabilities?.canDelete ?? false;

  const initialDataSource = useMemo(() => {
    const config = actions.pivotConfig;
    if (!config) return '';
    return formatQualifiedDataSource(config.sourceSheetName, rangeToA1(config.sourceRange));
  }, [actions.pivotConfig]);

  const openChangeDataSource = useCallback(() => {
    if (!canEditFields) return;
    setSourceDraft(initialDataSource);
    setSourceError(null);
    setIsChangeSourceOpen(true);
  }, [canEditFields, initialDataSource]);

  const closeChangeDataSource = useCallback(() => {
    setIsChangeSourceOpen(false);
    setSourceError(null);
  }, []);

  const applyChangeDataSource = useCallback(() => {
    const config = actions.pivotConfig;
    if (!config || !canEditFields) return;

    const dataSource = normalizeQualifiedDataSource(sourceDraft, config.sourceSheetName);
    if (!dataSource.includes('!')) {
      setSourceError('Enter a qualified source range such as Data!A1:B5');
      return;
    }

    actions.setDataSource(dataSource);
    setIsChangeSourceOpen(false);
  }, [actions, canEditFields, sourceDraft]);

  const toggleFilterValue = useCallback(
    (targetFieldId: string, value: string, checked: boolean, currentValues: string[]) => {
      setFilterDrafts((drafts) => {
        const selected = new Set(drafts[targetFieldId] ?? currentValues);
        if (checked) {
          selected.add(value);
        } else {
          selected.delete(value);
        }
        return { ...drafts, [targetFieldId]: Array.from(selected) };
      });
    },
    [],
  );

  const applyFilterDraft = useCallback(
    (targetFieldId: string) => {
      const field = actions.pivotFilterFields.find(
        (candidate) => candidate.fieldId === targetFieldId,
      );
      if (!field) return;
      const selected = filterDrafts[targetFieldId] ?? currentVisibleFilterValues(field);
      actions.setPivotFilter(targetFieldId, { includeValues: selected });
    },
    [actions, filterDrafts],
  );

  const openCalculatedField = useCallback(() => {
    if (!canEditFields) return;
    setCalculatedFieldName('');
    setCalculatedFieldFormula('=');
    setCalculatedFieldError(null);
    setIsCalculatedFieldOpen(true);
  }, [canEditFields]);

  const closeCalculatedField = useCallback(() => {
    setIsCalculatedFieldOpen(false);
    setCalculatedFieldError(null);
  }, []);

  const applyCalculatedField = useCallback(() => {
    const config = actions.pivotConfig;
    if (!config || !canEditFields) return;

    const name = calculatedFieldName.trim();
    const formula = calculatedFieldFormula.trim();
    if (!name) {
      setCalculatedFieldError('Enter a field name.');
      return;
    }
    if (!formula || formula === '=') {
      setCalculatedFieldError('Enter a formula.');
      return;
    }

    actions.addCalculatedField({
      fieldId: makeCalculatedFieldId(name),
      name,
      formula,
    });
    setIsCalculatedFieldOpen(false);
  }, [
    actions,
    calculatedFieldFormula,
    calculatedFieldName,
    canEditFields,
  ]);

  const isHeaderTarget = target === 'pivot-row-header' || target === 'pivot-column-header';
  const isValueTarget = target === 'pivot-value';

  return (
    <>
      <ContextMenuContent
        className="py-1 min-w-[200px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Edit Pivot */}
        <ContextMenuItemComponent icon={<EditIcon />} onSelect={actions.editPivot}>
          Edit Pivot Table...
        </ContextMenuItemComponent>

        {/* Refresh */}
        <ContextMenuItemComponent
          icon={<RefreshIcon />}
          onSelect={actions.refreshPivot}
          disabled={!canRefresh}
        >
          Refresh
        </ContextMenuItemComponent>

        <ContextMenuItemComponent
          onSelect={(event) => {
            event.preventDefault();
            openChangeDataSource();
          }}
          disabled={!canEditFields}
        >
          Change Data Source...
        </ContextMenuItemComponent>

        <ContextMenuItemComponent
          onSelect={(event) => {
            event.preventDefault();
            openCalculatedField();
          }}
          disabled={!canEditFields}
        >
          Calculated Field...
        </ContextMenuItemComponent>

        <ContextMenuSeparator />

        {/* Expand/Collapse - Only show on header targets or when we have header context */}
        {(isHeaderTarget || actions.hasHeaderContext) && (
          <>
            <ContextMenuItemComponent
              icon={actions.isHeaderExpanded ? <CollapseIcon /> : <ExpandIcon />}
              onSelect={actions.isHeaderExpanded ? actions.collapseHeader : actions.expandHeader}
              disabled={!canEditFields}
            >
              {actions.isHeaderExpanded ? 'Collapse' : 'Expand'}
            </ContextMenuItemComponent>

            <ContextMenuSeparator />
          </>
        )}

        {/* Expand All / Collapse All */}
        <ContextMenuItemComponent
          icon={<ExpandIcon />}
          onSelect={actions.expandAll}
          disabled={!canEditFields}
        >
          Expand All
        </ContextMenuItemComponent>

        <ContextMenuItemComponent
          icon={<CollapseIcon />}
          onSelect={actions.collapseAll}
          disabled={!canEditFields}
        >
          Collapse All
        </ContextMenuItemComponent>

        {/* Sort - Only show on header targets */}
        {(isHeaderTarget || actions.hasFieldContext) && (
          <>
            <ContextMenuSeparator />

            <ContextMenuItemComponent
              icon={<SortAscIcon />}
              onSelect={actions.sortAscending}
              disabled={!canEditFields}
            >
              Sort A to Z
            </ContextMenuItemComponent>

            <ContextMenuItemComponent
              icon={<SortDescIcon />}
              onSelect={actions.sortDescending}
              disabled={!canEditFields}
            >
              Sort Z to A
            </ContextMenuItemComponent>
          </>
        )}

        {/* Summarize Values By - Only show on value targets */}
        {(isValueTarget || actions.currentAggregateFunction !== undefined) && (
          <>
            <ContextMenuSeparator />

            <ContextMenuSub>
              <ContextMenuSubTrigger icon={<SumIcon />} disabled={!canChangeAggregate}>
                Summarize Values By
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {AGGREGATE_FUNCTIONS.map((agg) => (
                  <ContextMenuItemComponent
                    key={agg.type}
                    onSelect={() => actions.setAggregateFunction(agg.type)}
                    disabled={!canChangeAggregate}
                    className={
                      actions.currentAggregateFunction === agg.type
                        ? 'bg-ss-primary-light text-ss-primary'
                        : ''
                    }
                  >
                    {agg.label}
                  </ContextMenuItemComponent>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            {/* Show Values As Submenu */}
            <ContextMenuSub>
              <ContextMenuSubTrigger
                disabled={!canChangeAggregate}
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z" />
                  </svg>
                }
              >
                Show Values As
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-[300px] overflow-y-auto">
                {SHOW_VALUES_AS_OPTIONS.map((opt) => (
                  <ContextMenuItemComponent
                    key={opt.type}
                    onSelect={() => actions.setShowValuesAs(opt.type)}
                    disabled={opt.disabled || !canChangeAggregate}
                    className={
                      (actions.currentShowValuesAs ?? 'noCalculation') === opt.type
                        ? 'bg-ss-primary-light text-ss-primary'
                        : ''
                    }
                  >
                    {opt.label}
                  </ContextMenuItemComponent>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!canEditFields}>Grand Totals</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {GRAND_TOTAL_OPTIONS.map((opt) => {
              const selected =
                actions.showRowGrandTotals === opt.showRowGrandTotals &&
                actions.showColumnGrandTotals === opt.showColumnGrandTotals;
              return (
                <ContextMenuItemComponent
                  key={opt.key}
                  onSelect={() =>
                    actions.setGrandTotals({
                      showRowGrandTotals: opt.showRowGrandTotals,
                      showColumnGrandTotals: opt.showColumnGrandTotals,
                    })
                  }
                  disabled={!canEditFields}
                  className={selected ? 'bg-ss-primary-light text-ss-primary' : ''}
                >
                  {opt.label}
                </ContextMenuItemComponent>
              );
            })}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {actions.pivotFilterFields.length > 0 && (
          <>
            <ContextMenuSeparator />

            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={!canEditFields}>Filter</ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-[360px] overflow-y-auto min-w-[220px]">
                {actions.pivotFilterFields.map((filterField) => {
                  const currentValues = currentVisibleFilterValues(filterField);
                  const selected = new Set(filterDrafts[filterField.fieldId] ?? currentValues);
                  return (
                    <ContextMenuSub key={filterField.fieldId}>
                      <ContextMenuSubTrigger disabled={!canEditFields}>
                        {filterField.fieldName}
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent className="max-h-[320px] overflow-y-auto min-w-[220px]">
                        <div
                          className="px-2 py-1"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          {filterField.items.map((item) => {
                            const value = String(item.value ?? '');
                            const label = pivotItemLabel(item.value);
                            return (
                              <label
                                key={`${filterField.fieldId}-${value}`}
                                className="flex items-center gap-2 px-2 py-1 text-body-sm text-ss-text cursor-pointer rounded hover:bg-ss-surface-hover"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5"
                                  aria-label={`Pivot filter ${filterField.fieldName}: ${label}`}
                                  checked={selected.has(value)}
                                  disabled={!canEditFields}
                                  onChange={(event) =>
                                    toggleFilterValue(
                                      filterField.fieldId,
                                      value,
                                      event.currentTarget.checked,
                                      currentValues,
                                    )
                                  }
                                />
                                <span>{label}</span>
                              </label>
                            );
                          })}
                        </div>
                        <ContextMenuSeparator />
                        <ContextMenuItemComponent
                          onSelect={() => applyFilterDraft(filterField.fieldId)}
                          disabled={!canEditFields}
                        >
                          Apply Filter
                        </ContextMenuItemComponent>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  );
                })}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}

        {/* Remove Field - Only show when field context exists */}
        {actions.hasFieldContext && (
          <>
            <ContextMenuSeparator />

            <ContextMenuItemComponent
              icon={<RemoveIcon />}
              onSelect={actions.removeField}
              disabled={!canRemoveFields}
            >
              Remove Field
            </ContextMenuItemComponent>
          </>
        )}

        <ContextMenuSeparator />

        {/* Delete Pivot */}
        <ContextMenuItemComponent
          icon={<DeleteIcon />}
          onSelect={actions.deletePivot}
          disabled={!canDelete}
          destructive
        >
          Delete Pivot Table
        </ContextMenuItemComponent>
      </ContextMenuContent>

      <MinimizableDialog
        open={isChangeSourceOpen}
        onClose={closeChangeDataSource}
        dialogId="pivot-change-data-source-dialog"
        title="Change Pivot Data Source"
        width={480}
      >
        <DialogHeader onClose={closeChangeDataSource}>Change Pivot Data Source</DialogHeader>
        <DialogBody className="p-6">
          <div className="space-y-2">
            <CollapsibleRangeInput
              value={sourceDraft}
              onChange={(value) => {
                setSourceDraft(value);
                setSourceError(null);
              }}
              dialogId="pivot-change-data-source-dialog"
              inputId="source-range"
              label="Source data range"
              placeholder="Data!A1:B5"
              error={!!sourceError}
            />
            {sourceError && <div className="text-body text-ss-error">{sourceError}</div>}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={closeChangeDataSource}>
            Cancel
          </Button>
          <Button variant="primary" onClick={applyChangeDataSource} disabled={!sourceDraft.trim()}>
            Apply
          </Button>
        </DialogFooter>
      </MinimizableDialog>

      <MinimizableDialog
        open={isCalculatedFieldOpen}
        onClose={closeCalculatedField}
        dialogId="pivot-calculated-field-dialog"
        title="Calculated Field"
        width={480}
      >
        <DialogHeader onClose={closeCalculatedField}>Calculated Field</DialogHeader>
        <DialogBody className="p-6">
          <div className="space-y-4">
            <FormField
              label="Name"
              error={calculatedFieldError ?? undefined}
              htmlFor="pivot-calculated-field-name"
            >
              <Input
                id="pivot-calculated-field-name"
                value={calculatedFieldName}
                onChange={(e) => {
                  setCalculatedFieldName(e.target.value);
                  setCalculatedFieldError(null);
                }}
                placeholder="Profit"
                autoFocus
              />
            </FormField>
            <FormField label="Formula" htmlFor="pivot-calculated-field-formula">
              <Input
                id="pivot-calculated-field-formula"
                value={calculatedFieldFormula}
                onChange={(e) => {
                  setCalculatedFieldFormula(e.target.value);
                  setCalculatedFieldError(null);
                }}
                placeholder="=Revenue - Cost"
                className="font-ss-mono"
              />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={closeCalculatedField}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={applyCalculatedField}
            disabled={!calculatedFieldName.trim() || !calculatedFieldFormula.trim()}
          >
            Add
          </Button>
        </DialogFooter>
      </MinimizableDialog>
    </>
  );
}
