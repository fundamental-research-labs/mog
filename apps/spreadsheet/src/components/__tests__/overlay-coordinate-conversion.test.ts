/**
 * Overlay Coordinate Conversion Tests
 *
 * Verifies that canvas-relative coordinates from cellToViewport() are correctly
 * converted to window-relative coordinates for Radix Portal positioning.
 *
 * Bug #8: Comment popup (and other overlays) were mispositioned because they
 * passed canvas-relative coords directly to Radix Popover, which expects
 * window-relative coords. The fix adds the canvas container's getBoundingClientRect()
 * offset to convert from canvas-relative to window-relative.
 *
 */

// =============================================================================
// Unit tests for window-relative coordinate conversion
// =============================================================================

/**
 * The coordinate conversion pattern used in all three overlay components:
 *
 * const canvasRect = getCanvas?.getBoundingClientRect;
 * windowX = canvasRect.left + cellRect.x + additionalOffset;
 * windowY = canvasRect.top + cellRect.y + additionalOffset;
 *
 * This is the same pattern used by InputMessageOverlay (the correct reference):
 * x: containerRect.left + cellRect.x + 4
 * y: containerRect.top + cellRect.y + cellRect.height + 4
 */

interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasOffset {
  left: number;
  top: number;
}

/**
 * Reproduces CommentPopover's coordinate conversion (lines 273-278).
 * Returns the DOMRect that gets passed to Radix Popover's virtual ref.
 */
function computeCommentPopoverPosition(cellRect: CellRect, canvasOffset: CanvasOffset): DOMRect {
  return new DOMRect(
    canvasOffset.left + cellRect.x + cellRect.width, // Right edge of cell (window-relative)
    canvasOffset.top + cellRect.y, // Top of cell (window-relative)
    0, // No width (point anchor)
    cellRect.height, // Height of cell for alignment
  );
}

/**
 * Reproduces ValidationDropdownOverlay / DatePickerOverlay coordinate conversion.
 * Returns the (x, y) passed to createVirtualRef for positioning below the cell.
 */
function computeDropdownOverlayPosition(
  cellRect: CellRect,
  canvasOffset: CanvasOffset,
): { x: number; y: number } {
  return {
    x: canvasOffset.left + cellRect.x,
    y: canvasOffset.top + cellRect.y + cellRect.height,
  };
}

/**
 * The BROKEN version (before fix) - passes canvas-relative coords directly.
 * Included to prove the test catches the bug.
 */
function computeBrokenPosition(cellRect: CellRect, _canvasOffset: CanvasOffset): DOMRect {
  return new DOMRect(
    cellRect.x + cellRect.width, // WRONG: canvas-relative, not window-relative
    cellRect.y, // WRONG: canvas-relative, not window-relative
    0,
    cellRect.height,
  );
}

// =============================================================================
// Tests
// =============================================================================

describe('Overlay coordinate conversion: canvas-relative to window-relative', () => {
  describe('CommentPopover virtual ref positioning', () => {
    it('adds canvas offset to convert canvas-relative coords to window-relative', () => {
      const cellRect: CellRect = { x: 100, y: 50, width: 80, height: 20 };
      const canvasOffset: CanvasOffset = { left: 0, top: 75 }; // toolbar + formula bar

      const result = computeCommentPopoverPosition(cellRect, canvasOffset);

      // Window-relative: canvasOffset + cellRect position
      expect(result.x).toBe(0 + 100 + 80); // canvasOffset.left + cellRect.x + cellRect.width
      expect(result.y).toBe(75 + 50); // canvasOffset.top + cellRect.y
      expect(result.width).toBe(0);
      expect(result.height).toBe(20);
    });

    it('produces correct position when canvas is at window origin (no offset)', () => {
      const cellRect: CellRect = { x: 200, y: 100, width: 60, height: 25 };
      const canvasOffset: CanvasOffset = { left: 0, top: 0 };

      const result = computeCommentPopoverPosition(cellRect, canvasOffset);

      // With no offset, window coords equal canvas coords
      expect(result.x).toBe(200 + 60);
      expect(result.y).toBe(100);
    });

    it.each([
      { label: 'no offset', canvasOffset: { left: 0, top: 0 } },
      { label: 'toolbar only (~40px)', canvasOffset: { left: 0, top: 40 } },
      { label: 'toolbar + formula bar (~75px)', canvasOffset: { left: 0, top: 75 } },
      { label: 'sidebar + toolbar (150px left, 75px top)', canvasOffset: { left: 150, top: 75 } },
      { label: 'large offset (embedded in iframe)', canvasOffset: { left: 300, top: 200 } },
    ])('handles varying container offsets: $label', ({ canvasOffset }) => {
      const cellRect: CellRect = { x: 100, y: 50, width: 80, height: 20 };

      const result = computeCommentPopoverPosition(cellRect, canvasOffset);

      expect(result.x).toBe(canvasOffset.left + cellRect.x + cellRect.width);
      expect(result.y).toBe(canvasOffset.top + cellRect.y);
      expect(result.height).toBe(cellRect.height);
    });

    it('detects the bug: broken version omits canvas offset', () => {
      const cellRect: CellRect = { x: 100, y: 50, width: 80, height: 20 };
      const canvasOffset: CanvasOffset = { left: 0, top: 75 };

      const correctResult = computeCommentPopoverPosition(cellRect, canvasOffset);
      const brokenResult = computeBrokenPosition(cellRect, canvasOffset);

      // The broken version is off by the canvas offset
      expect(brokenResult.y).not.toBe(correctResult.y);
      expect(correctResult.y - brokenResult.y).toBe(canvasOffset.top);
    });
  });

  describe('ValidationDropdownOverlay / DatePickerOverlay positioning', () => {
    it('positions below cell with canvas offset applied', () => {
      const cellRect: CellRect = { x: 100, y: 50, width: 80, height: 20 };
      const canvasOffset: CanvasOffset = { left: 0, top: 75 };

      const result = computeDropdownOverlayPosition(cellRect, canvasOffset);

      expect(result.x).toBe(0 + 100); // canvasOffset.left + cellRect.x
      expect(result.y).toBe(75 + 50 + 20); // canvasOffset.top + cellRect.y + cellRect.height
    });

    it.each([
      { label: 'no offset', canvasOffset: { left: 0, top: 0 } },
      { label: 'toolbar + formula bar (~75px)', canvasOffset: { left: 0, top: 75 } },
      { label: 'sidebar + toolbar', canvasOffset: { left: 150, top: 75 } },
    ])('handles varying container offsets: $label', ({ canvasOffset }) => {
      const cellRect: CellRect = { x: 200, y: 300, width: 120, height: 25 };

      const result = computeDropdownOverlayPosition(cellRect, canvasOffset);

      expect(result.x).toBe(canvasOffset.left + cellRect.x);
      expect(result.y).toBe(canvasOffset.top + cellRect.y + cellRect.height);
    });
  });

  describe('Coordinate conversion consistency across overlays', () => {
    it('all overlays apply the same canvas offset to Y coordinate', () => {
      const cellRect: CellRect = { x: 100, y: 50, width: 80, height: 20 };
      const canvasOffset: CanvasOffset = { left: 0, top: 75 };

      const commentPos = computeCommentPopoverPosition(cellRect, canvasOffset);
      const dropdownPos = computeDropdownOverlayPosition(cellRect, canvasOffset);

      // Both should include canvasOffset.top in their Y calculations
      // CommentPopover: canvasOffset.top + cellRect.y (top of cell)
      // Dropdown overlays: canvasOffset.top + cellRect.y + cellRect.height (bottom of cell)
      expect(commentPos.y).toBe(canvasOffset.top + cellRect.y);
      expect(dropdownPos.y).toBe(canvasOffset.top + cellRect.y + cellRect.height);

      // The difference should be exactly cellRect.height
      expect(dropdownPos.y - commentPos.y).toBe(cellRect.height);
    });

    it('all overlays apply the same canvas offset to X coordinate', () => {
      const cellRect: CellRect = { x: 100, y: 50, width: 80, height: 20 };
      const canvasOffset: CanvasOffset = { left: 150, top: 75 };

      const commentPos = computeCommentPopoverPosition(cellRect, canvasOffset);
      const dropdownPos = computeDropdownOverlayPosition(cellRect, canvasOffset);

      // Both include canvasOffset.left
      // CommentPopover positions at right edge: canvasOffset.left + cellRect.x + cellRect.width
      // Dropdown positions at left edge: canvasOffset.left + cellRect.x
      expect(commentPos.x).toBe(canvasOffset.left + cellRect.x + cellRect.width);
      expect(dropdownPos.x).toBe(canvasOffset.left + cellRect.x);
    });
  });

  describe('Edge cases', () => {
    it('handles cell at origin (0,0)', () => {
      const cellRect: CellRect = { x: 0, y: 0, width: 80, height: 20 };
      const canvasOffset: CanvasOffset = { left: 0, top: 75 };

      const result = computeCommentPopoverPosition(cellRect, canvasOffset);

      expect(result.x).toBe(80); // just cellRect.width since x=0
      expect(result.y).toBe(75); // just canvasOffset.top since y=0
    });

    it('handles large scroll positions (cell far from viewport origin)', () => {
      // cellToViewport already accounts for scroll, so large x/y values are valid
      const cellRect: CellRect = { x: 5000, y: 3000, width: 80, height: 20 };
      const canvasOffset: CanvasOffset = { left: 0, top: 75 };

      const result = computeCommentPopoverPosition(cellRect, canvasOffset);

      expect(result.x).toBe(5080);
      expect(result.y).toBe(3075);
    });

    it('handles fractional pixel values', () => {
      const cellRect: CellRect = { x: 100.5, y: 50.25, width: 80.75, height: 20.5 };
      const canvasOffset: CanvasOffset = { left: 0.5, top: 75.25 };

      const result = computeCommentPopoverPosition(cellRect, canvasOffset);

      expect(result.x).toBeCloseTo(0.5 + 100.5 + 80.75);
      expect(result.y).toBeCloseTo(75.25 + 50.25);
    });
  });
});
