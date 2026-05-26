/**
 * Page Layout dispatch — Dispatch Symmetry Test
 *
 * Asserts every action migrated to the Unified Action System in Page Layout scope
 * is registered in `HANDLER_MAP`. The "complete set of X" rule from
 * UX-FIX-PRINCIPLES §3 — if a ribbon button now dispatches an action, the
 * handler must exist; otherwise the click is a silent no-op.
 *
 * This catches two error classes:
 * 1. Hook deleted, ribbon now dispatches → action type added but handler
 * not registered in dispatcher.ts.
 * 2. Action type added but typo in HANDLER_MAP key.
 *
 */

import type { ActionType } from '@mog-sdk/contracts/actions';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DISPATCHER_SOURCE = readFileSync(path.resolve(__dirname, '..', 'dispatcher.ts'), 'utf8');

function isHandlerRegistered(action: string): boolean {
  const real = new RegExp(`(^|\\s)${action}:\\s*(?!notImplemented[,\\s])`, 'm');
  if (!real.test(DISPATCHER_SOURCE)) return false;
  const placeholder = new RegExp(`(^|\\s)${action}:\\s*notImplemented[,\\s]`, 'm');
  return !placeholder.test(DISPATCHER_SOURCE);
}

describe('Page Layout dispatch — dispatch symmetry (Page Layout ribbon)', () => {
  // Every action invoked by PageSetupGroup, SheetOptionsGroup, ThemesGroup,
  // or ScaleToFitGroup post-migration. Verified by reading the migrated
  // group source files at apps/spreadsheet/src/chrome/toolbar/groups/.
  const MIGRATED_ACTIONS: readonly ActionType[] = [
    // New in Page Layout scope
    'TOGGLE_VIEW_GRIDLINES',
    'TOGGLE_VIEW_HEADINGS',
    'TOGGLE_PRINT_GRIDLINES',
    'TOGGLE_PRINT_HEADINGS',
    // Existing — Page Layout scope migrates the call sites only
    'SET_PRINT_AREA',
    'CLEAR_PRINT_AREA',
    'INSERT_HORIZONTAL_PAGE_BREAK',
    'REMOVE_HORIZONTAL_PAGE_BREAK',
    'RESET_PAGE_BREAKS',
    'SET_PAGE_ORIENTATION',
    'SET_PAPER_SIZE',
    'SET_PAGE_MARGINS',
    'SET_PAGE_SCALE',
    'OPEN_PAGE_SETUP_DIALOG',
  ] as const;

  it.each(MIGRATED_ACTIONS)('HANDLER_MAP[%s] is defined', (action: ActionType) => {
    expect(isHandlerRegistered(action)).toBe(true);
  });

  it('every migrated action is unique (no copy-paste typos)', () => {
    const seen = new Set<string>();
    for (const action of MIGRATED_ACTIONS) {
      expect(seen.has(action)).toBe(false);
      seen.add(action);
    }
    expect(seen.size).toBe(MIGRATED_ACTIONS.length);
  });
});
