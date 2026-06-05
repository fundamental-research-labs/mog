import type { ChartMark } from '@mog-sdk/contracts/bridges';

type ChartMarkStyle = ChartMark['style'];
type ChartPaint = NonNullable<ChartMarkStyle['fillPaint']>;
type ChartTextMark = Extract<ChartMark, { type: 'text' }>;
type ChartSymbolMark = Extract<ChartMark, { type: 'symbol' }>;

export type SerializableChartMarkType = ChartMark['type'];
export type SerializableChartSymbolShape = ChartSymbolMark['shape'];

const SUPPORTED_SYMBOL_SHAPES = {
  circle: true,
  square: true,
  diamond: true,
  cross: true,
  x: true,
  star: true,
  dash: true,
  'triangle-up': true,
  'triangle-down': true,
} as const satisfies Record<ChartSymbolMark['shape'], true>;

export type SerializableChartMarkStyle = {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeDash?: readonly number[];
  readonly opacity?: number;
  readonly cornerRadius?: number;
};

export type SerializableChartMarkClip = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SerializableChartMarkBase = {
  readonly type: SerializableChartMarkType;
  readonly clip?: SerializableChartMarkClip;
  readonly style: SerializableChartMarkStyle;
};

export type SerializableChartRectMark = SerializableChartMarkBase & {
  readonly type: 'rect';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SerializableChartPathMark = SerializableChartMarkBase & {
  readonly type: 'path';
  readonly x: number;
  readonly y: number;
  readonly path: string;
};

export type SerializableChartArcMark = SerializableChartMarkBase & {
  readonly type: 'arc';
  readonly x: number;
  readonly y: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
};

export type SerializableChartSymbolMark = SerializableChartMarkBase & {
  readonly type: 'symbol';
  readonly x: number;
  readonly y: number;
  readonly shape: SerializableChartSymbolShape;
  readonly size: number;
};

export type SerializableChartTextMark = SerializableChartMarkBase & {
  readonly type: 'text';
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly textAlign: 'left' | 'center' | 'right';
  readonly textBaseline: 'top' | 'middle' | 'bottom';
  readonly rotation?: number;
  readonly maxWidth?: number;
  readonly lineHeight?: number;
  readonly fontWeight?: 'normal' | 'bold' | number;
  readonly fontStyle?: 'normal' | 'italic';
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
};

export type SerializableChartMark =
  | SerializableChartRectMark
  | SerializableChartPathMark
  | SerializableChartArcMark
  | SerializableChartSymbolMark
  | SerializableChartTextMark;

export function serializeChartMarks(marks: readonly ChartMark[]): SerializableChartMark[] {
  return marks.map((mark, index) => serializeChartMark(mark, index));
}

export function translateSerializableChartMarks(
  marks: readonly SerializableChartMark[],
  dx: number,
  dy: number,
): SerializableChartMark[] {
  if (dx === 0 && dy === 0) return marks.slice();
  return marks.map((mark) => translateSerializableChartMark(mark, dx, dy));
}

export function serializeChartMark(mark: ChartMark, index: number): SerializableChartMark {
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
        maxWidth: optionalFiniteNumber(mark.maxWidth, 'maxWidth', index),
        lineHeight: optionalFiniteNumber(mark.lineHeight, 'lineHeight', index),
        fontWeight: fontWeightField(mark.fontWeight, index),
        fontStyle: fontStyleField(mark.fontStyle, index),
        underline: optionalBoolean(mark.underline, 'underline', index),
        strikethrough: optionalBoolean(mark.strikethrough, 'strikethrough', index),
        ...(clip ? { clip } : {}),
        style,
      };
    default:
      // Runtime guard for untyped custom bridge implementations.
      const type = (mark as { type?: unknown }).type;
      throw new Error(`Unsupported chart mark type "${String(type)}" at index ${index}`);
  }
}

function serializeClip(clip: ChartMark['clip'], index: number): SerializableChartMarkClip | undefined {
  if (clip === undefined) return undefined;
  return {
    x: finiteNumber(clip.x, 'clip.x', index),
    y: finiteNumber(clip.y, 'clip.y', index),
    width: finiteNumber(clip.width, 'clip.width', index),
    height: finiteNumber(clip.height, 'clip.height', index),
  };
}

function translateSerializableChartMark(
  mark: SerializableChartMark,
  dx: number,
  dy: number,
): SerializableChartMark {
  const clip = mark.clip ? translateClip(mark.clip, dx, dy) : undefined;
  switch (mark.type) {
    case 'rect':
      return { ...mark, x: mark.x + dx, y: mark.y + dy, ...(clip ? { clip } : {}) };
    case 'path':
      return { ...mark, x: mark.x + dx, y: mark.y + dy, ...(clip ? { clip } : {}) };
    case 'arc':
      return { ...mark, x: mark.x + dx, y: mark.y + dy, ...(clip ? { clip } : {}) };
    case 'symbol':
      return { ...mark, x: mark.x + dx, y: mark.y + dy, ...(clip ? { clip } : {}) };
    case 'text':
      return { ...mark, x: mark.x + dx, y: mark.y + dy, ...(clip ? { clip } : {}) };
  }
}

function translateClip(
  clip: SerializableChartMarkClip,
  dx: number,
  dy: number,
): SerializableChartMarkClip {
  return {
    ...clip,
    x: clip.x + dx,
    y: clip.y + dy,
  };
}

function serializeStyle(source: ChartMarkStyle, index: number): SerializableChartMarkStyle {
  const style: MutableSerializableChartMarkStyle = {};

  const fillPaint = serializablePaint(source.fillPaint);
  if (fillPaint.kind === 'color') {
    style.fill = fillPaint.color;
  } else if (fillPaint.kind !== 'none') {
    optionalStringInto(style, 'fill', source.fill, index);
  }

  const strokeOpacity = source.line?.opacity;
  const strokePaint = serializablePaint(source.line?.paint ?? source.strokePaint, strokeOpacity);
  if (strokePaint.kind === 'color') {
    style.stroke = strokePaint.color;
  } else if (strokePaint.kind !== 'none') {
    optionalStringInto(
      style,
      'stroke',
      typeof source.stroke === 'string' ? withPaintOpacity(source.stroke, strokeOpacity) : undefined,
      index,
    );
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

type MutableSerializableChartMarkStyle = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDash?: number[];
  opacity?: number;
  cornerRadius?: number;
};

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

function optionalBoolean(value: unknown, field: string, index: number): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid chart mark at index ${index}: ${field} must be a boolean`);
  }
  return value;
}

function optionalStringInto(
  style: MutableSerializableChartMarkStyle,
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
  style: MutableSerializableChartMarkStyle,
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

function symbolShapeField(value: unknown, index: number): SerializableChartSymbolShape {
  if (isSupportedSymbolShape(value)) {
    return value;
  }
  throw new Error(`Invalid chart mark at index ${index}: unsupported symbol shape "${value}"`);
}

function isSupportedSymbolShape(value: unknown): value is SerializableChartSymbolShape {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(SUPPORTED_SYMBOL_SHAPES, value)
  );
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
  | { readonly kind: 'none' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'color'; readonly color: string };

function serializablePaint(
  paint: ChartPaint | undefined,
  opacityMultiplier?: number,
): SerializablePaint {
  if (!paint) return { kind: 'unsupported' };

  switch (paint.type) {
    case 'none':
      return { kind: 'none' };
    case 'solid':
      return {
        kind: 'color',
        color: withPaintOpacity(paint.color, multiplyOpacity(paint.opacity, opacityMultiplier)),
      };
    case 'pattern': {
      const color = paint.foreground ?? paint.background;
      return color
        ? {
            kind: 'color',
            color: withPaintOpacity(color, multiplyOpacity(paint.opacity, opacityMultiplier)),
          }
        : { kind: 'unsupported' };
    }
    case 'groupInherited':
      return serializablePaint(paint.fallback, opacityMultiplier);
    case 'linearGradient':
    case 'radialGradient':
    case 'rectangularGradient':
    case 'image':
      return { kind: 'unsupported' };
  }
}

function multiplyOpacity(
  base: number | undefined,
  multiplier: number | undefined,
): number | undefined {
  if (base === undefined) return multiplier;
  if (multiplier === undefined) return base;
  return Math.max(0, Math.min(1, base * multiplier));
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
