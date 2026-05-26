/**
 * Diagnostic Validators
 *
 * Validate z-order consistency and group hierarchy integrity.
 */

import type { GroupHierarchy, GroupValidationIssue } from '../grouping/group-manager';
import { validateGroupHierarchy } from '../grouping/group-manager';
import type { ZOrderedItem } from '../z-order/z-order-manager';

// =============================================================================
// TYPES
// =============================================================================

/**
 * A single diagnostic issue.
 */
export interface DiagnosticIssue {
  /** Issue code for programmatic handling */
  code: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Human-readable description */
  message: string;
}

// =============================================================================
// Z-ORDER VALIDATION
// =============================================================================

/**
 * Validate z-order consistency.
 *
 * Checks:
 * - No duplicate z-indices
 * - No gaps in z-indices (after normalizing)
 * - No negative z-indices
 */
export function validateZOrder(items: ZOrderedItem[]): {
  valid: boolean;
  issues: DiagnosticIssue[];
} {
  const issues: DiagnosticIssue[] = [];

  if (items.length === 0) {
    return { valid: true, issues: [] };
  }

  // Check for negative z-indices
  for (const item of items) {
    if (item.zIndex < 0) {
      issues.push({
        code: 'DRAWING_ZORDER_NEGATIVE',
        severity: 'warning',
        message: `Object ${item.id} has negative z-index: ${item.zIndex}`,
      });
    }
  }

  // Check for duplicate z-indices
  const zIndexMap = new Map<number, string[]>();
  for (const item of items) {
    const existing = zIndexMap.get(item.zIndex) ?? [];
    existing.push(item.id);
    zIndexMap.set(item.zIndex, existing);
  }

  for (const [zIndex, ids] of zIndexMap) {
    if (ids.length > 1) {
      issues.push({
        code: 'DRAWING_ZORDER_DUPLICATE',
        severity: 'error',
        message: `Duplicate z-index ${zIndex} shared by: ${ids.join(', ')}`,
      });
    }
  }

  // Check for gaps
  const sorted = [...items].sort((a, b) => a.zIndex - b.zIndex);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].zIndex - sorted[i - 1].zIndex;
    if (gap > 1) {
      issues.push({
        code: 'DRAWING_ZORDER_GAP',
        severity: 'warning',
        message: `Gap in z-order between ${sorted[i - 1].id} (z=${sorted[i - 1].zIndex}) and ${sorted[i].id} (z=${sorted[i].zIndex})`,
      });
    }
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}

// =============================================================================
// GROUP VALIDATION
// =============================================================================

/**
 * Validate group hierarchy.
 *
 * Checks:
 * - No cycles
 * - No orphaned children
 * - No empty groups
 * - Consistency between groups.childIds and parentOf
 */
export function validateGroups(hierarchy: GroupHierarchy): {
  valid: boolean;
  issues: DiagnosticIssue[];
} {
  const result = validateGroupHierarchy(hierarchy);

  const codeToSeverity: Record<GroupValidationIssue['code'], DiagnosticIssue['severity']> = {
    cycle: 'error',
    empty: 'warning',
    orphan: 'error',
    inconsistent: 'error',
  };

  const codeToPrefix: Record<GroupValidationIssue['code'], string> = {
    cycle: 'DRAWING_GROUP_CYCLE',
    empty: 'DRAWING_GROUP_EMPTY',
    orphan: 'DRAWING_GROUP_ORPHAN',
    inconsistent: 'DRAWING_GROUP_INCONSISTENT',
  };

  const issues: DiagnosticIssue[] = result.issues.map((issue) => ({
    code: codeToPrefix[issue.code],
    severity: codeToSeverity[issue.code],
    message: issue.message,
  }));

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}
