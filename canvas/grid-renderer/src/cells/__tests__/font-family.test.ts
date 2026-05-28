import type { CellTextStyle } from '@mog-sdk/contracts/cell-style';

import { buildSegmentFont } from '../rich-text';
import { buildCellFont, clearFontCache } from '../text';

const baseStyle: CellTextStyle = {
  paddingX: 4,
  fontSize: 12,
  fontFamily: 'Arial',
  fontWeight: 'normal',
  fontStyle: 'normal',
  color: '#000000',
  textDecoration: 'none',
  textAlign: 'left',
  verticalAlign: 'bottom',
  lineHeight: 1,
  backgroundColor: undefined,
};

describe('font family intrinsic canvas weights', () => {
  beforeEach(() => {
    clearFontCache();
  });

  it('renders Arial Black cell fonts with intrinsic heavy weight', () => {
    expect(buildCellFont({ fontFamily: 'Arial Black' })).toContain(
      '900 12px "Arial Black", "Arial", sans-serif',
    );
  });

  it('does not synthesize weight for non-intrinsic cell fonts unless bold is set', () => {
    expect(buildCellFont({ fontFamily: 'Arial' })).toBe('12px "Arial", sans-serif');
    expect(buildCellFont({ fontFamily: 'Arial', bold: true })).toBe(
      'bold 12px "Arial", sans-serif',
    );
  });

  it('renders Arial Black rich text segment overrides with intrinsic heavy weight', () => {
    expect(buildSegmentFont({ fontFamily: 'Arial Black' }, baseStyle)).toBe(
      '900 12px "Arial Black", "Arial", sans-serif',
    );
  });

  it('renders Arial Black base rich text fonts with intrinsic heavy weight', () => {
    expect(buildSegmentFont(undefined, { ...baseStyle, fontFamily: 'Arial Black' })).toBe(
      '900 12px "Arial Black", "Arial", sans-serif',
    );
  });
});
