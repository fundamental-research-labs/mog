import type { ValidationRule } from '@mog-sdk/contracts/api';
import type { Direction } from '@mog-sdk/contracts/machines';
import { classifyDateFormat } from '@mog/spreadsheet-utils/number-formats';

export type DatePickerEligibility =
  | {
      eligible: true;
      kind: 'date' | 'datetime';
      source: 'validation' | 'schema' | 'format-and-serial' | 'explicit-format';
      openBehavior: 'active-cell-affordance' | 'editor-picker';
      validationRule: ValidationRule | null;
      commitDirection: Direction | 'none';
    }
  | {
      eligible: false;
      reason: string;
      validationRule?: ValidationRule | null;
    };

export interface DatePickerEligibilityInput {
  row: number;
  col: number;
  value: unknown;
  displayKind: 'blank' | 'number' | 'text' | 'formula' | 'error' | 'spill-child';
  resolvedNumberFormat: string | null;
  validationRule: ValidationRule | null;
  schemaType: 'date' | 'datetime' | 'time' | 'other' | null;
  protectedOrReadOnly: boolean;
  dateSystem: '1900' | '1904';
}

function isFiniteDateSerial(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 2_958_465;
}

export function getDatePickerEligibility(input: DatePickerEligibilityInput): DatePickerEligibility {
  if (input.protectedOrReadOnly) {
    return {
      eligible: false,
      reason: 'protected-or-read-only',
      validationRule: input.validationRule,
    };
  }
  if (input.displayKind === 'formula') {
    return { eligible: false, reason: 'formula-cell', validationRule: input.validationRule };
  }
  if (input.displayKind === 'error') {
    return { eligible: false, reason: 'error-cell', validationRule: input.validationRule };
  }
  if (input.displayKind === 'spill-child') {
    return { eligible: false, reason: 'spill-child', validationRule: input.validationRule };
  }

  const rule = input.validationRule;
  if (rule) {
    if (rule.type === 'date') {
      return {
        eligible: true,
        kind: 'date',
        source: 'validation',
        openBehavior: 'active-cell-affordance',
        validationRule: rule,
        commitDirection: 'down',
      };
    }
    if (rule.type !== 'none') {
      return { eligible: false, reason: `validation-${rule.type}`, validationRule: rule };
    }
  }

  if (input.schemaType === 'date' || input.schemaType === 'datetime') {
    return {
      eligible: true,
      kind: input.schemaType,
      source: 'schema',
      openBehavior: 'active-cell-affordance',
      validationRule: rule,
      commitDirection: 'down',
    };
  }
  if (input.schemaType === 'time') {
    return { eligible: false, reason: 'time-schema', validationRule: rule };
  }

  const classification = classifyDateFormat(input.resolvedNumberFormat);
  if (classification.kind === 'time') {
    return { eligible: false, reason: 'time-only-format', validationRule: rule };
  }
  if (classification.kind === 'date' || classification.kind === 'datetime') {
    if (input.displayKind === 'number' && isFiniteDateSerial(input.value)) {
      return {
        eligible: true,
        kind: classification.kind,
        source: 'format-and-serial',
        openBehavior: 'active-cell-affordance',
        validationRule: rule,
        commitDirection: 'down',
      };
    }
    if (input.displayKind === 'blank') {
      return {
        eligible: true,
        kind: classification.kind,
        source: 'explicit-format',
        openBehavior: 'active-cell-affordance',
        validationRule: rule,
        commitDirection: 'down',
      };
    }
  }

  if (input.displayKind === 'text') {
    return { eligible: false, reason: 'text-without-date-contract', validationRule: rule };
  }
  return { eligible: false, reason: 'not-date-like', validationRule: rule };
}

export interface DateValidationBounds {
  allowBlank: boolean;
  operator:
    | 'equal'
    | 'notEqual'
    | 'greaterThan'
    | 'lessThan'
    | 'greaterThanOrEqual'
    | 'lessThanOrEqual'
    | 'between'
    | 'notBetween';
  lower?: { iso: string; inclusive: boolean };
  upper?: { iso: string; inclusive: boolean };
  equalIso?: string;
  notEqualIso?: string;
  disabledReason?: string;
  strictness: 'stop' | 'warning' | 'information';
  unsupportedFormulaBound: boolean;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeBound(value: string | number | undefined): string | null {
  if (typeof value === 'string') {
    return ISO_DATE_RE.test(value) ? value : null;
  }
  return null;
}

export function normalizeDateValidationBounds(
  rule: ValidationRule | null,
): DateValidationBounds | null {
  if (!rule || rule.type !== 'date' || !rule.operator) return null;
  const lower = normalizeBound(rule.formula1);
  const upper = normalizeBound(rule.formula2);
  const needsUpper = rule.operator === 'between' || rule.operator === 'notBetween';
  const unsupportedFormulaBound = lower === null || (needsUpper && upper === null);
  const base = {
    allowBlank: rule.allowBlank !== false,
    operator: rule.operator,
    strictness: rule.errorStyle ?? 'stop',
    unsupportedFormulaBound,
  } satisfies Omit<DateValidationBounds, 'lower' | 'upper' | 'equalIso' | 'notEqualIso'>;
  if (unsupportedFormulaBound) return base;

  switch (rule.operator) {
    case 'equal':
      return { ...base, equalIso: lower! };
    case 'notEqual':
      return { ...base, notEqualIso: lower! };
    case 'greaterThan':
      return { ...base, lower: { iso: lower!, inclusive: false } };
    case 'greaterThanOrEqual':
      return { ...base, lower: { iso: lower!, inclusive: true } };
    case 'lessThan':
      return { ...base, upper: { iso: lower!, inclusive: false } };
    case 'lessThanOrEqual':
      return { ...base, upper: { iso: lower!, inclusive: true } };
    case 'between':
      return {
        ...base,
        lower: { iso: lower!, inclusive: true },
        upper: { iso: upper!, inclusive: true },
      };
    case 'notBetween':
      return {
        ...base,
        lower: { iso: lower!, inclusive: true },
        upper: { iso: upper!, inclusive: true },
      };
  }
}
