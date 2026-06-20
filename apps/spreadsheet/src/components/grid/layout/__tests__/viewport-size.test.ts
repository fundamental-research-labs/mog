import { SCROLL_BAR_WIDTH } from '@mog-sdk/contracts/rendering';

import { getGridViewportSize } from '../viewport-size';

describe('getGridViewportSize', () => {
  it('reserves space for visible custom scrollbars', () => {
    expect(
      getGridViewportSize(1000, 700, {
        showHorizontalScrollbar: true,
        showVerticalScrollbar: true,
        reservedRightInset: 0,
      }),
    ).toEqual({
      width: 1000 - SCROLL_BAR_WIDTH,
      height: 700 - SCROLL_BAR_WIDTH,
    });
  });

  it('keeps full dimensions when custom scrollbars are hidden', () => {
    expect(
      getGridViewportSize(1000, 700, {
        showHorizontalScrollbar: false,
        showVerticalScrollbar: false,
        reservedRightInset: 0,
      }),
    ).toEqual({ width: 1000, height: 700 });
  });

  it('does not return negative dimensions', () => {
    expect(
      getGridViewportSize(4, 3, {
        showHorizontalScrollbar: true,
        showVerticalScrollbar: true,
        reservedRightInset: 0,
      }),
    ).toEqual({ width: 0, height: 0 });
  });

  it('reserves the pivot field panel inset in addition to visible scrollbars', () => {
    expect(
      getGridViewportSize(1000, 700, {
        showHorizontalScrollbar: true,
        showVerticalScrollbar: true,
        reservedRightInset: 320,
      }),
    ).toEqual({
      width: 1000 - SCROLL_BAR_WIDTH - 320,
      height: 700 - SCROLL_BAR_WIDTH,
    });
  });
});
