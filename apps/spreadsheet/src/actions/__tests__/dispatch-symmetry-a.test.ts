/**
 * Dispatch Symmetry — text formatting scope (Text Formatting Groups)
 *
 * Text formatting dispatch asserts that every text-formatting action
 * migrated from a `useXActions` hook to dispatch has a real handler
 * registered in HANDLER_MAP. This is the code-level gate that catches the
 * "hook deleted but call site references a missing handler" and "ActionType
 * added but handler not registered" error classes (UX-FIX-PRINCIPLES §51).
 *
 * The list mirrors the orchestrator's symmetry-test deliverable for
 * text formatting scope (FontGroup, AlignmentGroup, NumberGroup, StylesGroup,
 * AlignmentTab, use-context-menu-actions). The orchestrator's list used
 * `MERGE_CELLS`, `SET_PERCENT`, `SET_CURRENCY`, `SET_COMMA` as the spec
 * names; only `MERGE_CELLS` is the actual ActionType (see
 * action-types.ts) — `SET_PERCENT`/`SET_CURRENCY`/`SET_COMMA` map to the
 * existing `FORMAT_PERCENTAGE`/`FORMAT_CURRENCY`/`FORMAT_COMMA` handlers,
 * which are the real action names this test enforces.
 *
 * @see docs/spreadsheet/ARCHITECTURE-CHECKLIST.md §1, §2
 */

import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType } from '@mog-sdk/contracts/actions';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Static-import note: we do not import the dispatcher module here. Jest's
// experimental ESM loader hits a "module is already linked" error when the
// dispatcher's deep import graph (~50 handler modules across 100+ ActionType
// entries) is loaded in-process; this is a pre-existing baseline issue that
// also affects `read-only-mode.test.ts`. Instead, this test does a static
// structural scan of `dispatcher.ts`: every text formatting scope action must appear
// as a HANDLER_MAP key with a non-`notImplemented` value. The compile-time
// `ActionType` constraint on the action list still locks the test against
// typo/rename drift, and the dispatcher's `Record<ActionType, ...>` typing
// independently enforces handler completeness at build time.

const SUB_SCOPE_A_ACTIONS: ActionType[] = [
  // FontGroup
  'TOGGLE_BOLD',
  'TOGGLE_ITALIC',
  'TOGGLE_UNDERLINE',
  'TOGGLE_STRIKETHROUGH',
  'SET_FONT_FAMILY',
  'SET_FONT_SIZE',
  'INCREASE_FONT_SIZE',
  'DECREASE_FONT_SIZE',
  'SET_FONT_COLOR',
  'SET_BACKGROUND_COLOR',
  'APPLY_BORDERS',
  'CLEAR_FORMATS',

  // AlignmentGroup + AlignmentTab dialog
  'SET_HORIZONTAL_ALIGN',
  'SET_VERTICAL_ALIGN',
  'TOGGLE_WRAP_TEXT',
  'SET_TEXT_ROTATION',
  'INCREASE_INDENT',
  'DECREASE_INDENT',

  // Merge family — 4 cases owned by text formatting scope (AlignmentGroup, dialog,
  // and context menu all dispatch these). MERGE_CELLS is the
  // rename of MERGE_CELLS_WITH_WARNING with the centering bug removed; see
  // merge-operations.ts for the handler.
  'MERGE_AND_CENTER',
  'MERGE_CELLS',
  'MERGE_ACROSS',
  'UNMERGE_CELLS',

  // NumberGroup
  'SET_NUMBER_FORMAT',
  'FORMAT_CURRENCY', // orchestrator alias: SET_CURRENCY
  'FORMAT_PERCENTAGE', // orchestrator alias: SET_PERCENT
  'FORMAT_COMMA', // orchestrator alias: SET_COMMA
  'INCREASE_DECIMALS',
  'DECREASE_DECIMALS',
];

// Read dispatcher.ts source once. We grep for `ACTION: HandlerNamespace.X,`
// patterns inside the HANDLER_MAP literal — that's the canonical structural
// statement that counts as "registered in HANDLER_MAP".
const DISPATCHER_SOURCE = readFileSync(path.resolve(__dirname, '..', 'dispatcher.ts'), 'utf8');

/**
 * Match `<ACTION>:` lines that look like real registrations (i.e.
 * not the `notImplemented` placeholder). The HANDLER_MAP literal in
 * dispatcher.ts uses the form `ACTION_NAME: SomeHandlers.ACTION_NAME,` for
 * every implemented entry; placeholder rows look like
 * `ACTION_NAME: notImplemented,` and are filtered out.
 */
function isHandlerRegistered(action: string): boolean {
  // `<action>:` followed by something other than `notImplemented`. Allow
  // whitespace/newlines after the colon. Anchor on a leading whitespace
  // boundary so prefixed action names (e.g. SET_TOP_BORDER vs
  // SET_TOP_AND_BOTTOM_BORDERS) don't false-match.
  const real = new RegExp(`(^|\\s)${action}:\\s*(?!notImplemented[,\\s])`, 'm');
  if (!real.test(DISPATCHER_SOURCE)) return false;
  // Negative check: ensure we're not staring at a placeholder pinned exactly
  // to this action name. Combined with the lookbehind above, an entry that
  // points to a real handler module passes.
  const placeholder = new RegExp(`(^|\\s)${action}:\\s*notImplemented[,\\s]`, 'm');
  return !placeholder.test(DISPATCHER_SOURCE);
}

describe('dispatch symmetry — text formatting scope (text formatting)', () => {
  test.each(SUB_SCOPE_A_ACTIONS)(
    'HANDLER_MAP has a real (non-placeholder) handler for %s',
    (action) => {
      // Two failure modes covered:
      // 1. ActionType union member exists but no entry in HANDLER_MAP
      // (compile-time TS error at the dispatcher prevents this normally,
      // but the structural scan is the runtime backstop).
      // 2. HANDLER_MAP entry is the `notImplemented` placeholder — i.e. the
      // ActionType is typed-but-unhandled.
      expect(isHandlerRegistered(action)).toBe(true);
    },
  );

  test('every action in the list is a valid ActionType (compile-time guard)', () => {
    // The typed array literal above gives the compile-time guard. This
    // runtime assertion just locks in that the list is non-empty so a
    // refactor that empties it would surface as a hard test failure.
    expect(SUB_SCOPE_A_ACTIONS.length).toBeGreaterThan(0);
  });
});
