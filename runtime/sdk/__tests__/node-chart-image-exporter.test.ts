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
      ],
    });
  });

  it('rejects chart symbol shapes unsupported by the native raster backend', async () => {
    const marks = [
      {
        type: 'symbol',
        x: 5,
        y: 6,
        shape: 'star',
        size: 36,
        style: { fill: '#123456' },
      },
    ] satisfies ChartMark[];

    const exporter = createNodeChartImageExporterFactory({
      render_chart_marks_image: () => {
        throw new Error('native backend should not be called');
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
    ).rejects.toThrow('unsupported symbol shape "star"');
  });
});

function chartBridgeReturning(marks: ChartMark[]): IChartBridge {
  return {
    getMarksAtSize: async () => marks,
  } as unknown as IChartBridge;
}
