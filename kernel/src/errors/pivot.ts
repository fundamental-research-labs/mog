import { KernelError } from './kernel-error';

export interface PivotNotFoundContext {
  pivotName: string;
  sheetId?: string;
}

export interface PivotStaleHandleContext {
  operation: string;
  pivotId: string;
  sheetId?: string;
}

export interface PivotInvalidDataSourceContext {
  pivotName: string;
  dataSource: string;
  reason: string;
  sheetName?: string;
  range?: string;
}

export type PivotInvalidReferenceKind =
  | 'placement'
  | 'filterField'
  | 'topBottomValueField'
  | 'sortByValueField'
  | 'showValuesAsBaseField'
  | 'calculatedField'
  | 'calculatedFieldFormula'
  | 'ambiguousDuplicateHeader';

interface PivotInvalidReferenceBase {
  path: string;
  source: string;
  fieldName?: string;
  area?: string;
  oldResolution?: unknown;
  newResolution?: unknown;
}

export type PivotConcreteInvalidReferenceKind = Exclude<
  PivotInvalidReferenceKind,
  'ambiguousDuplicateHeader' | 'calculatedFieldFormula'
>;

export interface PivotConcreteInvalidReference extends PivotInvalidReferenceBase {
  kind: PivotConcreteInvalidReferenceKind;
  fieldId: string;
  identifier?: string;
  candidates?: string[];
}

export interface PivotAmbiguousDuplicateHeaderInvalidReference extends PivotInvalidReferenceBase {
  kind: 'ambiguousDuplicateHeader';
  identifier: string;
  candidates: string[];
}

export interface PivotCalculatedFieldFormulaInvalidReference extends PivotInvalidReferenceBase {
  kind: 'calculatedFieldFormula';
  identifier: string;
  candidates?: string[];
}

export type PivotInvalidReference =
  | PivotConcreteInvalidReference
  | PivotAmbiguousDuplicateHeaderInvalidReference
  | PivotCalculatedFieldFormulaInvalidReference;

export interface PivotUnresolvedFieldReferencesContext {
  pivotName: string;
  dataSource: string;
  invalidReferences: PivotInvalidReference[];
}

export interface PivotAmbiguousPlacementContext {
  pivotName: string;
  identifier: string;
  operation: string;
  candidates: string[];
}

export function createPivotNotFoundError(context: PivotNotFoundContext): KernelError {
  return new KernelError('PIVOT_NOT_FOUND', `Pivot table "${context.pivotName}" not found`, {
    context: { ...context },
  });
}

export function createPivotStaleHandleError(context: PivotStaleHandleContext): KernelError {
  return new KernelError(
    'PIVOT_NOT_FOUND',
    `${context.operation}: Pivot handle "${context.pivotId}" is stale or invalidated.`,
    { context: { ...context } },
  );
}

export function createPivotInvalidDataSourceError(
  context: PivotInvalidDataSourceContext,
): KernelError {
  return new KernelError(
    'PIVOT_INVALID_DATA_SOURCE',
    `Invalid pivot data source "${context.dataSource}": ${context.reason}`,
    { context: { ...context } },
  );
}

export function createPivotUnresolvedFieldReferencesError(
  context: PivotUnresolvedFieldReferencesContext,
): KernelError {
  return new KernelError(
    'PIVOT_UNRESOLVED_FIELD_REFERENCES',
    `Pivot table "${context.pivotName}" has unresolved field references for "${context.dataSource}"`,
    { context: { ...context } },
  );
}

export function createPivotAmbiguousPlacementError(
  context: PivotAmbiguousPlacementContext,
): KernelError {
  return new KernelError(
    'PIVOT_UNRESOLVED_FIELD_REFERENCES',
    `Pivot table "${context.pivotName}" has ambiguous placement reference "${context.identifier}" for ${context.operation}`,
    { context: { ...context } },
  );
}
