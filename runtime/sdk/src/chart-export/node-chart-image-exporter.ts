import { Buffer } from 'node:buffer';

import { normalizeImageExportOptions } from '@mog/charts/export';
import type { ChartImageExporter } from '@mog-sdk/contracts/api';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ImageExportOptions } from '@mog-sdk/contracts/data/charts';

type NativeChartRasterResult = {
  readonly bytes: Uint8Array;
  readonly format: 'png' | 'jpeg';
  readonly width: number;
  readonly height: number;
};

type NativeChartRasterAddon = {
  readonly render_chart_marks_image?: (requestJson: string) => NativeChartRasterResult;
};

type SerializableMarkType = 'rect' | 'path' | 'line' | 'area' | 'arc' | 'symbol' | 'text';

type SerializableStyle = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDash?: number[];
  opacity?: number;
  cornerRadius?: number;
};

type SerializableMark = {
  type: SerializableMarkType;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  path?: string;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  textBaseline?: 'top' | 'middle' | 'bottom';
  rotation?: number;
  fontWeight?: 'normal' | 'bold' | number;
  shape?: 'circle' | 'square' | 'diamond' | 'cross' | 'triangle-up' | 'triangle-down';
  size?: number;
  style: SerializableStyle;
};

export function createNodeChartImageExporterFactory(
  addon: NativeChartRasterAddon,
): (chartBridge: IChartBridge) => ChartImageExporter {
  const backend = createNativeChartRasterBackend(addon);
  return (chartBridge) => new NodeChartImageExporter(chartBridge, backend);
}

class NodeChartImageExporter implements ChartImageExporter {
  constructor(
    private readonly chartBridge: IChartBridge,
    private readonly backend: NativeChartRasterBackend,
  ) {}

  async exportImage(
    sheetId: string,
    chartId: string,
    options?: ImageExportOptions,
  ): Promise<string> {
    const normalized = normalizeImageExportOptions(options);
    const marks = await this.chartBridge.getMarksAtSize(
      sheetId as SheetId,
      chartId,
      normalized.width,
      normalized.height,
    );

    if (!Array.isArray(marks)) {
      throw new Error(`Chart mark compilation failed: ${marks.message}`);
    }
    if (marks.length === 0) {
      throw new Error('Chart mark compilation returned no marks');
    }

    const serializedMarks = marks.map((mark, index) => serializeMark(mark, index));
    const rendered = this.backend.render({
      version: 1,
      marks: serializedMarks,
      options: {
        format: normalized.format,
        width: normalized.width,
        height: normalized.height,
        pixelRatio: normalized.pixelRatio,
        backgroundColor: normalized.backgroundColor,
        quality: normalized.quality,
      },
    });

    if (
      rendered.format !== normalized.format ||
      rendered.width !== normalized.physicalWidth ||
      rendered.height !== normalized.physicalHeight
    ) {
      throw new Error(
        `Native chart raster backend returned ${rendered.format} ${rendered.width}x${rendered.height}, expected ${normalized.format} ${normalized.physicalWidth}x${normalized.physicalHeight}`,
      );
    }

    return `data:${normalized.mimeType};base64,${Buffer.from(rendered.bytes).toString('base64')}`;
  }
}

type NativeChartRasterRequest = {
  readonly version: 1;
  readonly marks: readonly SerializableMark[];
  readonly options: {
    readonly format: 'png' | 'jpeg';
    readonly width: number;
    readonly height: number;
    readonly pixelRatio: number;
    readonly backgroundColor: string;
    readonly quality?: number;
  };
};

type NativeChartRasterBackend = {
  render(request: NativeChartRasterRequest): NativeChartRasterResult;
};

function createNativeChartRasterBackend(addon: NativeChartRasterAddon): NativeChartRasterBackend {
  const render = addon.render_chart_marks_image;
  if (typeof render !== 'function') {
    throw new Error('Native chart raster backend is unavailable in this @mog-sdk/node package');
  }

  return {
    render(request: NativeChartRasterRequest): NativeChartRasterResult {
      return render(JSON.stringify(request));
    },
  };
}

function serializeMark(mark: unknown, index: number): SerializableMark {
  const source = record(mark, index, 'mark');
  const type = stringField(source, 'type', index) as SerializableMarkType;
  const style = serializeStyle(source, index);

  switch (type) {
    case 'rect':
      return {
        type,
        x: numberField(source, 'x', index),
        y: numberField(source, 'y', index),
        width: numberField(source, 'width', index),
        height: numberField(source, 'height', index),
        style,
      };
    case 'path':
    case 'line':
    case 'area':
      return {
        type,
        x: optionalNumberField(source, 'x', index) ?? 0,
        y: optionalNumberField(source, 'y', index) ?? 0,
        path: stringField(source, 'path', index),
        style,
      };
    case 'arc':
      return {
        type,
        x: numberField(source, 'x', index),
        y: numberField(source, 'y', index),
        innerRadius: numberField(source, 'innerRadius', index),
        outerRadius: numberField(source, 'outerRadius', index),
        startAngle: numberField(source, 'startAngle', index),
        endAngle: numberField(source, 'endAngle', index),
        style,
      };
    case 'symbol':
      return {
        type,
        x: numberField(source, 'x', index),
        y: numberField(source, 'y', index),
        shape: symbolShapeField(source, index),
        size: numberField(source, 'size', index),
        style,
      };
    case 'text':
      return {
        type,
        x: numberField(source, 'x', index),
        y: numberField(source, 'y', index),
        text: stringField(source, 'text', index),
        fontSize: numberField(source, 'fontSize', index),
        fontFamily: stringField(source, 'fontFamily', index),
        textAlign: textAlignField(source, index),
        textBaseline: textBaselineField(source, index),
        rotation: optionalNumberField(source, 'rotation', index),
        fontWeight: fontWeightField(source, index),
        style,
      };
    default:
      throw new Error(`Unsupported chart mark type "${String(type)}" at index ${index}`);
  }
}

function serializeStyle(source: Record<string, unknown>, index: number): SerializableStyle {
  const nested = source.style === undefined ? {} : record(source.style, index, 'style');
  const style: SerializableStyle = {};
  optionalStringInto(style, 'fill', nested.fill ?? source.fill, index);
  optionalStringInto(style, 'stroke', nested.stroke ?? source.stroke, index);
  optionalNumberInto(style, 'strokeWidth', nested.strokeWidth ?? source.strokeWidth, index);
  optionalNumberInto(style, 'opacity', nested.opacity ?? source.opacity, index);
  optionalNumberInto(style, 'cornerRadius', nested.cornerRadius ?? source.cornerRadius, index);

  const strokeDash = nested.strokeDash ?? source.strokeDash;
  if (strokeDash !== undefined) {
    if (!Array.isArray(strokeDash)) {
      throw new Error(`Invalid chart mark at index ${index}: style.strokeDash must be an array`);
    }
    style.strokeDash = strokeDash.map((value, dashIndex) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(
          `Invalid chart mark at index ${index}: style.strokeDash[${dashIndex}] must be a finite non-negative number`,
        );
      }
      return value;
    });
  }

  return style;
}

function record(value: unknown, index: number, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid chart mark at index ${index}: ${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function numberField(source: Record<string, unknown>, field: string, index: number): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid chart mark at index ${index}: ${field} must be a finite number`);
  }
  return value;
}

function optionalNumberField(
  source: Record<string, unknown>,
  field: string,
  index: number,
): number | undefined {
  if (source[field] === undefined) return undefined;
  return numberField(source, field, index);
}

function stringField(source: Record<string, unknown>, field: string, index: number): string {
  const value = source[field];
  if (typeof value !== 'string') {
    throw new Error(`Invalid chart mark at index ${index}: ${field} must be a string`);
  }
  return value;
}

function optionalStringInto(
  style: SerializableStyle,
  field: 'fill' | 'stroke',
  value: unknown,
  index: number,
): void {
  if (value === undefined) return;
  if (typeof value !== 'string') {
    throw new Error(`Invalid chart mark at index ${index}: style.${field} must be a string`);
  }
  style[field] = value;
}

function optionalNumberInto(
  style: SerializableStyle,
  field: 'strokeWidth' | 'opacity' | 'cornerRadius',
  value: unknown,
  index: number,
): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid chart mark at index ${index}: style.${field} must be a finite number`);
  }
  style[field] = value;
}

function textAlignField(
  source: Record<string, unknown>,
  index: number,
): 'left' | 'center' | 'right' {
  const value = stringField(source, 'textAlign', index);
  if (value === 'left' || value === 'center' || value === 'right') return value;
  throw new Error(`Invalid chart mark at index ${index}: unsupported textAlign "${value}"`);
}

function textBaselineField(
  source: Record<string, unknown>,
  index: number,
): 'top' | 'middle' | 'bottom' {
  const value = stringField(source, 'textBaseline', index);
  if (value === 'top' || value === 'middle' || value === 'bottom') return value;
  throw new Error(`Invalid chart mark at index ${index}: unsupported textBaseline "${value}"`);
}

function symbolShapeField(
  source: Record<string, unknown>,
  index: number,
): 'circle' | 'square' | 'diamond' | 'cross' | 'triangle-up' | 'triangle-down' {
  const value = stringField(source, 'shape', index);
  if (
    value === 'circle' ||
    value === 'square' ||
    value === 'diamond' ||
    value === 'cross' ||
    value === 'triangle-up' ||
    value === 'triangle-down'
  ) {
    return value;
  }
  throw new Error(`Invalid chart mark at index ${index}: unsupported symbol shape "${value}"`);
}

function fontWeightField(
  source: Record<string, unknown>,
  index: number,
): 'normal' | 'bold' | number | undefined {
  const value = source.fontWeight;
  if (value === undefined) return undefined;
  if (value === 'normal' || value === 'bold') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(
    `Invalid chart mark at index ${index}: fontWeight must be "normal", "bold", or a finite number`,
  );
}
