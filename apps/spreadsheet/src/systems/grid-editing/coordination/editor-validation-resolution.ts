import type { ValidationRule, Worksheet } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { CellEditorType } from '@mog-sdk/contracts/editor';
import type { CellSchema, SchemaConstraints } from '@mog-sdk/contracts/schema';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type { EditorActor } from '../machines/grid-editor-machine';

export interface ValidationEditorConfig {
  editorType: CellEditorType;
  cellSchema: CellSchema;
  enumItems: unknown[] | null;
}

export type ValidationEditorResolution =
  | { state: 'ready'; config: ValidationEditorConfig | null }
  | { state: 'cold' }
  | { state: 'current-stale' }
  | { state: 'failed'; reason: 'lookup-failed' | 'unsupported' };

export type ValidationEditorApplyResolution = ValidationEditorResolution | { state: 'superseded' };

export interface ValidationEditorRequest {
  sheetId: SheetId;
  cell: CellCoord;
  generation: number;
  openDropdown?: boolean;
  isCurrent: (generation: number) => boolean;
  editorActor: EditorActor;
}

type ValidationLookupFreshness = {
  ruleFingerprint: string | null;
  dataRevision?: string | number;
} | null;

function schemaTypeForRule(rule: ValidationRule): CellSchema['type'] {
  switch (rule.type) {
    case 'wholeNumber':
      return 'integer';
    case 'decimal':
      return 'number';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'custom':
      return 'any';
    case 'list':
    case 'textLength':
    default:
      return 'string';
  }
}

function dateStringToSerial(value: string | number): number {
  if (typeof value === 'number') return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return Number(value);
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.floor(utc / 86_400_000) + 25569;
}

function timeStringToSerial(value: string | number): number {
  if (typeof value === 'number') return value;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return Number(value);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] == null ? 0 : Number(match[3]);
  return (hours * 3600 + minutes * 60 + seconds) / 86_400;
}

function numericConstraintValue(rule: ValidationRule, value: string | number): number {
  if (rule.type === 'date') return dateStringToSerial(value);
  if (rule.type === 'time') return timeStringToSerial(value);
  return Number(value);
}

function applyOperatorConstraints(rule: ValidationRule, constraints: SchemaConstraints): void {
  if (rule.formula1 == null) return;

  if (rule.type === 'list') {
    if (constraints.enum == null && typeof rule.formula1 === 'string') {
      const source = rule.formula1.trim();
      const body = source.startsWith('=') ? source.slice(1) : source;
      if (body.includes(':')) {
        constraints.enumSourceFormula = source.startsWith('=') ? source : `=${source}`;
      } else {
        constraints.enum = body.split(',').map((item) => item.trim());
      }
    }
    return;
  }

  if (rule.type === 'custom') {
    constraints.formula = String(rule.formula1);
    return;
  }

  const v1 = numericConstraintValue(rule, rule.formula1);
  const v2 = rule.formula2 == null ? undefined : numericConstraintValue(rule, rule.formula2);

  if (rule.type === 'textLength') {
    switch (rule.operator) {
      case 'equal':
        constraints.minLength = v1;
        constraints.maxLength = v1;
        break;
      case 'greaterThan':
        constraints.minLength = v1 + 1;
        break;
      case 'lessThan':
        constraints.maxLength = v1 - 1;
        break;
      case 'greaterThanOrEqual':
        constraints.minLength = v1;
        break;
      case 'lessThanOrEqual':
        constraints.maxLength = v1;
        break;
      case 'between':
        constraints.minLength = v1;
        if (v2 != null) constraints.maxLength = v2;
        break;
      case 'notBetween':
        constraints.notBetweenMin = v1;
        if (v2 != null) constraints.notBetweenMax = v2;
        break;
    }
    return;
  }

  switch (rule.operator) {
    case 'equal':
      constraints.equal = v1;
      break;
    case 'notEqual':
      constraints.notEqual = v1;
      break;
    case 'greaterThan':
      constraints.exclusiveMin = v1;
      break;
    case 'lessThan':
      constraints.exclusiveMax = v1;
      break;
    case 'greaterThanOrEqual':
      constraints.min = v1;
      break;
    case 'lessThanOrEqual':
      constraints.max = v1;
      break;
    case 'between':
      constraints.min = v1;
      if (v2 != null) constraints.max = v2;
      break;
    case 'notBetween':
      constraints.notBetweenMin = v1;
      if (v2 != null) constraints.notBetweenMax = v2;
      break;
  }
}

export function resolveEditorType(rule: ValidationRule): CellEditorType {
  if (rule.type === 'list' && rule.showDropdown !== false) return 'dropdown';
  if (rule.type === 'date') return 'date';
  return 'text';
}

export function isPickerBackedValidation(rule: ValidationRule | null | undefined): boolean {
  return !!rule && ((rule.type === 'list' && rule.showDropdown !== false) || rule.type === 'date');
}

export function validationRuleToCellSchema(rule: ValidationRule): CellSchema {
  const constraints: SchemaConstraints = {};
  if (rule.allowBlank != null) constraints.allowBlank = rule.allowBlank;
  if (!rule.allowBlank) constraints.required = true;
  if (rule.type === 'list' && rule.values) constraints.enum = rule.values;
  if (rule.type === 'list' && rule.listSource && constraints.enum == null) {
    constraints.enumSourceFormula = rule.listSource.startsWith('=')
      ? rule.listSource
      : `=${rule.listSource}`;
  }
  applyOperatorConstraints(rule, constraints);
  return {
    type: schemaTypeForRule(rule),
    ...(Object.keys(constraints).length > 0 ? { constraints } : {}),
  };
}

export function validationRuleFingerprint(rule: ValidationRule | null): string | null {
  if (!rule) return null;
  return JSON.stringify({
    id: rule.id,
    range: rule.range,
    type: rule.type,
    operator: rule.operator,
    formula1: rule.formula1,
    formula2: rule.formula2,
    values: rule.values,
    listSource: rule.listSource,
    showDropdown: rule.showDropdown,
    allowBlank: rule.allowBlank,
  });
}

function configFromRule(rule: ValidationRule, enumItems: unknown[] | null): ValidationEditorConfig {
  return {
    editorType: resolveEditorType(rule),
    cellSchema: validationRuleToCellSchema(rule),
    enumItems,
  };
}

function readyConfigFromRule(rule: ValidationRule): ValidationEditorResolution {
  if (rule.type === 'none') return { state: 'ready', config: null };
  if (rule.type === 'list' && rule.showDropdown !== false) {
    if (Array.isArray(rule.values)) {
      return { state: 'ready', config: configFromRule(rule, rule.values) };
    }
    return { state: 'cold' };
  }
  return { state: 'ready', config: configFromRule(rule, null) };
}

export function peekValidationEditorConfig(
  ws: Pick<Worksheet, 'validations'>,
  row: number,
  col: number,
): ValidationEditorResolution {
  try {
    const rule = ws.validations.peek(row, col);
    if (rule === undefined) return { state: 'cold' };
    if (rule === null) return { state: 'ready', config: null };
    return readyConfigFromRule(rule);
  } catch {
    return { state: 'failed', reason: 'lookup-failed' };
  }
}

async function getDropdownItemsWithFreshness(
  ws: Pick<Worksheet, 'validations'>,
  row: number,
  col: number,
): Promise<{ items: unknown[]; dataRevision?: string | number }> {
  const validations = ws.validations as typeof ws.validations & {
    getDropdownItemsWithRevision?: (
      row: number,
      col: number,
    ) => Promise<{ items: unknown[]; dataRevision: string | number }>;
  };
  if (validations.getDropdownItemsWithRevision) {
    return validations.getDropdownItemsWithRevision(row, col);
  }
  return { items: await ws.validations.getDropdownItems(row, col) };
}

export async function hydrateValidationEditorConfig(
  ws: Pick<Worksheet, 'validations'>,
  row: number,
  col: number,
  freshness?: ValidationLookupFreshness,
): Promise<ValidationEditorResolution> {
  try {
    let rule = ws.validations.peek(row, col);
    if (rule === undefined) {
      rule = await ws.validations.get(row, col);
    }

    const currentFingerprint = validationRuleFingerprint(rule ?? null);
    if (freshness && freshness.ruleFingerprint !== currentFingerprint) {
      return { state: 'current-stale' };
    }

    if (!rule || rule.type === 'none') return { state: 'ready', config: null };

    if (rule.type === 'list' && rule.showDropdown !== false && !Array.isArray(rule.values)) {
      const fingerprintBeforeItems = validationRuleFingerprint(rule);
      const { items, dataRevision } = await getDropdownItemsWithFreshness(ws, row, col);
      const currentRule = ws.validations.peek(row, col) ?? (await ws.validations.get(row, col));
      if (validationRuleFingerprint(currentRule ?? null) !== fingerprintBeforeItems) {
        return { state: 'current-stale' };
      }
      if (freshness?.dataRevision != null && dataRevision !== freshness.dataRevision) {
        return { state: 'current-stale' };
      }
      return {
        state: 'ready',
        config: configFromRule(rule, items),
      };
    }

    return readyConfigFromRule(rule);
  } catch {
    return { state: 'failed', reason: 'lookup-failed' };
  }
}

function sameNormalEditingTarget(request: ValidationEditorRequest): boolean {
  if (!request.isCurrent(request.generation)) return false;
  const state = request.editorActor.getSnapshot();
  const editingCell = state.context.editingCell;
  return (
    state.matches('editing') &&
    state.context.sheetId === request.sheetId &&
    editingCell?.row === request.cell.row &&
    editingCell.col === request.cell.col
  );
}

function applyConfig(
  request: ValidationEditorRequest,
  config: ValidationEditorConfig | null,
): void {
  if (!sameNormalEditingTarget(request)) return;
  if (config) {
    request.editorActor.send({
      type: 'SET_EDITOR_TYPE',
      editorType: config.editorType,
      cellSchema: config.cellSchema,
      enumItems: config.enumItems,
    });
    return;
  }
  if (request.openDropdown) {
    request.editorActor.send({ type: 'CLEAR_PENDING_PICKER_INTENT' });
  }
}

export async function resolveAndApplyValidationEditorConfig(
  ws: Pick<Worksheet, 'validations'>,
  request: ValidationEditorRequest,
): Promise<ValidationEditorApplyResolution> {
  const peeked = peekValidationEditorConfig(ws, request.cell.row, request.cell.col);
  if (!sameNormalEditingTarget(request)) return { state: 'superseded' };

  if (peeked.state === 'ready') {
    applyConfig(request, peeked.config);
    return peeked;
  }

  if (peeked.state === 'failed') {
    applyConfig(request, null);
    return peeked;
  }

  const hydrated = await hydrateValidationEditorConfig(ws, request.cell.row, request.cell.col);
  if (!sameNormalEditingTarget(request)) return { state: 'superseded' };

  if (hydrated.state === 'current-stale') {
    const fresh = await hydrateValidationEditorConfig(ws, request.cell.row, request.cell.col);
    if (!sameNormalEditingTarget(request)) return { state: 'superseded' };
    if (fresh.state === 'ready') applyConfig(request, fresh.config);
    else if (fresh.state === 'failed') applyConfig(request, null);
    return fresh;
  }

  if (hydrated.state === 'ready') applyConfig(request, hydrated.config);
  else if (hydrated.state === 'failed') applyConfig(request, null);
  return hydrated;
}
