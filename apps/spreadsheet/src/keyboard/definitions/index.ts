/**
 * Unified Keyboard Shortcut Definitions Index
 *
 * This file combines all category-specific shortcut arrays into the
 * unified KEYBOARD_SHORTCUTS registry using the new physical-key-based model.
 *
 * The new system uses physical key codes (KeyboardEvent.code) instead of
 * character output (KeyboardEvent.key), which fixes the Ctrl++ bug and
 * enables proper international keyboard support.
 *
 * Categories:
 * - navigation: Moving around the sheet (34 shortcuts)
 * - selection: Selecting cells/ranges (28 shortcuts)
 * - editing: Entering/modifying data (57 shortcuts)
 * - clipboard: Cut/copy/paste (9 shortcuts)
 * - formatting: Cell formatting (20 shortcuts)
 * - formula: Formula operations (20 shortcuts)
 * - comments: Comment operations (4 shortcuts)
 * - data: Data operations (16 shortcuts)
 * - view: View controls (13 shortcuts)
 * - workbook: File/sheet operations (13 shortcuts)
 * - object: Floating object operations (28 shortcuts)
 * - accessibility: Accessibility features (4 shortcuts)
 * - kanban: Kanban view shortcuts (10 shortcuts)
 * - gallery: Gallery view shortcuts (9 shortcuts)
 * - calendar: Calendar view shortcuts (4 shortcuts)
 * - timeline: Timeline view shortcuts (4 shortcuts)
 *
 * Total: 274 shortcuts (59 key-based + 215 code-based)
 * Run `npx tsx scripts/verify-shortcut-matchby.ts` for latest counts
 *
 */

import type { KeyboardShortcut } from '../types';

import { ACCESSIBILITY_SHORTCUTS } from './accessibility';
import { CALENDAR_SHORTCUTS } from './calendar';
import { CLIPBOARD_SHORTCUTS } from './clipboard';
import { COMMENTS_SHORTCUTS } from './comments';
import { DATA_SHORTCUTS } from './data';
import { EDITING_SHORTCUTS } from './editing';
import { FLASH_FILL_SHORTCUTS } from './flash-fill';
import { FORMATTING_SHORTCUTS } from './formatting';
import { FORMULA_SHORTCUTS } from './formula';
import { GALLERY_SHORTCUTS } from './gallery';
import { KANBAN_SHORTCUTS } from './kanban';
// Unified keytip router: per-tab keytip chord shortcut tables
import { KEYTIPS_DATA_SHORTCUTS } from './keytips-data';
import { KEYTIPS_FORMULAS_SHORTCUTS } from './keytips-formulas';
import { KEYTIPS_HOME_GROUPS_SHORTCUTS } from './keytips-home-groups';
import { KEYTIPS_HOME_SHORTCUTS } from './keytips-home';
import { KEYTIPS_INSERT_SHORTCUTS } from './keytips-insert';
import { KEYTIPS_PAGE_SHORTCUTS } from './keytips-page';
import { KEYTIPS_REVIEW_SHORTCUTS } from './keytips-review';
import { KEYTIPS_TABLE_DESIGN_SHORTCUTS } from './keytips-table-design';
import { KEYTIPS_VIEW_SHORTCUTS } from './keytips-view';
import { NAVIGATION_SHORTCUTS } from './navigation';
import { OBJECT_SHORTCUTS } from './object';
import { RIBBON_SHORTCUTS } from './ribbon';
import { SELECTION_SHORTCUTS } from './selection';
import { TIMELINE_SHORTCUTS } from './timeline';
import { VIEW_SHORTCUTS } from './view';
import { WORKBOOK_SHORTCUTS } from './workbook';

/**
 * The complete unified keyboard shortcut registry (v2).
 *
 * This is THE canonical list of all Excel keyboard shortcuts using
 * the new physical-key-based model.
 *
 * KEY DIFFERENCES FROM V1:
 * - Uses physical key codes (e.code) instead of character output (e.key)
 * - Fixes Ctrl++, Ctrl+-, and other shifted-character shortcuts
 * - Supports international keyboards (German, French, Japanese, etc.)
 * - Distinguishes numpad keys from main keyboard
 * - Each shortcut has a unique 'id' for tracking and customization
 * - Multiple contexts per shortcut (array instead of single value)
 * - Explicit 'enabled' flag (replaces 'implemented' boolean)
 *
 * ARCHITECTURE NOTES:
 * - `action` maps to action dispatcher events
 * - `contexts` determine when the shortcut is active
 * - `priority` resolves conflicts when same key is used in overlapping contexts
 * - `browserConflict` documents shortcuts that conflict with browser defaults
 */
export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  // FLASH_FILL_SHORTCUTS must come before NAVIGATION/EDITING/CLIPBOARD so its
  // Enter/Tab/Escape bindings (priority: critical) win the equal-priority
  // tie-break in the byCode bucket — see matcher.findInBucket: stable sort
  // preserves registration order within a priority class. Without this, the
  // popup couldn't override grid's enter-navigate / tab-forward / clear-
  // clipboard at the same priority.
  ...FLASH_FILL_SHORTCUTS,
  ...NAVIGATION_SHORTCUTS,
  ...SELECTION_SHORTCUTS,
  ...EDITING_SHORTCUTS,
  ...CLIPBOARD_SHORTCUTS,
  ...FORMATTING_SHORTCUTS,
  ...FORMULA_SHORTCUTS,
  ...COMMENTS_SHORTCUTS,
  ...DATA_SHORTCUTS,
  ...VIEW_SHORTCUTS,
  ...WORKBOOK_SHORTCUTS,
  ...OBJECT_SHORTCUTS,
  ...ACCESSIBILITY_SHORTCUTS,
  ...KANBAN_SHORTCUTS,
  ...GALLERY_SHORTCUTS,
  ...CALENDAR_SHORTCUTS,
  ...TIMELINE_SHORTCUTS,
  // Unified keytip router: chord-shortcut tables (Alt+letter
  // ribbon-tab switches and Home-tab keytip chords). These rely on
  // 's `sequence` follow-on contract and 's coordinator chord
  // buffer.
  ...RIBBON_SHORTCUTS,
  ...KEYTIPS_HOME_SHORTCUTS,
  // per-tab keytip chord shortcut tables (rest of the ribbon)
  ...KEYTIPS_HOME_GROUPS_SHORTCUTS,
  ...KEYTIPS_INSERT_SHORTCUTS,
  ...KEYTIPS_FORMULAS_SHORTCUTS,
  ...KEYTIPS_DATA_SHORTCUTS,
  ...KEYTIPS_REVIEW_SHORTCUTS,
  ...KEYTIPS_VIEW_SHORTCUTS,
  ...KEYTIPS_PAGE_SHORTCUTS,
  ...KEYTIPS_TABLE_DESIGN_SHORTCUTS,
];

// Re-export individual category arrays for targeted access
export {
  ACCESSIBILITY_SHORTCUTS,
  CALENDAR_SHORTCUTS,
  CLIPBOARD_SHORTCUTS,
  COMMENTS_SHORTCUTS,
  DATA_SHORTCUTS,
  EDITING_SHORTCUTS,
  FLASH_FILL_SHORTCUTS,
  FORMATTING_SHORTCUTS,
  FORMULA_SHORTCUTS,
  GALLERY_SHORTCUTS,
  KANBAN_SHORTCUTS,
  KEYTIPS_DATA_SHORTCUTS,
  KEYTIPS_FORMULAS_SHORTCUTS,
  KEYTIPS_HOME_GROUPS_SHORTCUTS,
  KEYTIPS_HOME_SHORTCUTS,
  KEYTIPS_INSERT_SHORTCUTS,
  KEYTIPS_PAGE_SHORTCUTS,
  KEYTIPS_REVIEW_SHORTCUTS,
  KEYTIPS_TABLE_DESIGN_SHORTCUTS,
  KEYTIPS_VIEW_SHORTCUTS,
  NAVIGATION_SHORTCUTS,
  OBJECT_SHORTCUTS,
  RIBBON_SHORTCUTS,
  SELECTION_SHORTCUTS,
  TIMELINE_SHORTCUTS,
  VIEW_SHORTCUTS,
  WORKBOOK_SHORTCUTS,
};

// Re-export types for convenience
export type { KeyboardShortcut };

/**
 * Validate that all shortcuts have unique IDs.
 *
 * This is a development-time check to catch duplicate IDs.
 * Call this in tests or during app initialization.
 *
 * @returns Array of duplicate IDs found (empty if valid)
 */
export function validateShortcutIds(): string[] {
  const idCounts = new Map<string, number>();

  for (const shortcut of KEYBOARD_SHORTCUTS) {
    const count = idCounts.get(shortcut.id) ?? 0;
    idCounts.set(shortcut.id, count + 1);
  }

  const duplicates: string[] = [];
  for (const [id, count] of idCounts) {
    if (count > 1) {
      duplicates.push(`${id} (${count}x)`);
    }
  }

  return duplicates;
}

/**
 * Get shortcuts by category.
 *
 * @param category - The category to filter by
 * @returns Array of shortcuts in that category
 */
export function getShortcutsByCategory(category: KeyboardShortcut['category']): KeyboardShortcut[] {
  return KEYBOARD_SHORTCUTS.filter((s) => s.category === category);
}

/**
 * Get shortcuts by context.
 *
 * @param context - The context to filter by
 * @returns Array of shortcuts active in that context
 */
export function getShortcutsByContext(
  context: KeyboardShortcut['contexts'][number],
): KeyboardShortcut[] {
  return KEYBOARD_SHORTCUTS.filter(
    (s) => s.contexts.includes(context) || s.contexts.includes('any'),
  );
}

/**
 * Get a shortcut by ID.
 *
 * @param id - The shortcut ID
 * @returns The shortcut, or undefined if not found
 */
export function getShortcutById(id: string): KeyboardShortcut | undefined {
  return KEYBOARD_SHORTCUTS.find((s) => s.id === id);
}

/**
 * Get statistics about the shortcut registry.
 */
export function getShortcutStats(): {
  total: number;
  enabled: number;
  disabled: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  byMuscleMemory: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byMuscleMemory: Record<string, number> = {};

  let enabled = 0;
  let disabled = 0;

  for (const shortcut of KEYBOARD_SHORTCUTS) {
    if (shortcut.enabled) {
      enabled++;
    } else {
      disabled++;
    }

    byCategory[shortcut.category] = (byCategory[shortcut.category] ?? 0) + 1;
    byPriority[shortcut.priority] = (byPriority[shortcut.priority] ?? 0) + 1;

    byMuscleMemory[shortcut.muscleMemory] = (byMuscleMemory[shortcut.muscleMemory] ?? 0) + 1;
  }

  return {
    total: KEYBOARD_SHORTCUTS.length,
    enabled,
    disabled,
    byCategory,
    byPriority,
    byMuscleMemory,
  };
}
