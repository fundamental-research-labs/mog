/**
 * Insert ribbon dispatch — Dispatch symmetry test
 *
 * Enumerates every action that the Editing/Cells/Clipboard groups and
 * the Insert ribbon dispatch after the insert ribbon scope migration.
 * Asserts that each action has a real handler registered in
 * `HANDLER_MAP` (not the `notImplemented` sentinel).
 *
 * Catches two error classes:
 * - "hook deleted but the migrated call site references a missing action"
 * - "ActionType added to the union but no handler was registered"
 *
 * If a future PR removes a handler entry but leaves the call site behind,
 * this test fails before app-eval would.
 *
 */

import type { ActionType } from '@mog-sdk/contracts/actions';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DISPATCHER_SOURCE = readFileSync(path.resolve(__dirname, '..', 'dispatcher.ts'), 'utf8');

function isActionImplemented(action: string): boolean {
  const real = new RegExp(`(^|\\s)${action}:\\s*(?!notImplemented[,\\s])`, 'm');
  if (!real.test(DISPATCHER_SOURCE)) return false;
  const placeholder = new RegExp(`(^|\\s)${action}:\\s*notImplemented[,\\s]`, 'm');
  return !placeholder.test(DISPATCHER_SOURCE);
}

// =============================================================================
// Migrated action enumeration
//
// The list mirrors the action names dispatched by:
// - apps/spreadsheet/src/chrome/toolbar/groups/CellsGroup.tsx
// - apps/spreadsheet/src/chrome/toolbar/groups/EditingGroup.tsx
// - apps/spreadsheet/src/chrome/toolbar/groups/ClipboardGroup.tsx
// - apps/spreadsheet/src/chrome/toolbar/tabs/InsertRibbon.tsx
// - apps/spreadsheet/src/chrome/toolbar/tabs/FormulasRibbon.tsx (AutoSum dropdown)
//
// Keep in sync with those files. A divergence is a real bug.
// =============================================================================

/** EditingGroup actions: AutoSum, Fill, Clear, Sort/Filter, Find/GoTo. */
const EDITING_GROUP_ACTIONS: ActionType[] = [
  'AUTO_SUM',
  'INSERT_AUTO_FUNCTION',
  'FILL_DOWN',
  'FILL_UP',
  'FILL_LEFT',
  'FILL_RIGHT',
  'OPEN_FILL_SERIES_DIALOG',
  'CLEAR_ALL',
  'CLEAR_FORMATS',
  'CLEAR_CONTENTS',
  'CLEAR_COMMENTS',
  'SORT_ASCENDING',
  'SORT_DESCENDING',
  'TOGGLE_AUTO_FILTER',
  'OPEN_FIND_DIALOG',
  'OPEN_GO_TO_DIALOG',
  'OPEN_GO_TO_SPECIAL_DIALOG',
];

/** CellsGroup actions: insert/delete + dimension + visibility. */
const CELLS_GROUP_ACTIONS: ActionType[] = [
  'INSERT_CELLS_SHIFT_DOWN',
  'INSERT_CUT_CELLS_SHIFT_DOWN',
  'OPEN_INSERT_CELLS_DIALOG',
  'INSERT_ROW_ABOVE',
  'INSERT_COLUMN_LEFT',
  'INSERT_SHEET',
  'OPEN_DELETE_CELLS_DIALOG',
  'DELETE_ROWS',
  'DELETE_COLUMNS',
  'DELETE_SHEET',
  'OPEN_ROW_HEIGHT_DIALOG',
  'AUTO_FIT_ROW_HEIGHT',
  'OPEN_COLUMN_WIDTH_DIALOG',
  'AUTO_FIT_COLUMN_WIDTH',
  'HIDE_ROW',
  'UNHIDE_ROW',
  'HIDE_COLUMN',
  'UNHIDE_COLUMN',
  'OPEN_FORMAT_CELLS_DIALOG',
];

/** ClipboardGroup actions: cut/copy/paste family + format painter. */
const CLIPBOARD_GROUP_ACTIONS: ActionType[] = [
  'CUT',
  'COPY',
  'PASTE',
  'PASTE_VALUES',
  'PASTE_FORMULAS',
  'PASTE_FORMATTING',
  'OPEN_PASTE_SPECIAL_DIALOG',
  'TOGGLE_FORMAT_PAINTER',
  'TOGGLE_FORMAT_PAINTER_LOCKED',
];

/** InsertRibbon actions: chart, sparkline, hyperlink, comment, etc. */
const INSERT_RIBBON_ACTIONS: ActionType[] = [
  'INSERT_TABLE',
  'OPEN_PIVOT_DIALOG',
  'INSERT_PICTURE',
  'INSERT_ICON',
  'INSERT_3D_MODEL',
  'OPEN_DIAGRAM_DIALOG',
  'CREATE_EMBEDDED_CHART',
  'OPEN_SPARKLINE_DIALOG',
  'OPEN_INSERT_SLICER_DIALOG',
  'OPEN_HYPERLINK_DIALOG',
  'INSERT_COMMENT',
  'INSERT_TEXTBOX',
  'INSERT_FORM_CONTROL_CHECKBOX',
  'INSERT_FORM_CONTROL_COMBOBOX',
  'OPEN_PAGE_SETUP_DIALOG',
  'INSERT_EQUATION',
  'OPEN_TEXT_EFFECT_GALLERY',
  'INSERT_TEXT_EFFECT',
];

const ALL_MIGRATED_ACTIONS: ActionType[] = [
  ...EDITING_GROUP_ACTIONS,
  ...CELLS_GROUP_ACTIONS,
  ...CLIPBOARD_GROUP_ACTIONS,
  ...INSERT_RIBBON_ACTIONS,
];

describe('Insert ribbon dispatch — dispatch symmetry', () => {
  describe('every migrated action has a registered handler', () => {
    for (const action of ALL_MIGRATED_ACTIONS) {
      it(`${action} is implemented in HANDLER_MAP`, () => {
        expect(isActionImplemented(action)).toBe(true);
      });
    }
  });

  it('EditingGroup actions are all implemented', () => {
    const missing = EDITING_GROUP_ACTIONS.filter((a) => !isActionImplemented(a));
    expect(missing).toEqual([]);
  });

  it('CellsGroup actions are all implemented', () => {
    const missing = CELLS_GROUP_ACTIONS.filter((a) => !isActionImplemented(a));
    expect(missing).toEqual([]);
  });

  it('ClipboardGroup actions are all implemented', () => {
    const missing = CLIPBOARD_GROUP_ACTIONS.filter((a) => !isActionImplemented(a));
    expect(missing).toEqual([]);
  });

  it('InsertRibbon actions are all implemented', () => {
    const missing = INSERT_RIBBON_ACTIONS.filter((a) => !isActionImplemented(a));
    expect(missing).toEqual([]);
  });
});
