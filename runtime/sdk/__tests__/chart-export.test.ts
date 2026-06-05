import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

import { createWorkbook, type Workbook } from '../src/index';
import { createWorkbook as createWasmWorkbook } from '../src/wasm';

type DecodedPng = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
};

describe('Node SDK chart image export', () => {
  let wb: Workbook | undefined;
  let importedWb: Workbook | undefined;

  afterEach(async () => {
    await wb?.dispose();
    await importedWb?.dispose();
    wb = undefined;
    importedWb = undefined;
  });

  it('exports charts in explicit WASM runtime with a host compute module and custom raster backend', async () => {
    const rasterRequests: unknown[] = [];
    wb = await createWorkbook({
      runtime: 'wasm',
      wasmModule: await computeWasmModule(),
      userTimezone: 'UTC',
      chartRendering: {
        rasterBackend: {
          id: 'test-wasm-runtime-raster',
          runtime: 'custom',
          supportedFormats: ['png'],
          render(request) {
            rasterRequests.push(request);
            return {
              bytes: new Uint8Array([8]),
              format: 'png',
              width: request.options.width * request.options.pixelRatio,
              height: request.options.height * request.options.pixelRatio,
            };
          },
        },
      },
    });
    const sheet = wb.activeSheet;

    await sheet.setCell('A1', 'Month');
    await sheet.setCell('B1', 'Revenue');
    await sheet.setCell('A2', 'Jan');
    await sheet.setCell('B2', 12);
    await sheet.setCell('A3', 'Feb');
    await sheet.setCell('B3', 28);

    const chart = await sheet.charts.add({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 3,
      width: 8,
      height: 12,
      dataRange: 'A1:B3',
    });

    const dataUrl = await sheet.charts.exportImage(chart.id, {
      format: 'png',
      width: 160,
      height: 90,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    });

    expect(dataUrl).toBe('data:image/png;base64,CA==');
    expect(rasterRequests).toHaveLength(1);
    expect(rasterRequests[0]).toMatchObject({
      version: 1,
      options: {
        format: 'png',
        width: 160,
        height: 90,
        pixelRatio: 2,
      },
    });
  });

  it('exports chart PNGs through the public WASM entry with real compute and chart raster modules', async () => {
    wb = await createWasmWorkbook({
      wasmModule: await computeWasmModule(),
      userTimezone: 'UTC',
      chartRendering: {
        rasterModule: await chartRasterWasmModule(),
      },
    });
    const sheet = wb.activeSheet;

    await sheet.setRange('A1:B3', [
      ['Month', 'Revenue'],
      ['Jan', 12],
      ['Feb', 28],
    ]);

    const chart = await sheet.charts.add({
      type: 'bar',
      dataRange: 'A1:B3',
      anchorRow: 0,
      anchorCol: 3,
    });

    const dataUrl = await sheet.charts.exportImage(chart.id, {
      format: 'png',
      width: 320,
      height: 180,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    });

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const pngBytes = Buffer.from(dataUrl.split(',', 2)[1], 'base64');
    const decoded = decodePng(pngBytes);
    expect(decoded.width).toBe(640);
    expect(decoded.height).toBe(360);
    expect(nonWhitePixels(decoded.rgba)).toBeGreaterThan(1_000);
  });

  it('exports a created chart through the production Node raster backend', async () => {
    wb = await createWorkbook({ userTimezone: 'UTC' });
    const sheet = wb.activeSheet;

    await sheet.setCell('A1', 'Month');
    await sheet.setCell('B1', 'Revenue');
    await sheet.setCell('A2', 'Jan');
    await sheet.setCell('B2', 12);
    await sheet.setCell('A3', 'Feb');
    await sheet.setCell('B3', 28);
    await sheet.setCell('A4', 'Mar');
    await sheet.setCell('B4', 19);
    await sheet.setCell('A5', 'Apr');
    await sheet.setCell('B5', 35);

    const chart = await sheet.charts.add({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 3,
      width: 8,
      height: 12,
      dataRange: 'A1:B5',
      title: 'Quarter Revenue',
    });

    const dataUrl = await sheet.charts.exportImage(chart.id, {
      format: 'png',
      width: 320,
      height: 180,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    });

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const pngBytes = Buffer.from(dataUrl.split(',', 2)[1], 'base64');
    const decoded = decodePng(pngBytes);
    expect(decoded.width).toBe(640);
    expect(decoded.height).toBe(360);
    expect(nonWhitePixels(decoded.rgba)).toBeGreaterThan(1_000);

    const resolvedSpec = await wb.diagnostics.getResolvedChartSpec({
      sheetId: sheet.sheetId,
      chartId: chart.id,
      exportOptions: {
        format: 'png',
        width: 320,
        height: 180,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      },
    });
    expect(resolvedSpec.chartId).toBe(chart.id);
    expect(resolvedSpec.export).toMatchObject({
      kind: 'raster',
      physicalWidth: 640,
      fittingMode: 'fill',
    });
    expect(resolvedSpec.resolved.chartType).toBe('bar');
    expect(resolvedSpec.resolved.series[0]?.values).toEqual([12, 28, 19, 35]);
  });

  it('exports SVG through the portable vector backend', async () => {
    wb = await createWorkbook({ userTimezone: 'UTC' });
    const sheet = wb.activeSheet;

    await sheet.setCell('A1', 'Category');
    await sheet.setCell('B1', 'Value');
    await sheet.setCell('A2', 'A');
    await sheet.setCell('B2', 10);
    await sheet.setCell('A3', 'B');
    await sheet.setCell('B3', 20);

    const chart = await sheet.charts.add({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 3,
      width: 6,
      height: 10,
      dataRange: 'A1:B3',
    });

    const dataUrl = await sheet.charts.exportImage(chart.id, {
      format: 'svg',
      width: 320,
      height: 180,
      backgroundColor: '#ffffff',
    });

    expect(dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const svg = Buffer.from(dataUrl.split(',', 2)[1], 'base64').toString('utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 320 180"');
    expect(svg).toContain('<rect');
  });

  it('uses an explicit chartRendering raster backend through createWorkbook', async () => {
    const rasterRequests: unknown[] = [];
    wb = await createWorkbook({
      userTimezone: 'UTC',
      chartRendering: {
        rasterBackend: {
          id: 'test-custom-raster',
          runtime: 'custom',
          supportedFormats: ['png'],
          render(request) {
            rasterRequests.push(request);
            return {
              bytes: new Uint8Array([9]),
              format: 'png',
              width: request.options.width * request.options.pixelRatio,
              height: request.options.height * request.options.pixelRatio,
            };
          },
        },
      },
    });
    const sheet = wb.activeSheet;

    await sheet.setCell('A1', 'Category');
    await sheet.setCell('B1', 'Value');
    await sheet.setCell('A2', 'A');
    await sheet.setCell('B2', 10);
    await sheet.setCell('A3', 'B');
    await sheet.setCell('B3', 20);

    const chart = await sheet.charts.add({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 3,
      width: 6,
      height: 10,
      dataRange: 'A1:B3',
    });

    const dataUrl = await sheet.charts.exportImage(chart.id, {
      format: 'png',
      width: 120,
      height: 80,
      pixelRatio: 1,
      backgroundColor: '#ffffff',
    });

    expect(dataUrl).toBe('data:image/png;base64,CQ==');
    expect(rasterRequests).toHaveLength(1);
    expect(rasterRequests[0]).toMatchObject({
      version: 1,
      options: {
        format: 'png',
        width: 120,
        height: 80,
        pixelRatio: 1,
      },
    });
  });

  it('exports created charts through Workbook.toXlsx production exporter', async () => {
    wb = await createWorkbook({ userTimezone: 'UTC' });
    const sheet = wb.activeSheet;

    await sheet.setCell('A1', 'Month');
    await sheet.setCell('B1', 'Revenue');
    await sheet.setCell('A2', 'Jan');
    await sheet.setCell('B2', 12);
    await sheet.setCell('A3', 'Feb');
    await sheet.setCell('B3', 28);
    await sheet.setCell('A4', 'Mar');
    await sheet.setCell('B4', 19);

    await sheet.charts.add({
      type: 'bar',
      anchorRow: 0,
      anchorCol: 3,
      width: 8,
      height: 12,
      dataRange: 'A1:B4',
      title: 'Quarter Revenue',
    });

    const xlsxBytes = await wb.toXlsx();
    expect(xlsxBytes).toBeInstanceOf(Uint8Array);
    expect(xlsxBytes.byteLength).toBeGreaterThan(0);

    importedWb = await createWorkbook(xlsxBytes);
    const importedCharts = await importedWb.activeSheet.charts.list();

    expect(importedCharts).toHaveLength(1);
    expect(importedCharts[0]).toMatchObject({
      type: 'bar',
      title: 'Quarter Revenue',
    });
    expect(importedCharts[0]?.dataRange).toBeTruthy();
  });
});

function decodePng(bytes: Uint8Array): DecodedPng {
  expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Uint8Array[] = [];

  while (offset < bytes.byteLength) {
    const length = readU32(bytes, offset);
    const type = Buffer.from(bytes.slice(offset + 4, offset + 8)).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = bytes.slice(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8 || colorType !== 6) {
    throw new Error(
      `Unsupported PNG payload: ${width}x${height}, depth ${bitDepth}, color ${colorType}`,
    );
  }

  const compressed = Buffer.concat(idatChunks.map((chunk) => Buffer.from(chunk)));
  const scanlines = inflateSync(compressed);
  return { width, height, rgba: unfilterRgbaScanlines(scanlines, width, height) };
}

let cachedComputeWasmModule: Promise<WebAssembly.Module> | null = null;
let cachedChartRasterWasmModule: Promise<WebAssembly.Module> | null = null;

async function computeWasmModule(): Promise<WebAssembly.Module> {
  cachedComputeWasmModule ??= readFile(
    new URL('../../../compute/wasm/npm/compute_core_wasm_bg.wasm', import.meta.url),
  ).then((bytes) => WebAssembly.compile(exactArrayBuffer(bytes)));
  return cachedComputeWasmModule;
}

async function chartRasterWasmModule(): Promise<WebAssembly.Module> {
  cachedChartRasterWasmModule ??= readFile(
    new URL(
      '../../../compute/chart-render-wasm/npm/compute_chart_render_wasm_bg.wasm',
      import.meta.url,
    ),
  ).then((bytes) => WebAssembly.compile(exactArrayBuffer(bytes)));
  return cachedChartRasterWasmModule;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const exact = new Uint8Array(bytes.byteLength);
  exact.set(bytes);
  return exact.buffer;
}

function unfilterRgbaScanlines(scanlines: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const output = new Uint8Array(stride * height);
  let inputOffset = 0;

  for (let y = 0; y < height; y++) {
    const filter = scanlines[inputOffset++];
    const rowOffset = y * stride;
    const previousRowOffset = rowOffset - stride;

    for (let x = 0; x < stride; x++) {
      const raw = scanlines[inputOffset++];
      const left = x >= bytesPerPixel ? output[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? output[previousRowOffset + x] : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel ? output[previousRowOffset + x - bytesPerPixel] : 0;

      output[rowOffset + x] = (raw + filterPredictor(filter, left, up, upLeft)) & 0xff;
    }
  }

  return output;
}

function filterPredictor(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4:
      return paeth(left, up, upLeft);
    default:
      throw new Error(`Unsupported PNG filter ${filter}`);
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function nonWhitePixels(rgba: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    if (
      rgba[offset + 3] > 0 &&
      (rgba[offset] < 245 || rgba[offset + 1] < 245 || rgba[offset + 2] < 245)
    ) {
      count++;
    }
  }
  return count;
}
