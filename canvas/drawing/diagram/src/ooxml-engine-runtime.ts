/**
 * OOXML Engine Runtime Functions
 *
 * Factory functions and type guards extracted from
 * @mog-sdk/contracts/diagram/ooxml-engine-types.
 */

import type {
  Choose,
  ForEach,
  IfClause,
  LayoutNodeChild,
  LayoutNodeChildRef,
  OoxmlConstraint,
  OoxmlRule,
  VariableList,
} from '@mog-sdk/contracts/diagram';
import { VARIABLE_LIST_DEFAULTS } from '@mog-sdk/contracts/diagram';

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a default OoxmlConstraint with all fields set to their default values.
 *
 * @param overrides - Partial constraint fields to override defaults
 * @returns A fully populated OoxmlConstraint
 */
export function createDefaultConstraint(
  overrides: Partial<OoxmlConstraint> & Pick<OoxmlConstraint, 'type'>,
): OoxmlConstraint {
  return {
    type: overrides.type,
    for: overrides.for ?? 'self',
    forName: overrides.forName ?? '',
    refType: overrides.refType ?? 'none',
    refFor: overrides.refFor ?? 'self',
    refForName: overrides.refForName ?? '',
    op: overrides.op ?? 'none',
    val: overrides.val ?? 0,
    fact: overrides.fact ?? 1,
    ptType: overrides.ptType ?? 'all',
    refPtType: overrides.refPtType ?? 'all',
  };
}

/**
 * Create a default OoxmlRule with all fields set to their default values.
 *
 * @param overrides - Partial rule fields to override defaults
 * @returns A fully populated OoxmlRule
 */
export function createDefaultRule(
  overrides: Partial<OoxmlRule> & Pick<OoxmlRule, 'type'>,
): OoxmlRule {
  return {
    type: overrides.type,
    for: overrides.for ?? 'self',
    forName: overrides.forName ?? '',
    ptType: overrides.ptType ?? 'all',
    val: overrides.val ?? 0,
    fact: overrides.fact ?? 1,
    max: overrides.max ?? Infinity,
  };
}

/**
 * Create a default ForEach with all fields set to their default values.
 *
 * @param overrides - Partial forEach fields to override defaults
 * @returns A fully populated ForEach
 */
export function createDefaultForEach(overrides?: Partial<Omit<ForEach, 'kind'>>): ForEach {
  return {
    kind: 'forEach',
    name: overrides?.name ?? '',
    ref: overrides?.ref ?? '',
    axis: overrides?.axis ?? 'ch',
    ptType: overrides?.ptType ?? 'all',
    cnt: overrides?.cnt ?? 0,
    st: overrides?.st ?? 1,
    step: overrides?.step ?? 1,
    hideLastTrans: overrides?.hideLastTrans ?? true,
    children: overrides?.children ?? [],
  };
}

/**
 * Create a default Choose with all fields set to their default values.
 *
 * @param overrides - Partial choose fields to override defaults
 * @returns A fully populated Choose
 */
export function createDefaultChoose(overrides?: Partial<Omit<Choose, 'kind'>>): Choose {
  return {
    kind: 'choose',
    name: overrides?.name ?? '',
    ifClauses: overrides?.ifClauses ?? [],
    elseClauses: overrides?.elseClauses ?? null,
  };
}

/**
 * Create a default IfClause with all fields set to their default values.
 *
 * @param overrides - Partial if-clause fields to override defaults
 * @returns A fully populated IfClause
 */
export function createDefaultIfClause(
  overrides: Partial<IfClause> & Pick<IfClause, 'func' | 'op' | 'val'>,
): IfClause {
  return {
    name: overrides.name ?? '',
    func: overrides.func,
    arg: overrides.arg ?? 'none',
    op: overrides.op,
    val: overrides.val,
    axis: overrides.axis ?? 'none',
    ptType: overrides.ptType ?? 'all',
    cnt: overrides.cnt ?? 0,
    st: overrides.st ?? 1,
    step: overrides.step ?? 1,
    hideLastTrans: overrides.hideLastTrans ?? true,
    children: overrides.children ?? [],
  };
}

/**
 * Create a default VariableList with all fields set to their specification defaults.
 *
 * @param overrides - Partial variable list fields to override defaults
 * @returns A fully populated VariableList
 */
export function createDefaultVariableList(overrides?: Partial<VariableList>): VariableList {
  return {
    ...VARIABLE_LIST_DEFAULTS,
    ...overrides,
  };
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a LayoutNodeChild is a ForEach element.
 *
 * @param child - The layout node child to check
 * @returns True if the child is a ForEach element
 */
export function isForEach(child: LayoutNodeChild): child is ForEach {
  return child.kind === 'forEach';
}

/**
 * Type guard to check if a LayoutNodeChild is a Choose element.
 *
 * @param child - The layout node child to check
 * @returns True if the child is a Choose element
 */
export function isChoose(child: LayoutNodeChild): child is Choose {
  return child.kind === 'choose';
}

/**
 * Type guard to check if a LayoutNodeChild is a LayoutNode reference.
 *
 * @param child - The layout node child to check
 * @returns True if the child is a LayoutNode reference
 */
export function isLayoutNodeChild(child: LayoutNodeChild): child is LayoutNodeChildRef {
  return child.kind === 'layoutNode';
}
