import type { CommandsInternals } from '../capabilities/commands';
import type { SheetViewCommand } from '../public-types';
import { SheetViewCommands } from '../capabilities/commands';

function makeInternals(): jest.Mocked<CommandsInternals> {
  return {
    scrollTo: jest.fn(),
    setZoom: jest.fn(),
    setFrozenPanes: jest.fn(),
    switchSheet: jest.fn(),
    invalidateAll: jest.fn(),
  };
}

describe('SheetViewCommands', () => {
  let internals: jest.Mocked<CommandsInternals>;
  let commands: SheetViewCommands;

  beforeEach(() => {
    internals = makeInternals();
    commands = new SheetViewCommands(internals);
  });

  it('dispatches scroll-to-cell to scrollTo', () => {
    commands.dispatch({ type: 'scroll-to-cell', cell: { row: 5, col: 3 } });

    expect(internals.scrollTo).toHaveBeenCalledWith(5, 3);
    expect(internals.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('dispatches set-zoom to setZoom', () => {
    commands.dispatch({ type: 'set-zoom', zoom: 1.5 });

    expect(internals.setZoom).toHaveBeenCalledWith(1.5);
    expect(internals.setZoom).toHaveBeenCalledTimes(1);
  });

  it('dispatches set-frozen-panes to setFrozenPanes', () => {
    commands.dispatch({ type: 'set-frozen-panes', rows: 2, cols: 1 });

    expect(internals.setFrozenPanes).toHaveBeenCalledWith(2, 1);
    expect(internals.setFrozenPanes).toHaveBeenCalledTimes(1);
  });

  it('dispatches switch-sheet to switchSheet', () => {
    commands.dispatch({ type: 'switch-sheet', sheetId: 'sheet-42' });

    expect(internals.switchSheet).toHaveBeenCalledWith('sheet-42');
    expect(internals.switchSheet).toHaveBeenCalledTimes(1);
  });

  it('dispatches invalidate-all to invalidateAll', () => {
    commands.dispatch({ type: 'invalidate-all' });

    expect(internals.invalidateAll).toHaveBeenCalledTimes(1);
  });

  it('each command type only calls its corresponding handler', () => {
    const allCommands: SheetViewCommand[] = [
      { type: 'scroll-to-cell', cell: { row: 0, col: 0 } },
      { type: 'set-zoom', zoom: 1 },
      { type: 'set-frozen-panes', rows: 0, cols: 0 },
      { type: 'switch-sheet', sheetId: 's1' },
      { type: 'invalidate-all' },
    ];

    for (const cmd of allCommands) {
      const fresh = makeInternals();
      const freshCommands = new SheetViewCommands(fresh);
      freshCommands.dispatch(cmd);

      // Exactly one method should have been called
      const calledMethods = Object.entries(fresh).filter(
        ([, fn]) => (fn as jest.Mock).mock.calls.length > 0,
      );
      expect(calledMethods).toHaveLength(1);
    }
  });
});
