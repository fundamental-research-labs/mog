import type { ChartBounds, ChartError, ChartMark } from '@mog-sdk/contracts/bridges';

import {
  renderChartError,
  renderChartMarks,
  renderChartPlaceholder,
} from '../bridge/chart-renderer';

type Op =
  | { kind: 'save' }
  | { kind: 'restore' }
  | { kind: 'translate'; x: number; y: number }
  | { kind: 'beginPath' }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'clip' }
  | { kind: 'fillRect'; x: number; y: number; w: number; h: number; style: string }
  | { kind: 'strokeRect'; x: number; y: number; w: number; h: number; style: string }
  | { kind: 'fillText'; text: string; x: number; y: number };

function createRecordingCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  let fillStyle = '#000';
  let strokeStyle = '#000';
  let globalAlpha = 1;
  const ctx = {
    save: () => ops.push({ kind: 'save' }),
    restore: () => ops.push({ kind: 'restore' }),
    translate: (x: number, y: number) => ops.push({ kind: 'translate', x, y }),
    beginPath: () => ops.push({ kind: 'beginPath' }),
    rect: (x: number, y: number, w: number, h: number) => ops.push({ kind: 'rect', x, y, w, h }),
    clip: () => ops.push({ kind: 'clip' }),
    set fillStyle(v: string) {
      fillStyle = v;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set globalAlpha(v: number) {
      globalAlpha = v;
    },
    get globalAlpha() {
      return globalAlpha;
    },
    setLineDash: () => {},
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: (x: number, y: number, w: number, h: number) =>
      ops.push({ kind: 'fillRect', x, y, w, h, style: fillStyle }),
    strokeRect: (x: number, y: number, w: number, h: number) =>
      ops.push({ kind: 'strokeRect', x, y, w, h, style: strokeStyle }),
    fillText: (text: string, x: number, y: number) => ops.push({ kind: 'fillText', text, x, y }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

const bounds: ChartBounds = { x: 10, y: 20, width: 200, height: 100 };

describe('chart renderer', () => {
  it('paints placeholders in the already-transformed drawing frame', () => {
    const { ctx, ops } = createRecordingCtx();

    renderChartPlaceholder(ctx, bounds, 'Chart loading...');

    expect(ops).toContainEqual({
      kind: 'fillRect',
      x: 10,
      y: 20,
      w: 200,
      h: 100,
      style: '#f0f0f0',
    });
    expect(ops).toContainEqual({
      kind: 'strokeRect',
      x: 10,
      y: 20,
      w: 200,
      h: 100,
      style: '#cccccc',
    });
    expect(ops).toContainEqual({ kind: 'fillText', text: 'Chart loading...', x: 110, y: 70 });
    expect(ops.filter((op) => op.kind === 'translate')).toEqual([]);
  });

  it('paints errors in the drawing frame and truncates long messages', () => {
    const { ctx, ops } = createRecordingCtx();
    const error: ChartError = {
      code: 'RENDER_FAILED',
      chartId: 'chart-1',
      message: 'A very long chart rendering error',
    };

    renderChartError(ctx, { ...bounds, width: 80 }, error);

    expect(ops).toContainEqual({
      kind: 'fillRect',
      x: 10,
      y: 20,
      w: 80,
      h: 100,
      style: '#f8d7da',
    });
    expect(ops).toContainEqual({
      kind: 'strokeRect',
      x: 10,
      y: 20,
      w: 80,
      h: 100,
      style: '#f5c6cb',
    });
    expect(ops).toContainEqual({ kind: 'fillText', text: 'A very ...', x: 50, y: 70 });
    expect(ops[0]).toEqual({ kind: 'save' });
    expect(ops[ops.length - 1]).toEqual({ kind: 'restore' });
    expect(ops.filter((op) => op.kind === 'translate')).toEqual([]);
  });

  it('translates mark rendering to the chart origin and clips to chart bounds', () => {
    const { ctx, ops } = createRecordingCtx();
    const marks: ChartMark[] = [
      {
        type: 'rect',
        x: 1,
        y: 2,
        width: 30,
        height: 40,
        style: { fill: '#123456' },
      },
    ];

    renderChartMarks(ctx, marks, bounds);

    expect(ops.slice(0, 5)).toEqual([
      { kind: 'save' },
      { kind: 'translate', x: 10, y: 20 },
      { kind: 'beginPath' },
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      { kind: 'clip' },
    ]);
    expect(ops).toContainEqual({
      kind: 'fillRect',
      x: 1,
      y: 2,
      w: 30,
      h: 40,
      style: '#123456',
    });
    expect(ops[ops.length - 1]).toEqual({ kind: 'restore' });
  });
});
