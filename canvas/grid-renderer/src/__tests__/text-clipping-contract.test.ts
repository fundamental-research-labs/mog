import { jest } from '@jest/globals';

import type { TextMeasurer } from '@mog/canvas-engine';
import type { CellFormat } from '@mog-sdk/contracts/core';

import { renderRotatedText } from '../cells/rotated-text';
import { renderShrinkToFit } from '../cells/shrink-to-fit';
import { getCellStyle, hasExplicitFontColor, renderNormalText } from '../cells/text';
import { renderWrappedText } from '../cells/text-wrap';
import type { CellRenderInfo } from '../cells/types';
import { OFFICE_THEME } from '../shared/theme-constants';

type Rect = { x: number; y: number; width: number; height: number };
type PaintOp =
  | { kind: 'fillText'; text: string; x: number; y: number; clips: Rect[] }
  | { kind: 'strokeText'; text: string; x: number; y: number; clips: Rect[] }
  | {
      kind: 'stroke';
      from: { x: number; y: number } | null;
      to: { x: number; y: number } | null;
      clips: Rect[];
    };

function createRecordingContext(): {
  ctx: CanvasRenderingContext2D;
  clips: Rect[];
  paints: PaintOp[];
} {
  const clips: Rect[] = [];
  const paints: PaintOp[] = [];
  const stack: Array<{
    clips: Rect[];
    pendingRect: Rect | null;
    lastMove: { x: number; y: number } | null;
    lastLine: { x: number; y: number } | null;
  }> = [{ clips: [], pendingRect: null, lastMove: null, lastLine: null }];
  const top = () => stack[stack.length - 1];
  const activeClips = () => stack.flatMap((frame) => frame.clips);

  const ctx = {
    save: jest.fn(() =>
      stack.push({ clips: [], pendingRect: null, lastMove: null, lastLine: null }),
    ),
    restore: jest.fn(() => {
      if (stack.length > 1) stack.pop();
    }),
    beginPath: jest.fn(() => {
      top().pendingRect = null;
      top().lastMove = null;
      top().lastLine = null;
    }),
    rect: jest.fn((x: number, y: number, width: number, height: number) => {
      top().pendingRect = { x, y, width, height };
    }),
    clip: jest.fn(() => {
      const rect = top().pendingRect;
      if (!rect) return;
      top().clips.push(rect);
      clips.push(rect);
    }),
    moveTo: jest.fn((x: number, y: number) => {
      top().lastMove = { x, y };
    }),
    lineTo: jest.fn((x: number, y: number) => {
      top().lastLine = { x, y };
    }),
    stroke: jest.fn(() => {
      paints.push({
        kind: 'stroke',
        from: top().lastMove,
        to: top().lastLine,
        clips: activeClips(),
      });
    }),
    fillText: jest.fn((text: string, x: number, y: number) => {
      paints.push({ kind: 'fillText', text, x, y, clips: activeClips() });
    }),
    strokeText: jest.fn((text: string, x: number, y: number) => {
      paints.push({ kind: 'strokeText', text, x, y, clips: activeClips() });
    }),
    measureText: jest.fn((text: string) => ({ width: text.length * 8 })),
    translate: jest.fn(),
    rotate: jest.fn(),
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '11px Calibri',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    shadowColor: 'transparent',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D;

  return { ctx, clips, paints };
}

const textMeasurer: TextMeasurer = {
  measureText: (text: string) => ({ width: text.length * 8 }),
} as TextMeasurer;

function cell(overrides: Partial<CellRenderInfo> = {}): CellRenderInfo {
  return {
    row: 4,
    col: 2,
    x: 40,
    y: 60,
    width: 80,
    height: 18,
    value: 'overflowing text',
    format: undefined,
    displayText: 'overflowing text',
    isEditing: false,
    ...overrides,
  };
}

const baseOptions = {
  hasHyperlink: false,
  isCutCell: false,
  theme: OFFICE_THEME,
  textMeasurer,
};

describe('cell text clipping contract', () => {
  it('normal text clips vertically while preserving horizontal overflow', () => {
    const { ctx, clips, paints } = createRecordingContext();

    renderNormalText(ctx, cell(), undefined, textMeasurer, {
      ...baseOptions,
      overflowResult: { renderX: 40, renderWidth: 240, isClipped: false },
    });

    expect(clips).toHaveLength(1);
    expect(clips[0]).toEqual({
      x: expect.any(Number),
      y: 60,
      width: expect.any(Number),
      height: 18,
    });
    expect(clips[0].x).toBeLessThan(-999_000);
    expect(clips[0].width).toBeGreaterThan(2_000_000);
    expect(paints.find((op) => op.kind === 'fillText')?.clips).toContainEqual(clips[0]);
  });

  it('normal text resolves default black as automatic renderer text color', () => {
    const { ctx } = createRecordingContext();
    const format: CellFormat = { fontColor: '#000000' };

    renderNormalText(ctx, cell({ displayText: 'dark' }), format, textMeasurer, {
      ...baseOptions,
      defaultFontColor: '#f4f7f5',
      overflowResult: null,
    });

    expect(ctx.fillStyle).toBe('#f4f7f5');
    expect(getCellStyle(format, OFFICE_THEME, '#f4f7f5').color).toBe('#f4f7f5');
    expect(hasExplicitFontColor(format)).toBe(false);
  });

  it('normal text preserves non-default explicit renderer text colors', () => {
    const { ctx } = createRecordingContext();
    const format: CellFormat = { fontColor: '#123456' };

    renderNormalText(ctx, cell({ displayText: 'explicit' }), format, textMeasurer, {
      ...baseOptions,
      defaultFontColor: '#f4f7f5',
      overflowResult: null,
    });

    expect(ctx.fillStyle).toBe('#123456');
    expect(getCellStyle(format, OFFICE_THEME, '#f4f7f5').color).toBe('#123456');
    expect(hasExplicitFontColor(format)).toBe(true);
  });

  it('normal text decorations are inside the same row-vertical clip as glyph paint', () => {
    const { ctx, clips, paints } = createRecordingContext();
    const format: CellFormat = {
      underlineType: 'double',
      strikethrough: true,
      fontSize: 24,
      verticalAlign: 'bottom',
    } as CellFormat;

    renderNormalText(ctx, cell({ height: 14 }), format, textMeasurer, {
      ...baseOptions,
      overflowResult: { renderX: 40, renderWidth: 220, isClipped: false },
    });

    const decorationStrokes = paints.filter((op) => op.kind === 'stroke');
    expect(decorationStrokes).toHaveLength(3);
    for (const stroke of decorationStrokes) {
      expect(stroke.clips).toContainEqual(clips[0]);
      expect(stroke.clips[0]).toMatchObject({ y: 60, height: 14 });
    }
  });

  it('wrapped text intentionally clips to the cell rectangle', () => {
    const { ctx, clips, paints } = createRecordingContext();
    const format: CellFormat = { wrapText: true, fontSize: 12 } as CellFormat;

    renderWrappedText(ctx, cell({ displayText: 'alpha beta gamma delta' }), format, baseOptions);

    expect(clips).toEqual([{ x: 40, y: 60, width: 80, height: 18 }]);
    expect(paints.some((op) => op.kind === 'fillText' && op.clips[0] === clips[0])).toBe(true);
  });

  it('rotated text intentionally clips to the cell rectangle', () => {
    const { ctx, clips, paints } = createRecordingContext();
    const format: CellFormat = { textRotation: 45 } as CellFormat;

    renderRotatedText(ctx, cell(), format, 45, baseOptions);

    expect(clips).toEqual([{ x: 40, y: 60, width: 80, height: 18 }]);
    expect(paints.find((op) => op.kind === 'fillText')?.clips).toContainEqual(clips[0]);
  });

  it('shrink-to-fit uses vertical-only clipping, not horizontal cell clipping', () => {
    const { ctx, clips, paints } = createRecordingContext();
    const format: CellFormat = { shrinkToFit: true, fontSize: 18 } as CellFormat;

    renderShrinkToFit(ctx, cell({ displayText: 'very wide shrink text' }), format, baseOptions);

    expect(clips).toHaveLength(1);
    expect(clips[0].y).toBe(60);
    expect(clips[0].height).toBe(18);
    expect(clips[0].x).toBeLessThan(-999_000);
    expect(clips[0].width).toBeGreaterThan(2_000_000);
    expect(paints.find((op) => op.kind === 'fillText')?.clips).toContainEqual(clips[0]);
  });
});
