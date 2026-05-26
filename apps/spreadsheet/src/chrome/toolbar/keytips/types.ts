/**
 * KeyTip Types
 *
 * Type definitions for Excel's Alt-key navigation system (KeyTips).
 * Display-only after the keyboard action lives on the typed
 * `KeyboardShortcut` chord entries under
 * `apps/spreadsheet/src/keyboard/definitions/keytips-*.ts`. Entries
 * here only describe the badge to render (key, target element,
 * optional label).
 *
 */

/**
 * KeyTip mode states.
 *
 * Projected from the keyboard-coordinator's `ChordSnapshot` by
 * `KeyTipContext.tsx`. The shape is preserved across the
 * migration so existing consumers continue to compile, but the
 * `'awaiting'` state is no longer produced — the coordinator's chord
 * buffer represents partial sequences directly via candidate
 * shortcuts, so the overlay never renders an awaiting badge set.
 *
 * State machine:
 * inactive → showing (tabs) → showing (commands) → inactive
 */
export type KeyTipMode =
  | { state: 'inactive' }
  | { state: 'showing'; level: 'tabs' | 'commands'; activeTab?: string }
  | { state: 'awaiting'; sequence: string[] };

/**
 * KeyTip registry entry (display-only after).
 *
 * The `action` field that used to live here was deleted in; the
 * keyboard action for each chord is owned by the unified
 * `KeyboardShortcut` table. This type is now pure rendering data:
 * key, target element, optional tab grouping, optional label override.
 */
export interface KeyTipEntry {
  /** Single letter/number key (e.g., 'H', '1', 'B') */
  key: string;

  /** Which tab this keytip is on (undefined for tab-level keys) */
  tabId?: string;

  /** DOM element ID to highlight (for positioning the badge) */
  elementId: string;

  /** Optional nested keytips for split buttons/dropdowns */
  children?: KeyTipEntry[];

  /** Optional label to show in the badge (defaults to key) */
  label?: string;
}

/**
 * KeyTip badge position.
 * Computed from the element's bounding rect.
 */
export interface KeyTipBadgePosition {
  /** KeyTip entry */
  entry: KeyTipEntry;

  /** X coordinate (left) */
  x: number;

  /** Y coordinate (top) */
  y: number;
}
