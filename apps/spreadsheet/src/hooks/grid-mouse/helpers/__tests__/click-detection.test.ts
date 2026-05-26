/**
 * Click Detection Tests
 *
 * Tests for pure click detection helper functions.
 */

import {
  COMMENT_INDICATOR,
  FILTER_BUTTON,
  getSelectedColumnsOrSingle,
  getSelectedRowsOrSingle,
  isClickOnCommentIndicator,
  isClickOnFilterButton,
  isClickOnValidationDropdown,
  VALIDATION_DROPDOWN,
} from '../click-detection';

// =============================================================================
// isClickOnFilterButton Tests
// =============================================================================

describe('isClickOnFilterButton', () => {
  const cellWidth = 100;
  const cellHeight = 25;

  // Calculate expected button position
  const buttonX = cellWidth - FILTER_BUTTON.SIZE - FILTER_BUTTON.PADDING;
  const buttonY = (cellHeight - FILTER_BUTTON.SIZE) / 2;

  it('returns true when clicking in center of filter button', () => {
    const clickX = buttonX + FILTER_BUTTON.SIZE / 2;
    const clickY = buttonY + FILTER_BUTTON.SIZE / 2;
    expect(isClickOnFilterButton(clickX, clickY, cellWidth, cellHeight)).toBe(true);
  });

  it('returns true when clicking at top-left corner of filter button (with hit padding)', () => {
    const clickX = buttonX - FILTER_BUTTON.HIT_PADDING + 1;
    const clickY = buttonY - FILTER_BUTTON.HIT_PADDING + 1;
    expect(isClickOnFilterButton(clickX, clickY, cellWidth, cellHeight)).toBe(true);
  });

  it('returns true when clicking at bottom-right corner of filter button (with hit padding)', () => {
    const clickX = buttonX + FILTER_BUTTON.SIZE + FILTER_BUTTON.HIT_PADDING - 1;
    const clickY = buttonY + FILTER_BUTTON.SIZE + FILTER_BUTTON.HIT_PADDING - 1;
    expect(isClickOnFilterButton(clickX, clickY, cellWidth, cellHeight)).toBe(true);
  });

  it('returns false when clicking far left of filter button', () => {
    const clickX = 10;
    const clickY = cellHeight / 2;
    expect(isClickOnFilterButton(clickX, clickY, cellWidth, cellHeight)).toBe(false);
  });

  it('returns false when clicking above filter button (beyond hit padding)', () => {
    const clickX = buttonX + FILTER_BUTTON.SIZE / 2;
    const clickY = 0; // Top of cell
    expect(isClickOnFilterButton(clickX, clickY, cellWidth, cellHeight)).toBe(false);
  });

  it('returns false when clicking below filter button (beyond hit padding)', () => {
    const clickX = buttonX + FILTER_BUTTON.SIZE / 2;
    const clickY = cellHeight; // Bottom of cell
    expect(isClickOnFilterButton(clickX, clickY, cellWidth, cellHeight)).toBe(false);
  });

  it('handles different cell sizes correctly', () => {
    const largeCellWidth = 200;
    const largeCellHeight = 50;
    const largeButtonX = largeCellWidth - FILTER_BUTTON.SIZE - FILTER_BUTTON.PADDING;
    const largeButtonY = (largeCellHeight - FILTER_BUTTON.SIZE) / 2;

    // Click in center of button for large cell
    const clickX = largeButtonX + FILTER_BUTTON.SIZE / 2;
    const clickY = largeButtonY + FILTER_BUTTON.SIZE / 2;
    expect(isClickOnFilterButton(clickX, clickY, largeCellWidth, largeCellHeight)).toBe(true);
  });
});

// =============================================================================
// isClickOnValidationDropdown Tests
// =============================================================================

describe('isClickOnValidationDropdown', () => {
  const cellWidth = 100;
  const cellHeight = 25;

  // Calculate expected arrow position
  const arrowX = cellWidth - VALIDATION_DROPDOWN.ARROW_SIZE - VALIDATION_DROPDOWN.ARROW_PADDING;
  const arrowHeight = VALIDATION_DROPDOWN.ARROW_SIZE * 0.6;
  const arrowY = (cellHeight - arrowHeight) / 2;

  it('returns true when clicking in center of dropdown arrow', () => {
    const clickX = arrowX + VALIDATION_DROPDOWN.ARROW_SIZE / 2;
    const clickY = arrowY + arrowHeight / 2;
    expect(isClickOnValidationDropdown(clickX, clickY, cellWidth, cellHeight)).toBe(true);
  });

  it('returns true when clicking at right edge of cell (within arrow area)', () => {
    const clickX = cellWidth - 1;
    const clickY = cellHeight / 2;
    expect(isClickOnValidationDropdown(clickX, clickY, cellWidth, cellHeight)).toBe(true);
  });

  it('returns false when clicking far left of dropdown arrow', () => {
    const clickX = 10;
    const clickY = cellHeight / 2;
    expect(isClickOnValidationDropdown(clickX, clickY, cellWidth, cellHeight)).toBe(false);
  });

  it('returns false when clicking above dropdown arrow (beyond hit padding)', () => {
    const clickX = arrowX + VALIDATION_DROPDOWN.ARROW_SIZE / 2;
    const clickY = 0; // Top of cell
    expect(isClickOnValidationDropdown(clickX, clickY, cellWidth, cellHeight)).toBe(false);
  });

  it('returns false when clicking below dropdown arrow (beyond hit padding)', () => {
    const clickX = arrowX + VALIDATION_DROPDOWN.ARROW_SIZE / 2;
    const clickY = cellHeight; // Bottom of cell
    expect(isClickOnValidationDropdown(clickX, clickY, cellWidth, cellHeight)).toBe(false);
  });

  it('handles narrow cells correctly', () => {
    const narrowCellWidth = 40;
    const narrowArrowX =
      narrowCellWidth - VALIDATION_DROPDOWN.ARROW_SIZE - VALIDATION_DROPDOWN.ARROW_PADDING;

    // Click in the arrow area
    const clickX = narrowArrowX + VALIDATION_DROPDOWN.ARROW_SIZE / 2;
    const clickY = cellHeight / 2;
    expect(isClickOnValidationDropdown(clickX, clickY, narrowCellWidth, cellHeight)).toBe(true);
  });
});

// =============================================================================
// isClickOnCommentIndicator Tests
// =============================================================================

describe('isClickOnCommentIndicator', () => {
  const cellWidth = 100;

  it('returns true when clicking in top-right corner (on indicator)', () => {
    const clickX = cellWidth - COMMENT_INDICATOR.TRIANGLE_SIZE / 2;
    const clickY = COMMENT_INDICATOR.TRIANGLE_SIZE / 2;
    expect(isClickOnCommentIndicator(clickX, clickY, cellWidth)).toBe(true);
  });

  it('returns true when clicking at exact top-right corner', () => {
    const clickX = cellWidth - 1;
    const clickY = 0;
    expect(isClickOnCommentIndicator(clickX, clickY, cellWidth)).toBe(true);
  });

  it('returns true when clicking within hit padding of indicator', () => {
    const clickX = cellWidth - COMMENT_INDICATOR.TRIANGLE_SIZE - COMMENT_INDICATOR.HIT_PADDING + 1;
    const clickY = 0;
    expect(isClickOnCommentIndicator(clickX, clickY, cellWidth)).toBe(true);
  });

  it('returns false when clicking far from indicator', () => {
    const clickX = 10;
    const clickY = 10;
    expect(isClickOnCommentIndicator(clickX, clickY, cellWidth)).toBe(false);
  });

  it('returns false when clicking in bottom-right corner', () => {
    const clickX = cellWidth - 1;
    const clickY = 50; // Well below the triangle
    expect(isClickOnCommentIndicator(clickX, clickY, cellWidth)).toBe(false);
  });

  it('returns false when clicking in top-left corner', () => {
    const clickX = 0;
    const clickY = 0;
    expect(isClickOnCommentIndicator(clickX, clickY, cellWidth)).toBe(false);
  });

  it('handles different cell widths correctly', () => {
    const wideCellWidth = 200;
    // Click in top-right corner of wide cell
    const clickX = wideCellWidth - COMMENT_INDICATOR.TRIANGLE_SIZE / 2;
    const clickY = COMMENT_INDICATOR.TRIANGLE_SIZE / 2;
    expect(isClickOnCommentIndicator(clickX, clickY, wideCellWidth)).toBe(true);
  });
});

// =============================================================================
// getSelectedColumnsOrSingle Tests
// =============================================================================

describe('getSelectedColumnsOrSingle', () => {
  it('returns single column when no selection', () => {
    expect(getSelectedColumnsOrSingle(5, [])).toEqual([5]);
  });

  it('returns single column when column is not in any selection range', () => {
    const ranges = [
      { startCol: 0, endCol: 2 },
      { startCol: 10, endCol: 12 },
    ];
    expect(getSelectedColumnsOrSingle(5, ranges)).toEqual([5]);
  });

  it('returns all columns in range when column is in selection', () => {
    const ranges = [{ startCol: 3, endCol: 6 }];
    expect(getSelectedColumnsOrSingle(4, ranges)).toEqual([3, 4, 5, 6]);
  });

  it('returns single column array when selection is single column', () => {
    const ranges = [{ startCol: 5, endCol: 5 }];
    expect(getSelectedColumnsOrSingle(5, ranges)).toEqual([5]);
  });

  it('handles multiple selection ranges - returns first matching range', () => {
    const ranges = [
      { startCol: 0, endCol: 2 },
      { startCol: 5, endCol: 8 },
    ];
    expect(getSelectedColumnsOrSingle(6, ranges)).toEqual([5, 6, 7, 8]);
  });

  it('returns single column when column is at edge of selection but matches', () => {
    const ranges = [{ startCol: 3, endCol: 6 }];
    expect(getSelectedColumnsOrSingle(3, ranges)).toEqual([3, 4, 5, 6]); // start edge
    expect(getSelectedColumnsOrSingle(6, ranges)).toEqual([3, 4, 5, 6]); // end edge
  });
});

// =============================================================================
// getSelectedRowsOrSingle Tests
// =============================================================================

describe('getSelectedRowsOrSingle', () => {
  it('returns single row when no selection', () => {
    expect(getSelectedRowsOrSingle(5, [])).toEqual([5]);
  });

  it('returns single row when row is not in any selection range', () => {
    const ranges = [
      { startRow: 0, endRow: 2 },
      { startRow: 10, endRow: 12 },
    ];
    expect(getSelectedRowsOrSingle(5, ranges)).toEqual([5]);
  });

  it('returns all rows in range when row is in selection', () => {
    const ranges = [{ startRow: 3, endRow: 6 }];
    expect(getSelectedRowsOrSingle(4, ranges)).toEqual([3, 4, 5, 6]);
  });

  it('returns single row array when selection is single row', () => {
    const ranges = [{ startRow: 5, endRow: 5 }];
    expect(getSelectedRowsOrSingle(5, ranges)).toEqual([5]);
  });

  it('handles multiple selection ranges - returns first matching range', () => {
    const ranges = [
      { startRow: 0, endRow: 2 },
      { startRow: 5, endRow: 8 },
    ];
    expect(getSelectedRowsOrSingle(6, ranges)).toEqual([5, 6, 7, 8]);
  });

  it('returns single row when row is at edge of selection but matches', () => {
    const ranges = [{ startRow: 3, endRow: 6 }];
    expect(getSelectedRowsOrSingle(3, ranges)).toEqual([3, 4, 5, 6]); // start edge
    expect(getSelectedRowsOrSingle(6, ranges)).toEqual([3, 4, 5, 6]); // end edge
  });

  it('handles large selection ranges', () => {
    const ranges = [{ startRow: 0, endRow: 99 }];
    const result = getSelectedRowsOrSingle(50, ranges);
    expect(result.length).toBe(100);
    expect(result[0]).toBe(0);
    expect(result[99]).toBe(99);
  });
});
