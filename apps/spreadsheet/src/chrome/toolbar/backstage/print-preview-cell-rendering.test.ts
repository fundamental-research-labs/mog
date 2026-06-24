import {
  calculatePrintCellOverflow,
  createPrintMergeIndex,
  createPrintPositionIndex,
  type PrintCellRenderContext,
} from './print-preview-cell-rendering';

function createContext(
  options: {
    readonly occupiedCells?: Set<string>;
    readonly hiddenColumns?: Set<number>;
  } = {},
): PrintCellRenderContext {
  return {
    positionIndex: createPrintPositionIndex(
      0,
      0,
      0,
      3,
      new Map([[0, 20]]),
      new Map([
        [0, 50],
        [1, 50],
        [2, 50],
        [3, 50],
      ]),
      options.hiddenColumns ?? new Set(),
    ),
    mergeIndex: createPrintMergeIndex([]),
    isCellEmpty: (row, col) => !options.occupiedCells?.has(`${row},${col}`),
    maxCol: 3,
    textMeasurer: {
      measureText: (_text, _font) => ({
        width: 0,
        actualBoundingBoxAscent: 0,
        actualBoundingBoxDescent: 0,
      }),
      measureWrappedText: (text, _font, _maxWidth) => ({
        lines: [text],
        lineHeight: 12,
        totalHeight: 12,
      }),
    },
  };
}

describe('print preview cell rendering', () => {
  it('allows text to overflow into adjacent blank cells on the printed page', () => {
    const overflow = calculatePrintCellOverflow(
      {
        row: 0,
        col: 0,
        value: 'long title',
        format: undefined,
        x: 0,
        width: 50,
        textWidth: 130,
      },
      createContext(),
    );

    expect(overflow).toEqual({
      renderX: 0,
      renderWidth: 150,
      isClipped: false,
      overflowStartCol: 0,
      overflowEndCol: 2,
    });
  });

  it('stops print overflow at the first occupied adjacent cell', () => {
    const overflow = calculatePrintCellOverflow(
      {
        row: 0,
        col: 0,
        value: 'long title',
        format: undefined,
        x: 0,
        width: 50,
        textWidth: 130,
      },
      createContext({ occupiedCells: new Set(['0,1']) }),
    );

    expect(overflow).toEqual({
      renderX: 0,
      renderWidth: 50,
      isClipped: true,
    });
  });
});
