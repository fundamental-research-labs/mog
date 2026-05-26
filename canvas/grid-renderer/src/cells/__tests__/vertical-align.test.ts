import type { CellFormat } from '@mog-sdk/contracts/core';

import { mapVerticalAlign } from '../text';

describe('mapVerticalAlign', () => {
  it.each([
    ['top', 'top'],
    ['middle', 'middle'],
    ['bottom', 'bottom'],
  ] as const)('maps canonical verticalAlign %s to canvas %s', (align, expected) => {
    expect(mapVerticalAlign(align)).toBe(expected);
  });

  it.each(['justify', 'distributed'] as const)(
    'maps verticalAlign %s to top for specialized renderers',
    (align) => {
      expect(mapVerticalAlign(align)).toBe('top');
    },
  );
});
