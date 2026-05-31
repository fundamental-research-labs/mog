/**
 * Data Validation Dialog
 *
 * UI for creating and editing data validation rules via the unified Worksheet API.
 * Follows Excel's Data Validation dialog pattern with three sections:
 * - Settings: Validation type and criteria
 * - Input Message: Message shown when cell is selected
 * - Error Alert: Message shown on invalid input
 *
 * Uses FocusTrap for proper keyboard event isolation.
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CollapsibleRangeInput,
  useActiveCell,
  useActiveSheetId,
  useDVDialog,
  useSelectionRanges,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Label,
  Select,
  TabPanel,
  Tabs,
  Textarea,
} from '@mog/shell';
import type { ValidationRule } from '@mog-sdk/contracts/api';
import type { EnforcementLevel } from '@mog-sdk/contracts/schema';
import type { DVValidationType } from '../../ui-store';
import { useRangeSelectionEnterGuard } from '../../hooks/dialogs/use-range-selection-enter-guard';

// =============================================================================
// Type Labels
// =============================================================================

/**
 * Added 'any' and 'time' types for Excel-compatible behavior.
 * Order matches Excel's Data Validation dialog dropdown.
 */
const VALIDATION_TYPE_OPTIONS = [
  { value: 'any', label: 'Any value' },
  { value: 'wholeNumber', label: 'Whole Number' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'list', label: 'List' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'textLength', label: 'Text Length' },
  { value: 'custom', label: 'Custom' },
];

/**
 * Comparison operator options for numeric/date/time/text length validation.
 * These match Excel's "Data" dropdown in the Settings tab.
 */
const COMPARISON_OPERATOR_OPTIONS = [
  { value: 'between', label: 'between' },
  { value: 'notBetween', label: 'not between' },
  { value: 'equal', label: 'equal to' },
  { value: 'notEqual', label: 'not equal to' },
  { value: 'greaterThan', label: 'greater than' },
  { value: 'lessThan', label: 'less than' },
  { value: 'greaterThanOrEqual', label: 'greater than or equal to' },
  { value: 'lessThanOrEqual', label: 'less than or equal to' },
];

/**
 * Comparison operator type for numeric/date/time validation.
 */
type ComparisonOperator =
  | 'between'
  | 'notBetween'
  | 'equal'
  | 'notEqual'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual';

const ENFORCEMENT_OPTIONS = [
  { value: 'strict', label: 'Stop (Reject invalid input)' },
  { value: 'warning', label: 'Warning (Show dialog, allow override)' },
  { value: 'info', label: 'Information (Show info, always allow)' },
  { value: 'none', label: 'None (No user feedback)' },
];

/**
 * Character limits for Excel parity.
 * These match Excel's limits for data validation fields:
 * - Input message title: 32 characters
 * - Input message: 255 characters
 * - Error message title: 32 characters
 * - Error message: 225 characters (note: 225 not 255)
 * - Formula constraint: 8192 characters
 */
const CHARACTER_LIMITS = {
  inputTitle: 32,
  inputMessage: 255,
  errorTitle: 32,
  errorMessage: 225,
  formulaConstraint: 8192,
} as const;

type TabId = 'settings' | 'input' | 'error';

const TABS = [
  { id: 'settings', label: 'Settings' },
  { id: 'input', label: 'Input Message' },
  { id: 'error', label: 'Error Alert' },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse A1-style range string to row/col bounds.
 * Supports formats: "A1", "$A$1", "A1:B10", "$A$1:$B$10", "=A1:B10"
 * Returns null if the string cannot be parsed.
 */
function parseA1Range(rangeStr: string): {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} | null {
  // Remove leading = sign if present
  let input = rangeStr.trim();
  if (input.startsWith('=')) {
    input = input.substring(1);
  }

  // Remove $ signs (absolute references)
  input = input.replace(/\$/g, '');

  // Match A1 or A1:B10 pattern
  const rangePattern = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i;
  const match = input.match(rangePattern);

  if (!match) {
    return null;
  }

  const startCol = colLetterToIndex(match[1]);
  const startRow = parseInt(match[2], 10) - 1; // Convert to 0-based

  // If it's a range (A1:B10), parse end cell
  const endCol = match[3] ? colLetterToIndex(match[3]) : startCol;
  const endRow = match[4] ? parseInt(match[4], 10) - 1 : startRow;

  return { startRow, startCol, endRow, endCol };
}

/**
 * Convert column letter(s) to 0-based index.
 * "A" -> 0, "B" -> 1, ..., "Z" -> 25, "AA" -> 26
 */
function colLetterToIndex(letters: string): number {
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Convert 0-based column index to letter(s).
 * 0 -> "A", 1 -> "B", ..., 25 -> "Z", 26 -> "AA"
 */
function colIndexToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/**
 * Coerce a Min/Max input string into a comparable number for the same-type
 * compare used by `Min ≤ Max` field validation. Returns null for empty or
 * unparseable values — callers treat null as "no error yet, the user is mid
 * edit." Date strings collapse to days-since-epoch and time strings to
 * minutes-of-day; both preserve order across the relevant range without
 * needing the kernel's serial machinery.
 */
function parseMinMaxForCompare(value: string, type: DVValidationType): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (type === 'date') {
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  if (type === 'time') {
    const m = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const s = m[3] ? parseInt(m[3], 10) : 0;
    return h * 3600 + min * 60 + s;
  }
  if (type === 'wholeNumber' || type === 'textLength') {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : null;
  }
  // decimal
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Quick structural check on a custom-formula string. The kernel's parser is
 * authoritative on full syntax — this just catches the obvious user error
 * (unmatched parentheses, empty body) early so the dialog can surface it
 * before the user clicks Apply. Quoted strings are skipped so a literal "("
 * inside a string doesn't throw off the count.
 */
function findFormulaError(formula: string): string | null {
  const raw = formula.trim();
  if (!raw) return null;
  const body = raw.startsWith('=') ? raw.slice(1).trim() : raw;
  if (!body) return 'Formula must not be empty.';
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') {
      // Excel's doubled-quote escape: "" inside a quoted string.
      if (inQuote && body[i + 1] === '"') {
        i++;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return 'Formula has unmatched closing parenthesis.';
    }
  }
  if (depth !== 0) return 'Formula has unbalanced parentheses.';
  if (inQuote) return 'Formula has an unterminated string literal.';
  return null;
}

function mapValidationTypeToRuleType(
  validationType: DVValidationType,
): ValidationRule['type'] | undefined {
  switch (validationType) {
    case 'wholeNumber':
      return 'wholeNumber';
    case 'decimal':
      return 'decimal';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'textLength':
      return 'textLength';
    case 'list':
      return 'list';
    case 'custom':
      return 'custom';
    case 'any':
      // 'any' means no type validation
      return undefined;
    default:
      return undefined;
  }
}

// =============================================================================
// Component
// =============================================================================

export function DataValidationDialog() {
  const dvDialog = useDVDialog();
  // PERFORMANCE: Use granular hooks - only subscribe to what we need
  const { activeCell } = useActiveCell();
  const ranges = useSelectionRanges();
  const activeSheetId = useActiveSheetId();
  const closeDVDialog = useUIStore((s) => s.closeDVDialog);
  const setDVValidationType = useUIStore((s) => s.setDVValidationType);
  const wb = useWorkbook();
  const ws = useMemo(() => wb.getSheetById(activeSheetId), [wb, activeSheetId]);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('settings');

  // Settings state
  const [listSource, setListSource] = useState(''); // e.g., "A,B,C" or "=$A$1:$A$10"
  // List source type selector
  // Group 17: Added 'formula' type for INDIRECT-based dynamic dropdowns
  const [listSourceType, setListSourceType] = useState<
    'range' | 'values' | 'namedRange' | 'formula'
  >('range');
  const [selectedNamedRange, setSelectedNamedRange] = useState('');
  // Group 17: Formula source for INDIRECT and other dynamic list formulas
  const [formulaSource, setFormulaSource] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [customFormula, setCustomFormula] = useState('');
  const [ignoreBlank, setIgnoreBlank] = useState(true);
  const [showDropdown, setShowDropdown] = useState(true);
  // Comparison operator state
  const [comparisonOperator, setComparisonOperator] = useState<ComparisonOperator>('between');

  // Get available named ranges from Workbook API (async)
  const [namedRanges, setNamedRanges] = useState<Array<{ name: string; refersToA1: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadNamedRanges() {
      try {
        const allNames = await wb.names.list();
        if (!cancelled) {
          setNamedRanges(
            allNames.map((n) => ({
              name: n.name,
              refersToA1: n.reference ?? '',
            })),
          );
        }
      } catch (err) {
        console.error('Failed to load named ranges:', err);
      }
    }
    loadNamedRanges();
    return () => {
      cancelled = true;
    };
  }, [wb]);

  // Input message state
  const [showInputMessage, setShowInputMessage] = useState(false);
  const [inputTitle, setInputTitle] = useState('');
  const [inputMessage, setInputMessage] = useState('');

  // Error alert state
  const [enforcement, setEnforcement] = useState<EnforcementLevel>('strict');
  const [showErrorMessage, setShowErrorMessage] = useState(true);
  const [errorTitle, setErrorTitle] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Get the selected range bounds (position-based, for display)
  // CellId creation is deferred to handleApply to avoid writes during render
  const selectedRangeBounds = useMemo(() => {
    const range = ranges[0];
    return {
      startRow: range?.startRow ?? activeCell.row,
      startCol: range?.startCol ?? activeCell.col,
      endRow: range?.endRow ?? activeCell.row,
      endCol: range?.endCol ?? activeCell.col,
    };
  }, [ranges, activeCell]);

  // A1 display string for the selected range (display only)
  const selectedRangeDisplay = useMemo(() => {
    const { startRow, startCol, endRow, endCol } = selectedRangeBounds;
    const startA1 = `${colIndexToLetter(startCol)}${startRow + 1}`;
    const endA1 = `${colIndexToLetter(endCol)}${endRow + 1}`;
    return startA1 === endA1 ? startA1 : `${startA1}:${endA1}`;
  }, [selectedRangeBounds]);

  // Field-level validation: surface obvious user errors (Min > Max, malformed
  // custom formula) before the user clicks Apply. Apply is gated on
  // `hasErrors` so a broken rule cannot leave the dialog. The kernel remains
  // the authority on full syntax/semantic validity at apply time.
  const fieldErrors = useMemo(() => {
    const errs: { minMax?: string; formula?: string } = {};
    const type = dvDialog.selectedValidationType;
    const isRangeOp = comparisonOperator === 'between' || comparisonOperator === 'notBetween';
    const supportsRange =
      type === 'wholeNumber' ||
      type === 'decimal' ||
      type === 'date' ||
      type === 'time' ||
      type === 'textLength';
    if (isRangeOp && supportsRange && minValue.trim() && maxValue.trim()) {
      const lo = parseMinMaxForCompare(minValue, type);
      const hi = parseMinMaxForCompare(maxValue, type);
      if (lo != null && hi != null && lo > hi) {
        errs.minMax = 'Maximum must be greater than or equal to minimum.';
      }
    }
    if (type === 'custom') {
      const err = findFormulaError(customFormula);
      if (err) errs.formula = err;
    }
    return errs;
  }, [dvDialog.selectedValidationType, comparisonOperator, minValue, maxValue, customFormula]);

  const hasFieldErrors = !!fieldErrors.minMax || !!fieldErrors.formula;

  // Load existing schema when editing
  useEffect(() => {
    if (dvDialog.mode !== 'edit' || !dvDialog.editingSchemaId) return;
    let cancelled = false;
    void (async () => {
      const rules = await ws.validations.list();
      if (cancelled) return;
      const rule = rules.find((s) => s.id === dvDialog.editingSchemaId);
      if (!rule) return;

      // Determine validation type from rule
      if (rule.type === 'list') {
        setDVValidationType('list');
        if (rule.listSource) {
          // Determine list source type from listSource content
          const src = rule.listSource;
          // Formula-based (e.g., "=INDIRECT(A1)") vs range (e.g., "=A1:A10")
          if (src.startsWith('=') && /^=[A-Z$]+\d/i.test(src)) {
            // Looks like a range reference (=A1:B5 or =$A$1:$A$10)
            setListSourceType('range');
            setListSource(src);
          } else if (src.startsWith('=')) {
            // Formula-based source (e.g., =INDIRECT(A1))
            setListSourceType('formula');
            setFormulaSource(src);
          } else {
            setListSourceType('range');
            setListSource(src);
          }
        } else if (rule.values) {
          setListSourceType('values');
          setListSource(rule.values.map(String).join(','));
        }
      } else if (rule.type === 'custom') {
        setDVValidationType('custom');
        setCustomFormula(rule.formula1?.toString() ?? '');
      } else if (rule.type === 'textLength') {
        setDVValidationType('textLength');
        if (rule.operator) setComparisonOperator(rule.operator);
        setMinValue(rule.formula1?.toString() ?? '');
        setMaxValue(rule.formula2?.toString() ?? '');
      } else if (rule.type === 'wholeNumber') {
        setDVValidationType('wholeNumber');
        if (rule.operator) setComparisonOperator(rule.operator);
        setMinValue(rule.formula1?.toString() ?? '');
        setMaxValue(rule.formula2?.toString() ?? '');
      } else if (rule.type === 'decimal' || rule.type === 'date' || rule.type === 'time') {
        setDVValidationType(rule.type);
        if (rule.operator) setComparisonOperator(rule.operator);
        setMinValue(rule.formula1?.toString() ?? '');
        setMaxValue(rule.formula2?.toString() ?? '');
      }

      // Load other settings
      setIgnoreBlank(rule.allowBlank !== false);
      setShowDropdown(rule.showDropdown ?? true);
      // Map errorStyle to enforcement
      const styleToEnforcement: Record<string, EnforcementLevel> = {
        stop: 'strict',
        warning: 'warning',
        information: 'info',
      };
      setEnforcement(
        rule.errorStyle ? (styleToEnforcement[rule.errorStyle] ?? 'strict') : 'strict',
      );

      if (rule.showInputMessage && rule.inputMessage) {
        setShowInputMessage(true);
        setInputTitle(rule.inputTitle ?? '');
        setInputMessage(rule.inputMessage);
      }

      if (rule.showErrorAlert && rule.errorMessage) {
        setShowErrorMessage(true);
        setErrorTitle(rule.errorTitle ?? '');
        setErrorMessage(rule.errorMessage);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws, dvDialog.mode, dvDialog.editingSchemaId, setDVValidationType]);

  // Build validation rule fields from form state
  // Now uses comparisonOperator to build appropriate constraints
  const buildRuleFields = useCallback((): Partial<ValidationRule> => {
    const fields: Partial<ValidationRule> = {};

    switch (dvDialog.selectedValidationType) {
      case 'any':
        // 'any' means no validation constraints — handled by not setting type
        break;

      case 'list': {
        // Handle different list source types
        // Group 17: Added 'formula' type for INDIRECT-based dynamic dropdowns
        if (listSourceType === 'formula' && formulaSource) {
          // Group 17: Formula-based enum source (e.g., INDIRECT(A1))
          const trimmedFormula = formulaSource.trim();
          fields.listSource = trimmedFormula.startsWith('=')
            ? trimmedFormula
            : `=${trimmedFormula}`;
        } else if (listSourceType === 'namedRange' && selectedNamedRange) {
          // Named range - resolve to A1 range string
          const namedRange = namedRanges.find((nr) => nr.name === selectedNamedRange);
          if (namedRange) {
            const refersTo = namedRange.refersToA1.startsWith('=')
              ? namedRange.refersToA1.substring(1)
              : namedRange.refersToA1;
            const bounds = parseA1Range(refersTo);
            if (bounds) {
              const rangeA1 = `${colIndexToLetter(bounds.startCol)}${bounds.startRow + 1}:${colIndexToLetter(bounds.endCol)}${bounds.endRow + 1}`;
              fields.listSource = `=${rangeA1}`;
            }
          }
        } else if (
          listSourceType === 'range' ||
          listSource.startsWith('=') ||
          listSource.startsWith('$')
        ) {
          // Range reference - store as listSource string
          const trimmed = listSource.trim();
          fields.listSource = trimmed.startsWith('=') ? trimmed : `=${trimmed}`;
        } else {
          // Comma-separated list (values)
          const trimmed = listSource.trim();
          fields.values = trimmed
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
        break;
      }

      case 'wholeNumber':
      case 'decimal': {
        // Build constraints based on comparison operator
        fields.operator = comparisonOperator;
        const val = minValue ? parseFloat(minValue) : undefined;
        const val2 = maxValue ? parseFloat(maxValue) : undefined;

        if (comparisonOperator === 'between' || comparisonOperator === 'notBetween') {
          if (val !== undefined) fields.formula1 = val;
          if (val2 !== undefined) fields.formula2 = val2;
        } else {
          if (val !== undefined) fields.formula1 = val;
        }
        break;
      }

      case 'date':
      case 'time': {
        // <input type="date"> emits YYYY-MM-DD; <input type="time"> emits
        // HH:MM. Pass through verbatim — `validationRuleToConstraints` in the
        // kernel normalises both into Excel serials. A prior parseFloat here
        // collapsed "2026-01-01" to 2026 (the year), corrupting the rule
        // bounds before they ever reached the kernel.
        fields.operator = comparisonOperator;
        if (comparisonOperator === 'between' || comparisonOperator === 'notBetween') {
          if (minValue) fields.formula1 = minValue;
          if (maxValue) fields.formula2 = maxValue;
        } else {
          if (minValue) fields.formula1 = minValue;
        }
        break;
      }

      case 'textLength': {
        // Build text length constraints based on comparison operator
        fields.operator = comparisonOperator;
        const len = minValue ? parseInt(minValue, 10) : undefined;
        const len2 = maxValue ? parseInt(maxValue, 10) : undefined;

        if (comparisonOperator === 'between' || comparisonOperator === 'notBetween') {
          if (len !== undefined) fields.formula1 = len;
          if (len2 !== undefined) fields.formula2 = len2;
        } else {
          if (len !== undefined) fields.formula1 = len;
        }
        break;
      }

      case 'custom': {
        if (customFormula) {
          fields.formula1 = customFormula.startsWith('=')
            ? customFormula.substring(1)
            : customFormula;
        }
        break;
      }
    }

    return fields;
  }, [
    dvDialog.selectedValidationType,
    listSource,
    listSourceType,
    selectedNamedRange,
    namedRanges,
    formulaSource,
    minValue,
    maxValue,
    customFormula,
    comparisonOperator,
  ]);

  // Build UI-related fields for the ValidationRule
  const buildUIFields = useCallback((): Partial<ValidationRule> => {
    const fields: Partial<ValidationRule> = {};

    if (dvDialog.selectedValidationType === 'list') {
      fields.showDropdown = showDropdown;
    }

    if (showInputMessage && inputMessage) {
      fields.showInputMessage = true;
      fields.inputTitle = inputTitle || undefined;
      fields.inputMessage = inputMessage;
    }

    if (showErrorMessage && errorMessage) {
      fields.showErrorAlert = true;
      fields.errorTitle = errorTitle || undefined;
      fields.errorMessage = errorMessage;
    }

    return fields;
  }, [
    dvDialog.selectedValidationType,
    showDropdown,
    showInputMessage,
    inputTitle,
    inputMessage,
    showErrorMessage,
    errorTitle,
    errorMessage,
  ]);

  // Handle apply
  const handleApply = useCallback(async () => {
    const ruleType = mapValidationTypeToRuleType(dvDialog.selectedValidationType);
    if (!ruleType) {
      // 'any' type means remove validation
      if (dvDialog.editingSchemaId) {
        await ws.validations.removeById(dvDialog.editingSchemaId);
      }
      closeDVDialog();
      return;
    }

    const ruleFields = buildRuleFields();
    const uiFields = buildUIFields();

    // Map enforcement level to errorStyle
    const enforcementToStyle: Record<EnforcementLevel, ValidationRule['errorStyle']> = {
      strict: 'stop',
      warning: 'warning',
      info: 'information',
      none: undefined,
    };

    // Build the A1 address for the selected range
    const { startRow, startCol, endRow, endCol } = selectedRangeBounds;
    const startA1 = `${colIndexToLetter(startCol)}${startRow + 1}`;
    const endA1 = `${colIndexToLetter(endCol)}${endRow + 1}`;
    const address = startA1 === endA1 ? startA1 : `${startA1}:${endA1}`;

    const rule: ValidationRule = {
      id: dvDialog.editingSchemaId ?? undefined,
      type: ruleType,
      ...ruleFields,
      allowBlank: ignoreBlank,
      errorStyle: enforcementToStyle[enforcement],
      ...uiFields,
    };

    await ws.validations.set(address, rule);
    closeDVDialog();
  }, [
    buildRuleFields,
    buildUIFields,
    dvDialog.editingSchemaId,
    dvDialog.selectedValidationType,
    selectedRangeBounds,
    enforcement,
    ignoreBlank,
    ws,
    closeDVDialog,
  ]);

  // Handle remove
  const handleRemove = useCallback(async () => {
    if (dvDialog.editingSchemaId) {
      await ws.validations.removeById(dvDialog.editingSchemaId);
    }
    closeDVDialog();
  }, [dvDialog.editingSchemaId, ws, closeDVDialog]);

  // Handle close
  const handleClose = useCallback(() => {
    closeDVDialog();
  }, [closeDVDialog]);

  const guardedEnter = useRangeSelectionEnterGuard(handleApply);

  // Don't render if dialog is closed
  if (!dvDialog.isOpen) return null;

  // Render settings tab content
  const renderSettingsTab = () => (
    <>
      {/* Validation Type */}
      <FormField label="Allow">
        <Select
          options={VALIDATION_TYPE_OPTIONS}
          value={dvDialog.selectedValidationType}
          onChange={(value) => setDVValidationType(value as DVValidationType)}
          data-testid="dv-validation-type"
        />
      </FormField>

      {/* Type-specific inputs */}
      {dvDialog.selectedValidationType === 'list' && (
        <>
          {/* Source type selector */}
          {/* Group 17: Added 'Formula' option for INDIRECT-based dynamic dropdowns */}
          <FormField label="Source Type">
            <Select
              options={[
                { value: 'range', label: 'Cell Range' },
                { value: 'values', label: 'Comma-separated Values' },
                { value: 'namedRange', label: 'Named Range' },
                { value: 'formula', label: 'Formula (e.g., INDIRECT)' },
              ]}
              value={listSourceType}
              onChange={(value) =>
                setListSourceType(value as 'range' | 'values' | 'namedRange' | 'formula')
              }
              data-testid="dv-list-source-type"
            />
          </FormField>

          {/* Conditional source input based on type */}
          {/* Group 17: Added formula source type for INDIRECT */}
          {listSourceType === 'formula' ? (
            <FormField
              label="Formula"
              helpText="Enter a formula that returns a range (e.g., INDIRECT(A1) for cascading dropdowns)"
            >
              <Input
                value={formulaSource}
                onChange={(e) => setFormulaSource(e.target.value)}
                placeholder="=INDIRECT(A1)"
              />
            </FormField>
          ) : listSourceType === 'namedRange' ? (
            <FormField label="Named Range">
              {namedRanges.length > 0 ? (
                <Select
                  options={namedRanges.map((nr) => ({
                    value: nr.name,
                    label: `${nr.name} (${nr.refersToA1})`,
                  }))}
                  value={selectedNamedRange}
                  onChange={(value) => setSelectedNamedRange(value)}
                  data-testid="dv-list-named-range"
                />
              ) : (
                <div className="text-body-sm text-ss-text-tertiary p-2 bg-ss-surface-secondary rounded">
                  No named ranges defined. Create one using Formulas &gt; Name Manager.
                </div>
              )}
            </FormField>
          ) : listSourceType === 'values' ? (
            <FormField label="Values" helpText="Enter comma-separated values">
              <Input
                value={listSource}
                onChange={(e) => setListSource(e.target.value)}
                placeholder="Option 1, Option 2, Option 3"
              />
            </FormField>
          ) : (
            <FormField label="Source" helpText="Enter a cell range reference">
              <CollapsibleRangeInput
                value={listSource}
                onChange={setListSource}
                dialogId="data-validation-dialog"
                inputId="list-source"
                placeholder="=$A$1:$A$10"
                label="Source"
              />
            </FormField>
          )}

          <div className="mb-4">
            <Checkbox
              checked={showDropdown}
              onChange={(checked) => setShowDropdown(checked)}
              label="Show dropdown in cell"
            />
          </div>
        </>
      )}

      {/* & 11.7: Numeric/date/time/text length validation with comparison operators */}
      {(dvDialog.selectedValidationType === 'wholeNumber' ||
        dvDialog.selectedValidationType === 'decimal' ||
        dvDialog.selectedValidationType === 'date' ||
        dvDialog.selectedValidationType === 'time' ||
        dvDialog.selectedValidationType === 'textLength') && (
        <>
          {/* Comparison operator dropdown */}
          <FormField label="Data">
            <Select
              options={COMPARISON_OPERATOR_OPTIONS}
              value={comparisonOperator}
              onChange={(value) => setComparisonOperator(value as ComparisonOperator)}
              data-testid="dv-comparison-operator"
            />
          </FormField>

          <div className="mb-4">
            {/* Show two inputs for 'between' and 'notBetween', one otherwise */}
            {comparisonOperator === 'between' || comparisonOperator === 'notBetween' ? (
              <>
                <div className="flex gap-3 mt-2">
                  <div className="flex-1">
                    <Label className="mb-1">Minimum</Label>
                    <Input
                      type={
                        dvDialog.selectedValidationType === 'date'
                          ? 'date'
                          : dvDialog.selectedValidationType === 'time'
                            ? 'time'
                            : 'number'
                      }
                      value={minValue}
                      onChange={(e) => setMinValue(e.target.value)}
                      placeholder="Min"
                      error={!!fieldErrors.minMax}
                      aria-invalid={fieldErrors.minMax ? true : undefined}
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="mb-1">Maximum</Label>
                    <Input
                      type={
                        dvDialog.selectedValidationType === 'date'
                          ? 'date'
                          : dvDialog.selectedValidationType === 'time'
                            ? 'time'
                            : 'number'
                      }
                      value={maxValue}
                      onChange={(e) => setMaxValue(e.target.value)}
                      placeholder="Max"
                      error={!!fieldErrors.minMax}
                      aria-invalid={fieldErrors.minMax ? true : undefined}
                    />
                  </div>
                </div>
                {fieldErrors.minMax && (
                  <p className="mt-1 text-caption text-ss-error">{fieldErrors.minMax}</p>
                )}
              </>
            ) : (
              <div className="mt-2">
                <Label className="mb-1">Value</Label>
                <Input
                  type={
                    dvDialog.selectedValidationType === 'date'
                      ? 'date'
                      : dvDialog.selectedValidationType === 'time'
                        ? 'time'
                        : 'number'
                  }
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="Enter value"
                />
              </div>
            )}
          </div>
        </>
      )}

      {dvDialog.selectedValidationType === 'custom' && (
        <FormField
          label="Formula"
          helpText="Enter a formula that returns TRUE for valid values"
          error={fieldErrors.formula}
        >
          <Input
            value={customFormula}
            onChange={(e) => setCustomFormula(e.target.value)}
            placeholder="=AND(A1>0, A1<100)"
            maxLength={CHARACTER_LIMITS.formulaConstraint}
            error={!!fieldErrors.formula}
            aria-invalid={fieldErrors.formula ? true : undefined}
          />
        </FormField>
      )}

      {/* Common settings */}
      <div className="mb-4">
        <Checkbox
          checked={ignoreBlank}
          onChange={(checked) => setIgnoreBlank(checked)}
          label="Ignore blank cells"
        />
      </div>
    </>
  );

  // Render input message tab content
  const renderInputTab = () => (
    <>
      <div className="mb-4">
        <Checkbox
          checked={showInputMessage}
          onChange={(checked) => setShowInputMessage(checked)}
          label="Show input message when cell is selected"
        />
      </div>

      <FormField label="Title">
        <Input
          value={inputTitle}
          onChange={(e) => setInputTitle(e.target.value)}
          placeholder="Optional title"
          maxLength={CHARACTER_LIMITS.inputTitle}
          disabled={!showInputMessage}
        />
      </FormField>

      <FormField label="Message">
        <Textarea
          value={inputMessage}
          onChange={setInputMessage}
          placeholder="Enter the message to display"
          maxLength={CHARACTER_LIMITS.inputMessage}
          disabled={!showInputMessage}
        />
      </FormField>
    </>
  );

  // Render error alert tab content
  const renderErrorTab = () => (
    <>
      <FormField label="Style">
        <Select
          options={ENFORCEMENT_OPTIONS}
          value={enforcement}
          onChange={(value) => setEnforcement(value as EnforcementLevel)}
          data-testid="dv-enforcement"
        />
      </FormField>

      <div className="mb-4">
        <Checkbox
          checked={showErrorMessage}
          onChange={(checked) => setShowErrorMessage(checked)}
          label="Show error alert after invalid data is entered"
        />
      </div>

      {showErrorMessage && (
        <>
          <FormField label="Title">
            <Input
              value={errorTitle}
              onChange={(e) => setErrorTitle(e.target.value)}
              placeholder="Optional title"
              maxLength={CHARACTER_LIMITS.errorTitle}
            />
          </FormField>

          <FormField label="Error message">
            <Textarea
              value={errorMessage}
              onChange={setErrorMessage}
              placeholder="Enter the error message to display"
              maxLength={CHARACTER_LIMITS.errorMessage}
            />
          </FormField>
        </>
      )}
    </>
  );

  return (
    <Dialog
      onEnterKeyDown={guardedEnter}
      open={dvDialog.isOpen}
      onClose={handleClose}
      dialogId="data-validation-dialog"
      width={520}
    >
      <DialogHeader onClose={handleClose}>
        {dvDialog.mode === 'edit' ? 'Edit' : 'New'} Data Validation
      </DialogHeader>

      <DialogBody>
        {/* Range Display - A1 notation for user (display only) */}
        <FormField label="Apply to Range">
          <div className="px-3 py-2 bg-ss-surface-secondary rounded font-ss-mono text-body">
            {selectedRangeDisplay}
          </div>
        </FormField>

        {/* Tabs */}
        <Tabs
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as TabId)}
          className="mb-4"
        >
          <TabPanel tabId="settings">{renderSettingsTab()}</TabPanel>
          <TabPanel tabId="input">{renderInputTab()}</TabPanel>
          <TabPanel tabId="error">{renderErrorTab()}</TabPanel>
        </Tabs>
      </DialogBody>

      <DialogFooter>
        {dvDialog.mode === 'edit' && (
          <Button variant="danger" onClick={handleRemove} className="mr-auto">
            Remove
          </Button>
        )}
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply} disabled={hasFieldErrors}>
          {dvDialog.mode === 'edit' ? 'Update' : 'Apply'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts DataValidationDialog when it's open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function DataValidationDialogWrapper() {
  const isOpen = useUIStore((s) => s.dvDialog.isOpen);
  if (!isOpen) return null;
  return <DataValidationDialog />;
}
