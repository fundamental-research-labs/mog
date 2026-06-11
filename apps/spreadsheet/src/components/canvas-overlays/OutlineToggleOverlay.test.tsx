import { describe, expect, it } from '@jest/globals';

import type { ISheetViewGeometry } from '@mog-sdk/sheet-view';

import { computeOutlineRects } from './OutlineToggleOverlay';

const geometry = {} as ISheetViewGeometry;

describe('computeOutlineRects', () => {
  it('exposes an above-depth row level target over the expand-all button', () => {
    const { levelButtons } = computeOutlineRects({
      geometry,
      rowGroups: [],
      columnGroups: [],
      maxRowLevel: 1,
      maxColLevel: 0,
      summaryRowsBelow: true,
      summaryColumnsRight: true,
      showOutlineLevelButtons: true,
      showRowHeaders: true,
      showColumnHeaders: true,
    });

    const level2 = levelButtons.find((button) => button.axis === 'row' && button.level === 2);
    const level3 = levelButtons.find((button) => button.axis === 'row' && button.level === 3);

    expect(level2).toBeDefined();
    expect(level3).toBeDefined();
    expect(level3?.x).toBe(level2?.x);
    expect(level3?.y).toBe(level2?.y);
  });
});
