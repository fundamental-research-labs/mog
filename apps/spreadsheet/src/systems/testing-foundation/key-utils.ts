/**
 * Key Utilities
 *
 * Shared keyboard combo utilities for testing.
 * Extracted from grid-editing/testing/key-action-map.ts.
 *
 * @module systems/testing-foundation
 */

import type { KeyModifiers } from './types';

// =============================================================================
// Key Combo Builder
// =============================================================================

/**
 * Build a normalized key combo string for lookup.
 * Format: "Ctrl+Shift+Alt+Meta+Key" (modifiers in fixed order, then key)
 */
export function buildKeyCombo(key: string, modifiers?: KeyModifiers): string {
  const parts: string[] = [];
  if (modifiers?.ctrl) parts.push('Ctrl');
  if (modifiers?.shift) parts.push('Shift');
  if (modifiers?.alt) parts.push('Alt');
  if (modifiers?.meta) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}
