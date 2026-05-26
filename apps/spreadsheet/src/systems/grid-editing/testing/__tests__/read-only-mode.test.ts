/**
 * Read-only mode contract tests.
 *
 * This suite intentionally avoids importing GridEditingSystem. The production
 * grid-editing graph currently trips Jest's experimental VM ESM linker; these
 * tests keep the focused read-only contract executable while the production
 * dependency graph is tracked in the round-76 refactor note.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isDispatcherReadOnlyActionBlocked,
  setDispatcherReadOnly,
} from '../../../../actions/dispatcher-read-only';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GRID_EDITING_ROOT = path.resolve(__dirname, '..', '..');

function readGridEditingSource(relativePath: string): string {
  return readFileSync(path.resolve(GRID_EDITING_ROOT, relativePath), 'utf8');
}

describe('Read-only: grid editing source contract', () => {
  it('wires readOnly into editor action dependencies', () => {
    const source = readGridEditingSource('grid-editing-system.ts');
    expect(source).toContain('isReadOnly: () => config.readOnly === true');
  });

  it('disables drag fill through selection settings when readOnly is true', () => {
    const source = readGridEditingSource('grid-editing-system.ts');
    expect(source).toContain('if (this.config.readOnly)');
    expect(source).toContain(
      "this.selectionActor.send({ type: 'UPDATE_SETTINGS', allowDragFill: false })",
    );
  });

  it('keeps fill-handle drag guarded by allowDragFill', () => {
    const machine = readGridEditingSource('machines/grid-selection-machine.ts');
    const guards = readGridEditingSource('machines/selection/guards.ts');
    expect(machine).toContain('START_FILL_HANDLE_DRAG');
    expect(machine).toContain("guard: 'isFillHandleAllowed'");
    expect(guards).toContain('return context.allowDragFill');
  });

  it('keeps row and column resize outside the fill-handle readOnly gate', () => {
    const machine = readGridEditingSource('machines/grid-selection-machine.ts');
    expect(machine).toContain('START_COLUMN_RESIZE');
    expect(machine).toContain("target: 'resizingHeader'");
    expect(machine).toContain('START_ROW_RESIZE');
  });

  it('keeps fill execution blocked for human readOnly drag paths', () => {
    const source = readGridEditingSource('features/fill/fill-coordination.ts');
    expect(source).toContain('if (this.deps.readOnly)');
    expect(source).toContain('this.clearFillContext()');
  });
});

describe('Read-only: dispatcher safety net', () => {
  afterEach(() => {
    setDispatcherReadOnly(false);
  });

  it('blocks mutating actions when readOnly is true', () => {
    setDispatcherReadOnly(true);
    expect(isDispatcherReadOnlyActionBlocked('TOGGLE_BOLD')).toBe(true);
  });

  it('allows safe actions when readOnly is true', () => {
    setDispatcherReadOnly(true);
    expect(isDispatcherReadOnlyActionBlocked('COPY')).toBe(false);
  });

  it('allows all actions when readOnly is false', () => {
    setDispatcherReadOnly(false);
    expect(isDispatcherReadOnlyActionBlocked('TOGGLE_BOLD')).toBe(false);
  });

  it('does not affect direct kernel-style function calls', () => {
    setDispatcherReadOnly(true);
    expect(isDispatcherReadOnlyActionBlocked('TOGGLE_BOLD')).toBe(true);

    const mockSheet = { setCell: (r: number, c: number, v: string) => ({ r, c, v }) };
    expect(mockSheet.setCell(0, 0, 'agent value')).toEqual({ r: 0, c: 0, v: 'agent value' });
  });
});
