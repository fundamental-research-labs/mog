import { CELLS_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';

import { deriveCollapseLadder } from '../collapse/collapse-ladder';

describe('CellsGroup responsive layout', () => {
  test('collapse config still hides Cells only at the mobile level', () => {
    expect(CELLS_COLLAPSE_CONFIG.levels[2]).toBe('dropdown');
    expect(CELLS_COLLAPSE_CONFIG.levels[3]).toBe('dropdown');
    expect(CELLS_COLLAPSE_CONFIG.levels[4]).toBe('hidden');
  });

  test('progressive collapse degrades Cells to a dropdown before ever hiding it', () => {
    // Under per-group progressive collapse, Cells collapses down to its most
    // compact non-hidden rung (dropdown) and is only hidden as an absolute last
    // resort — never merely because the window is narrow.
    const ladder = deriveCollapseLadder(CELLS_COLLAPSE_CONFIG);
    expect(ladder.rungs).toEqual(['full', 'compact', 'dropdown']);
    expect(ladder.rungs[ladder.rungs.length - 1]).toBe('dropdown');
    expect(ladder.canHide).toBe(true);
  });
});
