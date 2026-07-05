import { CELLS_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { resolveToolbarGroupRenderMode } from '../primitives/ToolbarGroup';

describe('CellsGroup responsive layout', () => {
  test('keeps Cells hidden only for true width-derived mobile collapse', () => {
    expect(CELLS_COLLAPSE_CONFIG.levels[2]).toBe('dropdown');
    expect(CELLS_COLLAPSE_CONFIG.levels[3]).toBe('dropdown');
    expect(CELLS_COLLAPSE_CONFIG.levels[4]).toBe('hidden');
  });

  test('keeps Cells reachable when overflow escalation compacts a wider ribbon', () => {
    expect(
      resolveToolbarGroupRenderMode(CELLS_COLLAPSE_CONFIG, {
        level: 4,
        widthLevel: 3,
        containerWidth: 900,
      }),
    ).toBe('dropdown');

    expect(
      resolveToolbarGroupRenderMode(CELLS_COLLAPSE_CONFIG, {
        level: 4,
        widthLevel: 4,
        containerWidth: 640,
      }),
    ).toBe('hidden');
  });
});
