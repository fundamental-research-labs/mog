import { Buffer } from 'node:buffer';

import { normalizeImageExportOptions } from '@mog/charts/export';
import type { ChartImageExporter } from '@mog-sdk/contracts/api';
import type { ChartMark, IChartBridge } from '@mog-sdk/contracts/bridges';
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

type ChartMarkStyle = ChartMark['style'];
type ChartPaint = NonNullable<ChartMarkStyle['fillPaint']>;
type ChartTextMark = Extract<ChartMark, { type: 'text' }>;
type ChartSymbolMark = Extract<ChartMark, { type: 'symbol' }>;

type SerializableMarkType = ChartMark['type'];
type SerializableSymbolShape = Extract<
  ChartSymbolMark['shape'],
  'circle' | 'square' | 'diamond' | 'cross' | 'triangle-up' | 'triangle-down'
>;

type SerializableStyle = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDash?: number[];
  opacity?: number;
  cornerRadius?: number;
};

type SerializableClip = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SerializableMarkBase = {
  type: SerializableMarkType;
  clip?: SerializableClip;
  style: SerializableStyle;
};

type SerializableRectMark = SerializableMarkBase & {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
};

type SerializablePathMark = SerializableMarkBase & {
  type: 'path';
  x: number;
  y: number;
  path: string;
};

type SerializableArcMark = SerializableMarkBase & {
  type: 'arc';
  x: number;
  y: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
};

type SerializableSymbolMark = SerializableMarkBase & {
  type: 'symbol';
  x: number;
  y: number;
  shape: SerializableSymbolShape;
  size: number;
};

type SerializableTextMark = SerializableMarkBase & {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  textAlign: 'left' | 'center' | 'right';
  textBaseline: 'top' | 'middle' | 'bottom';
  rotation?: number;
  fontWeight?: 'normal' | 'bold' | number;
  fontStyle?: 'normal' | 'italic';
};

type SerializableMark =
  | SerializableRectMark
  | SerializablePathMark
  | SerializableArcMark
  | SerializableSymbolMark
  | SerializableTextMark;

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

function serializeMark(mark: ChartMark, index: number): SerializableMark {
  const style = serializeStyle(mark.style, index);
  const clip = serializeClip(mark.clip, index);

  switch (mark.type) {
    case 'rect':
      return {
        type: mark.type,
        x: finiteNumber(mark.x, 'x', index),
        y: finiteNumber(mark.y, 'y', index),
        width: finiteNumber(mark.width, 'width', index),
        height: finiteNumber(mark.height, 'height', index),
        ...(clip ? { clip } : {}),
        style,
      };
    case 'path':
      return {
        type: mark.type,
        x: finiteNumber(mark.x, 'x', index),
        y: finiteNumber(mark.y, 'y', index),
        path: stringValue(mark.path, 'path', index),
        ...(clip ? { clip } : {}),
        style,
      };
    case 'arc':
      return {
        type: mark.type,
        x: finiteNumber(mark.x, 'x', index),
        y: finiteNumber(mark.y, 'y', index),
        innerRadius: finiteNumber(mark.innerRadius, 'innerRadius', index),
        outerRadius: finiteNumber(mark.outerRadius, 'outerRadius', index),
        startAngle: finiteNumber(mark.startAngle, 'startAngle', index),
        endAngle: finiteNumber(mark.endAngle, 'endAngle', index),
        ...(clip ? { clip } : {}),
        style,
      };
    case 'symbol':
      return {
        type: mark.type,
        x: finiteNumber(mark.x, 'x', index),
        y: finiteNumber(mark.y, 'y', index),
        shape: symbolShapeField(mark.shape, index),
        size: finiteNumber(mark.size, 'size', index),
        ...(clip ? { clip } : {}),
        style,
      };
    case 'text':
      return {
        type: mark.type,
        x: finiteNumber(mark.x, 'x', index),
        y: finiteNumber(mark.y, 'y', index),
        text: stringValue(mark.text, 'text', index),
        fontSize: finiteNumber(mark.fontSize, 'fontSize', index),
        fontFamily: stringValue(mark.fontFamily, 'fontFamily', index),
        textAlign: textAlignField(mark.textAlign, index),
        textBaseline: textBaselineField(mark.textBaseline, index),
        rotation: optionalFiniteNumber(mark.rotation, 'rotation', index),
        fontWeight: fontWeightField(mark.fontWeight, index),
        fontStyle: fontStyleField(mark.fontStyle, index),
        ...(clip ? { clip } : {}),
        style,
      };
    default:
      // Runtime guard for untyped custom bridge implementations.
      const type = (mark as { type?: unknown }).type;
      throw new Error(`Unsupported chart mark type "${String(type)}" at index ${index}`);
  }
}

function serializeClip(clip: ChartMark['clip'], index: number): SerializableClip | undefined {
  if (clip === undefined) return undefined;
  return {
    x: finiteNumber(clip.x, 'clip.x', index),
    y: finiteNumber(clip.y, 'clip.y', index),
    width: finiteNumber(clip.width, 'clip.width', index),
    height: finiteNumber(clip.height, 'clip.height', index),
  };
}

function serializeStyle(source: ChartMarkStyle, index: number): SerializableStyle {
  const style: SerializableStyle = {};

  const fillPaint = serializablePaint(source.fillPaint);
  if (fillPaint.kind === 'color') {
    style.fill = fillPaint.color;
  } else if (fillPaint.kind !== 'none') {
    optionalStringInto(style, 'fill', source.fill, index);
  }

  const strokePaint = serializablePaint(source.line?.paint ?? source.strokePaint);
  if (strokePaint.kind === 'color') {
    style.stroke = strokePaint.color;
  } else if (strokePaint.kind !== 'none') {
    optionalStringInto(style, 'stroke', source.stroke, index);
  }

  optionalNumberInto(style, 'strokeWidth', source.line?.width ?? source.strokeWidth, index);
  optionalNumberInto(style, 'opacity', source.opacity, index);
  optionalNumberInto(style, 'cornerRadius', source.cornerRadius, index);

  const strokeDash = source.line?.dash ?? source.strokeDash;
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

function finiteNumber(value: unknown, field: string, index: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid chart mark at index ${index}: ${field} must be a finite number`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, field: string, index: number): number | undefined {
  if (value === undefined) return undefined;
  return finiteNumber(value, field, index);
}

function stringValue(value: unknown, field: string, index: number): string {
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

function textAlignField(value: unknown, index: number): 'left' | 'center' | 'right' {
  if (value === 'left' || value === 'center' || value === 'right') return value;
  throw new Error(`Invalid chart mark at index ${index}: unsupported textAlign "${value}"`);
}

function textBaselineField(value: unknown, index: number): 'top' | 'middle' | 'bottom' {
  if (value === 'top' || value === 'middle' || value === 'bottom') return value;
  throw new Error(`Invalid chart mark at index ${index}: unsupported textBaseline "${value}"`);
}

function symbolShapeField(value: unknown, index: number): SerializableSymbolShape {
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
  value: ChartTextMark['fontWeight'],
  index: number,
): 'normal' | 'bold' | number | undefined {
  if (value === undefined) return undefined;
  if (value === 'normal' || value === 'bold') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(
    `Invalid chart mark at index ${index}: fontWeight must be "normal", "bold", or a finite number`,
  );
}

function fontStyleField(
  value: ChartTextMark['fontStyle'],
  index: number,
): 'normal' | 'italic' | undefined {
  if (value === undefined) return undefined;
  if (value === 'normal' || value === 'italic') return value;
  throw new Error(`Invalid chart mark at index ${index}: fontStyle must be "normal" or "italic"`);
}

type SerializablePaint =
  | { kind: 'none' }
  | { kind: 'unsupported' }
  | { kind: 'color'; color: string };

function serializablePaint(paint: ChartPaint | undefined): SerializablePaint {
  if (!paint) return { kind: 'unsupported' };

  switch (paint.type) {
    case 'none':
      return { kind: 'none' };
    case 'solid':
      return { kind: 'color', color: withPaintOpacity(paint.color, paint.opacity) };
    case 'pattern': {
      const color = paint.foreground ?? paint.background;
      return color
        ? { kind: 'color', color: withPaintOpacity(color, paint.opacity) }
        : { kind: 'unsupported' };
    }
    case 'groupInherited':
      return serializablePaint(paint.fallback);
    case 'linearGradient':
    case 'radialGradient':
    case 'rectangularGradient':
    case 'image':
      return { kind: 'unsupported' };
  }
}

function withPaintOpacity(color: string, opacity: number | undefined): string {
  if (opacity === undefined || opacity >= 1) return color;

  const normalized = color.startsWith('#') ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return color;

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const alpha = Math.max(0, Math.min(1, opacity));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
