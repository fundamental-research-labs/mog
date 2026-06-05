import type { ChartMark, IChartBridge } from '@mog-sdk/contracts/bridges';
import { jest } from '@jest/globals';

import type { ChartImageExporter } from '@mog-sdk/contracts/api';
import { installNodeChartImageExporter } from '../src/boot';
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

describe('Node chart image exporter native raster loading', () => {
  it('does not validate the native raster backend while creating the factory or exporter', () => {
    const factory = createNodeChartImageExporterFactory({});
    expect(() => factory(chartBridgeReturning([]))).not.toThrow();
  });

  it('rejects PNG export when the native raster backend is unavailable before compiling marks', async () => {
    const getMarksAtSize = jest.fn(async () => validMarks());
    const exporter = createNodeChartImageExporterFactory({})(
      chartBridgeWithGetMarks(getMarksAtSize),
    );

    await expect(
      exporter.exportImage('sheet-1', 'chart-1', {
        format: 'png',
        width: 20,
        height: 10,
        pixelRatio: 1,
        backgroundColor: '#ffffff',
      }),
    ).rejects.toThrow(
      /Native chart raster backend is unavailable for chart image export.*render_chart_marks_image/,
    );
    expect(getMarksAtSize).not.toHaveBeenCalled();
  });

  it('rejects unsupported SVG export without resolving the native raster backend', async () => {
    const getMarksAtSize = jest.fn(async () => validMarks());
    const resolveAddon = jest.fn(() => ({}));
    const exporter = createNodeChartImageExporterFactory(resolveAddon)(
      chartBridgeWithGetMarks(getMarksAtSize),
    );

    await expect(exporter.exportImage('sheet-1', 'chart-1', { format: 'svg' })).rejects.toThrow(
      /Unsupported chart image format "svg"/,
    );
    expect(resolveAddon).not.toHaveBeenCalled();
    expect(getMarksAtSize).not.toHaveBeenCalled();
  });

  it('does not invoke resolver form until exportImage and caches successful resolution', async () => {
    const getMarksAtSize = jest.fn(async () => validMarks());
    const render = jest.fn((requestJson: string) => {
      JSON.parse(requestJson);
      return {
        bytes: new Uint8Array([3]),
        format: 'png' as const,
        width: 20,
        height: 10,
      };
    });
    const resolveAddon = jest.fn(() => ({ render_chart_marks_image: render }));
    const factory = createNodeChartImageExporterFactory(resolveAddon);

    expect(resolveAddon).not.toHaveBeenCalled();
    const exporter = factory(chartBridgeWithGetMarks(getMarksAtSize));
    expect(resolveAddon).not.toHaveBeenCalled();

    const options = {
      format: 'png' as const,
      width: 20,
      height: 10,
      pixelRatio: 1,
      backgroundColor: '#ffffff',
    };

    await expect(exporter.exportImage('sheet-1', 'chart-1', options)).resolves.toBe(
      'data:image/png;base64,Aw==',
    );
    await expect(exporter.exportImage('sheet-1', 'chart-1', options)).resolves.toBe(
      'data:image/png;base64,Aw==',
    );
    expect(resolveAddon).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
    expect(getMarksAtSize).toHaveBeenCalledTimes(2);
  });

  it('registers the createWorkbook chart exporter without resolving native raster', async () => {
    const getMarksAtSize = jest.fn(async () => validMarks());
    const resolveAddon = jest.fn(() => ({}));
    let exporter: ChartImageExporter | null = null;
    const handle = {
      registerChartImageExporter(factory: (chartBridge: IChartBridge) => ChartImageExporter) {
        exporter = factory(chartBridgeWithGetMarks(getMarksAtSize));
      },
    };

    installNodeChartImageExporter(handle, resolveAddon);

    expect(exporter).not.toBeNull();
    expect(resolveAddon).not.toHaveBeenCalled();
    expect(getMarksAtSize).not.toHaveBeenCalled();

    await expect(
      exporter!.exportImage('sheet-1', 'chart-1', {
        format: 'png',
        width: 20,
        height: 10,
        pixelRatio: 1,
        backgroundColor: '#ffffff',
      }),
    ).rejects.toThrow(/Native chart raster backend is unavailable for chart image export/);
    expect(resolveAddon).toHaveBeenCalledTimes(1);
    expect(getMarksAtSize).not.toHaveBeenCalled();
  });
});

function chartBridgeReturning(marks: ChartMark[]): IChartBridge {
  return {
    getMarksAtSize: async () => marks,
  } as unknown as IChartBridge;
}

function chartBridgeWithGetMarks(
  getMarksAtSize: (...args: readonly unknown[]) => Promise<ChartMark[]>,
): IChartBridge {
  return {
    getMarksAtSize,
  } as unknown as IChartBridge;
}

function validMarks(): ChartMark[] {
  return [
    {
      type: 'rect',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      style: { fill: '#123456' },
    },
  ];
}
