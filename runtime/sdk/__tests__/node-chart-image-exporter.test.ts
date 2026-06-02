import type { ChartMark, IChartBridge } from '@mog-sdk/contracts/bridges';

import { createNodeChartImageExporterFactory } from '../src/chart-export/node-chart-image-exporter';

describe('Node chart image exporter mark serialization', () => {
  it('serializes the production chart mark IR into the native raster request', async () => {
    let request: unknown;
    const marks = [
      {
        type: 'rect',
        x: 1,
        y: 2,
        width: 30,
        height: 40,
        clip: { x: 0, y: 0, width: 100, height: 80 },
        style: {
          fill: '#000000',
          fillPaint: { type: 'solid', color: '#123456', opacity: 0.5 },
          stroke: '#111111',
          line: {
            paint: { type: 'solid', color: '#abcdef' },
            width: 2,
            dash: [4, 2],
          },
          opacity: 0.75,
          cornerRadius: 3,
        },
      },
      {
        type: 'text',
        x: 12,
        y: 18,
        text: 'Styled title',
        fontSize: 18,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 'bold',
        fontStyle: 'italic',
        textAlign: 'center',
        textBaseline: 'top',
        style: { fill: '#222222' },
      },
    ] satisfies ChartMark[];

    const exporter = createNodeChartImageExporterFactory({
      render_chart_marks_image: (requestJson) => {
        request = JSON.parse(requestJson);
        return {
          bytes: new Uint8Array([1]),
          format: 'png',
          width: 20,
          height: 10,
        };
      },
    })(chartBridgeReturning(marks));

    const dataUrl = await exporter.exportImage('sheet-1', 'chart-1', {
      format: 'png',
      width: 20,
      height: 10,
      pixelRatio: 1,
      backgroundColor: '#ffffff',
    });

    expect(dataUrl).toBe('data:image/png;base64,AQ==');
    expect(request).toMatchObject({
      version: 1,
      marks: [
        {
          type: 'rect',
          x: 1,
          y: 2,
          width: 30,
          height: 40,
          clip: { x: 0, y: 0, width: 100, height: 80 },
          style: {
            fill: 'rgba(18, 52, 86, 0.5)',
            stroke: '#abcdef',
            strokeWidth: 2,
            strokeDash: [4, 2],
            opacity: 0.75,
            cornerRadius: 3,
          },
        },
        {
          type: 'text',
          x: 12,
          y: 18,
          text: 'Styled title',
          fontSize: 18,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 'bold',
          fontStyle: 'italic',
          textAlign: 'center',
          textBaseline: 'top',
          style: {
            fill: '#222222',
          },
        },
      ],
    });
  });

  it('serializes every chart symbol shape supported by the native raster backend', async () => {
    let request: unknown;
    const shapes = [
      'circle',
      'square',
      'diamond',
      'cross',
      'x',
      'star',
      'dash',
      'triangle-up',
      'triangle-down',
    ] as const;
    const marks = shapes.map((shape, index) => ({
      type: 'symbol',
      x: 5 + index,
      y: 6 + index,
      shape,
      size: 36,
      style: { fill: '#123456' },
    })) satisfies ChartMark[];

    const exporter = createNodeChartImageExporterFactory({
      render_chart_marks_image: (requestJson) => {
        request = JSON.parse(requestJson);
        return {
          bytes: new Uint8Array([2]),
          format: 'png',
          width: 20,
          height: 10,
        };
      },
    })(chartBridgeReturning(marks));

    await expect(
      exporter.exportImage('sheet-1', 'chart-1', {
        format: 'png',
        width: 20,
        height: 10,
        pixelRatio: 1,
        backgroundColor: '#ffffff',
      }),
    ).resolves.toBe('data:image/png;base64,Ag==');

    expect(request).toMatchObject({
      version: 1,
      marks: shapes.map((shape, index) => ({
        type: 'symbol',
        x: 5 + index,
        y: 6 + index,
        shape,
        size: 36,
        style: { fill: '#123456' },
      })),
    });
  });
});

function chartBridgeReturning(marks: ChartMark[]): IChartBridge {
  return {
    getMarksAtSize: async () => marks,
  } as unknown as IChartBridge;
}
