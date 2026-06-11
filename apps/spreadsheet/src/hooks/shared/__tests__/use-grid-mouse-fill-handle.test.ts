import { resolveFillHandleDragCell, type FillHandleDragAnchor } from '../fill-handle-drag-cell';

describe('fill handle drag cell resolution', () => {
  it('keeps the source row for horizontal drags from a zero-height row', () => {
    const anchor: FillHandleDragAnchor = {
      point: { x: 100, y: 200 },
      handleCell: { row: 123, col: 2 },
      sourceRowHasZeroHeight: true,
      sourceColHasZeroWidth: false,
    };

    expect(resolveFillHandleDragCell({ row: 137, col: 3 }, anchor, { x: 135, y: 200 })).toEqual({
      row: 123,
      col: 3,
    });
  });

  it('keeps the source column for vertical drags from a zero-width column', () => {
    const anchor: FillHandleDragAnchor = {
      point: { x: 100, y: 200 },
      handleCell: { row: 4, col: 7 },
      sourceRowHasZeroHeight: false,
      sourceColHasZeroWidth: true,
    };

    expect(resolveFillHandleDragCell({ row: 9, col: 12 }, anchor, { x: 100, y: 260 })).toEqual({
      row: 9,
      col: 7,
    });
  });

  it('does not alter drags from visible source cells', () => {
    const anchor: FillHandleDragAnchor = {
      point: { x: 100, y: 200 },
      handleCell: { row: 4, col: 7 },
      sourceRowHasZeroHeight: false,
      sourceColHasZeroWidth: false,
    };

    expect(resolveFillHandleDragCell({ row: 9, col: 12 }, anchor, { x: 160, y: 260 })).toEqual({
      row: 9,
      col: 12,
    });
  });
});
