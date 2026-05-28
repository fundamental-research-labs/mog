/**
 * Conditional Format Dialog
 *
 * UI for creating and editing conditional formatting rules.
 * Supports all rule types: cellValue, colorScale, dataBar, iconSet, etc.
 */

import { useEffect, useState } from 'react';
import {
  useActiveCell,
  useActiveSheetId,
  useCFDialog,
  useSelectionRanges,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import {
  Button,
  ColorInput,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Select,
} from '@mog/shell';
import type {
  CellRange,
  CFCellValueRule,
  CFColorScaleRule,
  CFCustomIcon,
  CFDataBarRule,
  CFFormulaRule,
  CFIconSet,
  CFIconSetRule,
  CFIconThreshold,
  CFOperator,
  CFRule,
  CFRuleInput,
  CFRuleType,
  CFValueType,
} from '@mog-sdk/contracts/api';
import {
  ColorScaleOptions,
  DataBarOptions,
  getDefaultColorScaleState,
  getDefaultDataBarState,
  getDefaultIconSetState,
  IconSetOptions,
  type ColorScaleFormState,
  type DataBarFormState,
  type IconSetFormState,
} from './cf-options';

// =============================================================================
// Rule Type Labels
// =============================================================================

const RULE_TYPE_OPTIONS = [
  { value: 'cellValue', label: 'Cell Value' },
  { value: 'formula', label: 'Formula' },
  { value: 'colorScale', label: 'Color Scale' },
  { value: 'dataBar', label: 'Data Bar' },
  { value: 'iconSet', label: 'Icon Set' },
  { value: 'top10', label: 'Top/Bottom Rules' },
  { value: 'aboveAverage', label: 'Above/Below Average' },
  { value: 'duplicateValues', label: 'Duplicate Values' },
  { value: 'containsText', label: 'Text Contains' },
  { value: 'containsBlanks', label: 'Blank Cells' },
  { value: 'containsErrors', label: 'Error Cells' },
];

const OPERATOR_OPTIONS = [
  { value: 'greaterThan', label: 'Greater than' },
  { value: 'lessThan', label: 'Less than' },
  { value: 'greaterThanOrEqual', label: 'Greater than or equal to' },
  { value: 'lessThanOrEqual', label: 'Less than or equal to' },
  { value: 'equal', label: 'Equal to' },
  { value: 'notEqual', label: 'Not equal to' },
  { value: 'between', label: 'Between' },
  { value: 'notBetween', label: 'Not between' },
];

// =============================================================================
// Helper Functions
// =============================================================================

function rangeToString(range: CellRange): string {
  const startCol = String.fromCharCode(65 + range.startCol);
  const endCol = String.fromCharCode(65 + range.endCol);
  return `${startCol}${range.startRow + 1}:${endCol}${range.endRow + 1}`;
}

function toIconThreshold(threshold: IconSetFormState['thresholds'][number]): CFIconThreshold {
  const iconThreshold: CFIconThreshold = {
    type: threshold.type,
    value: threshold.value,
    gte: threshold.gte,
  };

  const customIcon = threshold.customIcon;
  if (
    customIcon &&
    !customIcon.hideIcon &&
    customIcon.customSetName &&
    customIcon.customIconIndex !== undefined
  ) {
    iconThreshold.customIcon = {
      iconSet: customIcon.customSetName,
      iconIndex: customIcon.customIconIndex,
    };
  }

  return iconThreshold;
}

function buildIconSet(iconSetState: IconSetFormState): CFIconSet {
  const iconSet: CFIconSet = {
    iconSetName: iconSetState.iconSetName,
    reverseOrder: iconSetState.reverseOrder,
    showIconOnly: iconSetState.showIconOnly,
  };

  if (iconSetState.useCustomThresholds) {
    iconSet.thresholds = iconSetState.thresholds.map(toIconThreshold);
  }

  return iconSet;
}

function toIconSetFormThreshold(
  threshold: CFIconThreshold,
  customIcon: CFCustomIcon | null | undefined,
): IconSetFormState['thresholds'][number] {
  const parsedValue =
    typeof threshold.value === 'number'
      ? threshold.value
      : parseFloat(String(threshold.value)) || 0;
  const formThreshold: IconSetFormState['thresholds'][number] = {
    type: threshold.type,
    value: parsedValue,
    gte: threshold.gte,
  };

  if (threshold.customIcon) {
    formThreshold.customIcon = {
      customSetName: threshold.customIcon.iconSet,
      customIconIndex: threshold.customIcon.iconIndex,
    };
  } else if (customIcon) {
    formThreshold.customIcon = {
      customSetName: customIcon.iconSet,
      customIconIndex: customIcon.iconId,
    };
  }

  return formThreshold;
}

// =============================================================================
// Component
// =============================================================================

export function ConditionalFormatDialog() {
  const cfDialog = useCFDialog();
  // PERFORMANCE: Use granular hooks - only subscribe to what we need
  const { activeCell } = useActiveCell();
  const ranges = useSelectionRanges();
  const activeSheetId = useActiveSheetId();
  const closeCFDialog = useUIStore((s) => s.closeCFDialog);
  const setCFRuleType = useUIStore((s) => s.setCFRuleType);

  // Access the Workbook API for conditional format operations
  const wb = useWorkbook();

  // Local state for form values
  const [operator, setOperator] = useState<CFOperator>('greaterThan');
  const [value1, setValue1] = useState('0');
  const [value2, setValue2] = useState('100');
  const [backgroundColor, setBackgroundColor] = useState('#ffcccc');
  const [fontColor, setFontColor] = useState('#000000');

  // Formula rule state
  const [formula, setFormula] = useState('=$A1>100');

  // Enhanced state for visual CF types
  const [colorScaleState, setColorScaleState] =
    useState<ColorScaleFormState>(getDefaultColorScaleState);
  const [dataBarState, setDataBarState] = useState<DataBarFormState>(getDefaultDataBarState);
  const [iconSetState, setIconSetState] = useState<IconSetFormState>(getDefaultIconSetState);

  // Initialize form state from editingFormat when in edit mode
  useEffect(() => {
    if (cfDialog.mode === 'edit' && cfDialog.editingFormat) {
      const format = cfDialog.editingFormat;
      const rule = format.rules[0]; // Edit the first rule

      if (!rule) return;

      // Set the rule type
      setCFRuleType(rule.type);

      switch (rule.type) {
        case 'cellValue': {
          const r = rule as CFCellValueRule;
          setOperator(r.operator);
          setValue1(String(r.value1 ?? '0'));
          setValue2(String(r.value2 ?? '100'));
          setBackgroundColor(r.style?.backgroundColor ?? '#ffcccc');
          setFontColor(r.style?.fontColor ?? '#000000');
          break;
        }
        case 'colorScale': {
          const r = rule as CFColorScaleRule;
          setColorScaleState({
            use3Color: !!r.colorScale.midPoint,
            minType: r.colorScale.minPoint.type as CFValueType,
            minValue: r.colorScale.minPoint.value as number | undefined,
            minColor: r.colorScale.minPoint.color,
            midType: r.colorScale.midPoint?.type as CFValueType | undefined,
            midValue: r.colorScale.midPoint?.value as number | undefined,
            midColor: r.colorScale.midPoint?.color,
            maxType: r.colorScale.maxPoint.type as CFValueType,
            maxValue: r.colorScale.maxPoint.value as number | undefined,
            maxColor: r.colorScale.maxPoint.color,
          });
          break;
        }
        case 'dataBar': {
          const r = rule as CFDataBarRule;
          setDataBarState({
            minType: r.dataBar.minPoint.type as CFValueType,
            minValue: r.dataBar.minPoint.value as number | undefined,
            maxType: r.dataBar.maxPoint.type as CFValueType,
            maxValue: r.dataBar.maxPoint.value as number | undefined,
            positiveColor: r.dataBar.positiveColor,
            negativeColor: r.dataBar.negativeColor ?? '#FF0000',
            borderColor: r.dataBar.borderColor ?? '#000000',
            negativeBorderColor: r.dataBar.negativeBorderColor ?? '#FF0000',
            showBorder: r.dataBar.showBorder ?? false,
            gradient: r.dataBar.gradient ?? true,
            axisPosition: r.dataBar.axisPosition ?? 'automatic',
            axisColor: r.dataBar.axisColor ?? '#000000',
            showValue: r.dataBar.showValue ?? true,
          });
          break;
        }
        case 'iconSet': {
          const r = rule as CFIconSetRule;
          const formThresholds = (r.iconSet.thresholds ?? []).map((t, index) =>
            toIconSetFormThreshold(t, r.iconSet.customIcons?.[index]),
          );
          setIconSetState({
            iconSetName: r.iconSet.iconSetName,
            reverseOrder: r.iconSet.reverseOrder ?? false,
            showIconOnly: r.iconSet.showIconOnly ?? false,
            useCustomThresholds: !!r.iconSet.thresholds,
            thresholds: formThresholds,
          });
          break;
        }
        // Handle formula rule type in edit mode
        case 'formula': {
          const r = rule as CFFormulaRule;
          setFormula(r.formula ?? '');
          setBackgroundColor(r.style?.backgroundColor ?? '#ffcccc');
          setFontColor(r.style?.fontColor ?? '#000000');
          break;
        }
        // For other types, use defaults (can be extended later)
      }
    }
  }, [cfDialog.mode, cfDialog.editingFormat, setCFRuleType]);

  // Don't render if dialog is closed
  if (!cfDialog.isOpen) return null;

  // Get the range - use editing format's ranges in edit mode, otherwise current selection
  const editingRanges = cfDialog.editingFormat?.ranges;
  const selectedRange: CellRange =
    cfDialog.mode === 'edit' && editingRanges && editingRanges.length > 0
      ? editingRanges[0]
      : {
          startRow: ranges[0]?.startRow ?? activeCell.row,
          startCol: ranges[0]?.startCol ?? activeCell.col,
          endRow: ranges[0]?.endRow ?? activeCell.row,
          endCol: ranges[0]?.endCol ?? activeCell.col,
        };

  const rangeString =
    cfDialog.mode === 'edit' && editingRanges && editingRanges.length > 0
      ? editingRanges.map(rangeToString).join(', ')
      : rangeToString(selectedRange);

  // Handle apply
  const handleApply = async () => {
    const targetSheetId =
      cfDialog.mode === 'edit' ? (cfDialog.sourceSheetId ?? activeSheetId) : activeSheetId;
    const ws = wb.getSheetById(targetSheetId);

    let ruleInput: CFRuleInput;

    switch (cfDialog.selectedRuleType) {
      case 'cellValue':
        ruleInput = {
          type: 'cellValue',
          operator,
          value1: parseFloat(value1) || value1,
          value2:
            operator === 'between' || operator === 'notBetween'
              ? parseFloat(value2) || value2
              : undefined,
          style: {
            backgroundColor,
            fontColor,
          },
        } as Omit<CFCellValueRule, 'id' | 'priority'>;
        break;

      case 'colorScale':
        ruleInput = {
          type: 'colorScale',
          colorScale: colorScaleState.use3Color
            ? {
                minPoint: {
                  type: colorScaleState.minType,
                  value: colorScaleState.minValue,
                  color: colorScaleState.minColor,
                },
                midPoint: {
                  type: colorScaleState.midType || 'percent',
                  value: colorScaleState.midValue ?? 50,
                  color: colorScaleState.midColor || '#FFEB84',
                },
                maxPoint: {
                  type: colorScaleState.maxType,
                  value: colorScaleState.maxValue,
                  color: colorScaleState.maxColor,
                },
              }
            : {
                minPoint: {
                  type: colorScaleState.minType,
                  value: colorScaleState.minValue,
                  color: colorScaleState.minColor,
                },
                maxPoint: {
                  type: colorScaleState.maxType,
                  value: colorScaleState.maxValue,
                  color: colorScaleState.maxColor,
                },
              },
        } as Omit<CFColorScaleRule, 'id' | 'priority'>;
        break;

      case 'dataBar':
        ruleInput = {
          type: 'dataBar',
          dataBar: {
            minPoint: {
              type: dataBarState.minType,
              value: dataBarState.minValue,
              color: dataBarState.positiveColor,
            },
            maxPoint: {
              type: dataBarState.maxType,
              value: dataBarState.maxValue,
              color: dataBarState.positiveColor,
            },
            positiveColor: dataBarState.positiveColor,
            negativeColor: dataBarState.negativeColor,
            borderColor: dataBarState.showBorder ? dataBarState.borderColor : undefined,
            showBorder: dataBarState.showBorder,
            gradient: dataBarState.gradient,
            axisPosition: dataBarState.axisPosition,
            showValue: dataBarState.showValue,
          },
        } as Omit<CFDataBarRule, 'id' | 'priority'>;
        break;

      case 'iconSet':
        ruleInput = {
          type: 'iconSet',
          iconSet: buildIconSet(iconSetState),
        } as Omit<CFIconSetRule, 'id' | 'priority'>;
        break;

      // Formula rule handling
      case 'formula': {
        // Strip leading '=' if present (formulas are stored without it)
        const formulaText = formula.startsWith('=') ? formula.slice(1) : formula;
        ruleInput = {
          type: 'formula',
          formula: formulaText,
          style: {
            backgroundColor,
            fontColor,
          },
        } as Omit<CFFormulaRule, 'id' | 'priority'>;
        break;
      }

      default:
        // For other rule types, create a basic cellValue rule as placeholder
        ruleInput = {
          type: 'cellValue',
          operator: 'greaterThan',
          value1: 0,
          style: { backgroundColor: '#ffcccc' },
        } as Omit<CFCellValueRule, 'id' | 'priority'>;
    }

    // In edit mode, update existing format; in create mode, add new format
    if (cfDialog.mode === 'edit' && cfDialog.editingFormat) {
      const editingFormat = cfDialog.editingFormat;
      const existingRule = editingFormat.rules[0];

      // Build a full CFRule with preserved ID and priority for the update
      const rule: CFRule = {
        ...ruleInput,
        id: existingRule?.id ?? '',
        priority: existingRule?.priority ?? 0,
      } as CFRule;

      // Update the format with the new rule
      await ws.conditionalFormats.update(editingFormat.id, {
        rules: [rule],
      });
    } else {
      // Create mode - add new format (API assigns IDs and priorities)
      await ws.conditionalFormats.add([selectedRange], [ruleInput]);
    }

    closeCFDialog();
  };

  // Handle close
  const handleClose = () => {
    closeCFDialog();
  };

  // Render rule-specific inputs
  const renderRuleInputs = () => {
    switch (cfDialog.selectedRuleType) {
      case 'cellValue':
        return (
          <>
            <FormField label="Condition">
              <Select
                options={OPERATOR_OPTIONS}
                value={operator}
                onChange={(value) => setOperator(value as CFOperator)}
                className="w-full"
                data-testid="cf-cell-value-operator"
              />
            </FormField>

            <FormField label="Value">
              {operator === 'between' || operator === 'notBetween' ? (
                <div className="flex items-center gap-3">
                  <Input
                    value={value1}
                    onChange={(e) => setValue1(e.target.value)}
                    placeholder="Min value"
                    className="flex-1"
                  />
                  <span className="text-body-sm text-ss-text-secondary">and</span>
                  <Input
                    value={value2}
                    onChange={(e) => setValue2(e.target.value)}
                    placeholder="Max value"
                    className="flex-1"
                  />
                </div>
              ) : (
                <Input
                  value={value1}
                  onChange={(e) => setValue1(e.target.value)}
                  placeholder="Enter value"
                />
              )}
            </FormField>

            <FormField label="Formatting">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <ColorInput
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    size="md"
                    data-testid="cf-style-fill-color"
                  />
                  <span className="text-body-sm text-ss-text-secondary">Background</span>
                </div>
                <div className="flex items-center gap-2">
                  <ColorInput
                    value={fontColor}
                    onChange={(e) => setFontColor(e.target.value)}
                    size="md"
                    data-testid="cf-style-font-color"
                  />
                  <span className="text-body-sm text-ss-text-secondary">Text</span>
                </div>
              </div>
            </FormField>

            <FormField label="Preview">
              <div
                className="px-3 py-2.5 rounded border border-ss-border text-body"
                style={{ backgroundColor, color: fontColor }}
              >
                Sample Text
              </div>
            </FormField>
          </>
        );

      case 'colorScale':
        return <ColorScaleOptions value={colorScaleState} onChange={setColorScaleState} />;

      case 'dataBar':
        return <DataBarOptions value={dataBarState} onChange={setDataBarState} />;

      case 'iconSet':
        return <IconSetOptions value={iconSetState} onChange={setIconSetState} />;

      // Formula rule UI
      case 'formula':
        return (
          <>
            <FormField label="Formula">
              <Input
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                placeholder="=$A1>100"
                className="font-ss-mono"
                data-testid="cf-formula-input"
              />
              <p className="mt-1 text-body-xs text-ss-text-tertiary">
                Enter a formula that returns TRUE or FALSE. Use relative references (like $A1) for
                the formula to evaluate relative to each cell in the range.
              </p>
            </FormField>

            <FormField label="Formatting">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <ColorInput
                    value={backgroundColor}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                    size="md"
                    data-testid="cf-style-fill-color"
                  />
                  <span className="text-body-sm text-ss-text-secondary">Background</span>
                </div>
                <div className="flex items-center gap-2">
                  <ColorInput
                    value={fontColor}
                    onChange={(e) => setFontColor(e.target.value)}
                    size="md"
                    data-testid="cf-style-font-color"
                  />
                  <span className="text-body-sm text-ss-text-secondary">Text</span>
                </div>
              </div>
            </FormField>

            <FormField label="Preview">
              <div
                className="px-3 py-2.5 rounded border border-ss-border text-body"
                style={{ backgroundColor, color: fontColor }}
              >
                Sample Text
              </div>
            </FormField>
          </>
        );

      default:
        return (
          <div className="mb-4">
            <p className="text-ss-text-secondary italic">
              Advanced options for this rule type coming soon.
            </p>
          </div>
        );
    }
  };

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={cfDialog.isOpen}
      onClose={handleClose}
      dialogId="conditional-format-dialog"
      width="lg"
    >
      {/* Stable test-id marker for app-eval scenarios polling "is the dialog mounted". */}
      <div data-testid="cf-rule-dialog" hidden />
      <DialogHeader onClose={handleClose}>
        {cfDialog.mode === 'edit' ? 'Edit' : 'New'} Conditional Formatting Rule
      </DialogHeader>

      <DialogBody>
        {/* Range Display */}
        <FormField label="Apply to Range">
          <div className="px-3 py-2 border border-ss-border rounded font-ss-mono text-body">
            {rangeString}
          </div>
        </FormField>

        {/* Rule Type Selector */}
        <FormField label="Rule Type">
          <Select
            options={RULE_TYPE_OPTIONS}
            value={cfDialog.selectedRuleType}
            onChange={(value) => setCFRuleType(value as CFRuleType)}
            className="w-full"
            data-testid="cf-rule-type-select"
          />
        </FormField>

        {/* Rule-specific inputs */}
        {renderRuleInputs()}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose} data-testid="cf-rule-dialog-cancel">
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply} data-testid="cf-rule-dialog-apply">
          Apply
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts ConditionalFormatDialog when it's open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function ConditionalFormatDialogWrapper() {
  const isOpen = useUIStore((s) => s.cfDialog.isOpen);
  if (!isOpen) return null;
  return <ConditionalFormatDialog />;
}
