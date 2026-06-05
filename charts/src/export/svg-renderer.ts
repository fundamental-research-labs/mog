import { utf8ToBase64 } from './data-url';
import type { NormalizedVectorImageExportOptions } from './image-options';
import type {
  SerializableChartArcMark,
  SerializableChartMark,
  SerializableChartMarkStyle,
  SerializableChartPathMark,
  SerializableChartRectMark,
  SerializableChartSymbolMark,
  SerializableChartTextMark,
} from './mark-serialization';

export interface ChartSvgRenderRequest {
  readonly marks: readonly SerializableChartMark[];
  readonly options: NormalizedVectorImageExportOptions;
}

export interface ChartSvgRenderResult {
  readonly svg: string;
  readonly dataUrl: string;
}

export function renderChartMarksSvg(request: ChartSvgRenderRequest): ChartSvgRenderResult {
  const { marks, options } = request;
  const defs: string[] = [];
  const body: string[] = [];

  body.push(
    `<rect x="0" y="0" width="${formatNumber(options.width)}" height="${formatNumber(
      options.height,
    )}" fill="${escapeAttr(validatePaint(options.backgroundColor, 'backgroundColor'))}"/>`,
  );

  marks.forEach((mark, index) => {
    body.push(renderMark(mark, index, defs));
  });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(
      options.width,
    )}" height="${formatNumber(options.height)}" viewBox="0 0 ${formatNumber(
      options.width,
    )} ${formatNumber(options.height)}" role="img">`,
    defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '',
    ...body,
    '</svg>',
  ].join('');

  return {
    svg,
    dataUrl: `data:image/svg+xml;base64,${utf8ToBase64(svg)}`,
  };
}

function renderMark(mark: SerializableChartMark, index: number, defs: string[]): string {
  const rendered = renderUnclippedMark(mark);
  if (!mark.clip) return rendered;

  const clipId = `mog-chart-clip-${index}`;
  const clip = mark.clip;
  defs.push(
    `<clipPath id="${clipId}"><rect x="${formatNumber(clip.x)}" y="${formatNumber(
      clip.y,
    )}" width="${formatNumber(clip.width)}" height="${formatNumber(clip.height)}"/></clipPath>`,
  );
  return `<g clip-path="url(#${clipId})">${rendered}</g>`;
}

function renderUnclippedMark(mark: SerializableChartMark): string {
  switch (mark.type) {
    case 'rect':
      return renderRect(mark);
    case 'path':
      return renderPath(mark);
    case 'arc':
      return renderArc(mark);
    case 'symbol':
      return renderSymbol(mark);
    case 'text':
      return renderText(mark);
  }
}

function renderRect(mark: SerializableChartRectMark): string {
  const radius = mark.style.cornerRadius;
  const radiusAttrs =
    radius !== undefined && radius > 0
      ? ` rx="${formatNumber(radius)}" ry="${formatNumber(radius)}"`
      : '';
  return `<rect x="${formatNumber(mark.x)}" y="${formatNumber(mark.y)}" width="${formatNumber(
    mark.width,
  )}" height="${formatNumber(mark.height)}"${radiusAttrs}${styleAttrs(mark.style)}/>`;
}

function renderPath(mark: SerializableChartPathMark): string {
  validatePathData(mark.path);
  const transform =
    mark.x !== 0 || mark.y !== 0
      ? ` transform="${escapeAttr(`translate(${formatNumber(mark.x)} ${formatNumber(mark.y)})`)}"`
      : '';
  return `<path d="${escapeAttr(mark.path)}"${transform}${styleAttrs(mark.style)}/>`;
}

function renderArc(mark: SerializableChartArcMark): string {
  return `<path d="${escapeAttr(arcPathData(mark))}" fill-rule="evenodd"${styleAttrs(
    mark.style,
  )}/>`;
}

function renderSymbol(mark: SerializableChartSymbolMark): string {
  const path = symbolPathData(mark);
  return `<path d="${escapeAttr(path)}"${styleAttrs(symbolStyle(mark))}/>`;
}

function renderText(mark: SerializableChartTextMark): string {
  const anchor = textAnchor(mark.textAlign);
  const baseline = dominantBaseline(mark.textBaseline);
  const rotation =
    mark.rotation !== undefined && mark.rotation !== 0
      ? ` transform="${escapeAttr(
          `rotate(${formatNumber((mark.rotation * 180) / Math.PI)} ${formatNumber(
            mark.x,
          )} ${formatNumber(mark.y)})`,
        )}"`
      : '';
  const maxWidth = mark.maxWidth !== undefined ? ` textLength="${formatNumber(mark.maxWidth)}"` : '';
  const fontWeight =
    mark.fontWeight !== undefined ? ` font-weight="${escapeAttr(String(mark.fontWeight))}"` : '';
  const fontStyle = mark.fontStyle !== undefined ? ` font-style="${escapeAttr(mark.fontStyle)}"` : '';
  const decoration = textDecoration(mark);
  return `<text x="${formatNumber(mark.x)}" y="${formatNumber(mark.y)}" font-family="${escapeAttr(
    mark.fontFamily,
  )}" font-size="${formatNumber(mark.fontSize)}" text-anchor="${anchor}" dominant-baseline="${baseline}"${fontWeight}${fontStyle}${decoration}${maxWidth}${rotation}${styleAttrs(
    mark.style,
  )}>${escapeText(mark.text)}</text>`;
}

function styleAttrs(style: SerializableChartMarkStyle): string {
  const fill = style.fill === undefined ? 'none' : validatePaint(style.fill, 'style.fill');
  const stroke = style.stroke === undefined ? 'none' : validatePaint(style.stroke, 'style.stroke');
  const attrs = [
    `fill="${escapeAttr(fill)}"`,
    `stroke="${escapeAttr(stroke)}"`,
  ];

  if (style.strokeWidth !== undefined) {
    attrs.push(`stroke-width="${formatNumber(nonNegative(style.strokeWidth, 'style.strokeWidth'))}"`);
  }
  if (style.strokeDash !== undefined && style.strokeDash.length > 0) {
    attrs.push(
      `stroke-dasharray="${escapeAttr(
        style.strokeDash.map((value) => formatNumber(nonNegative(value, 'style.strokeDash'))).join(' '),
      )}"`,
    );
  }
  if (style.opacity !== undefined) {
    attrs.push(`opacity="${formatNumber(unitInterval(style.opacity, 'style.opacity'))}"`);
  }

  return ` ${attrs.join(' ')}`;
}

function symbolStyle(mark: SerializableChartSymbolMark): SerializableChartMarkStyle {
  if (!isOpenLineSymbol(mark.shape) || mark.style.stroke !== undefined) {
    return mark.style;
  }
  return {
    ...mark.style,
    stroke: mark.style.fill,
    fill: undefined,
  };
}

function isOpenLineSymbol(shape: SerializableChartSymbolMark['shape']): boolean {
  return shape === 'x' || shape === 'dash';
}

function arcPathData(mark: SerializableChartArcMark): string {
  const span = mark.endAngle - mark.startAngle;
  const normalizedAbsSpan = Math.abs(span);
  const fullCircle = normalizedAbsSpan >= Math.PI * 2 - 1e-6;
  const innerRadius = Math.max(0, Math.min(mark.innerRadius, mark.outerRadius));

  if (fullCircle) {
    if (innerRadius <= 0) {
      return circlePathData(mark.x, mark.y, mark.outerRadius);
    }
    return `${circlePathData(mark.x, mark.y, mark.outerRadius)} ${circlePathData(
      mark.x,
      mark.y,
      innerRadius,
      true,
    )}`;
  }

  const outerStart = polarPoint(mark.x, mark.y, mark.outerRadius, mark.startAngle);
  const outerEnd = polarPoint(mark.x, mark.y, mark.outerRadius, mark.endAngle);
  const largeArc = normalizedAbsSpan > Math.PI ? 1 : 0;
  const sweep = span >= 0 ? 1 : 0;

  if (innerRadius <= 0) {
    return [
      `M ${formatNumber(mark.x)} ${formatNumber(mark.y)}`,
      `L ${formatNumber(outerStart.x)} ${formatNumber(outerStart.y)}`,
      `A ${formatNumber(mark.outerRadius)} ${formatNumber(mark.outerRadius)} 0 ${largeArc} ${sweep} ${formatNumber(outerEnd.x)} ${formatNumber(outerEnd.y)}`,
      'Z',
    ].join(' ');
  }

  const innerStart = polarPoint(mark.x, mark.y, innerRadius, mark.startAngle);
  const innerEnd = polarPoint(mark.x, mark.y, innerRadius, mark.endAngle);
  return [
    `M ${formatNumber(outerStart.x)} ${formatNumber(outerStart.y)}`,
    `A ${formatNumber(mark.outerRadius)} ${formatNumber(mark.outerRadius)} 0 ${largeArc} ${sweep} ${formatNumber(outerEnd.x)} ${formatNumber(outerEnd.y)}`,
    `L ${formatNumber(innerEnd.x)} ${formatNumber(innerEnd.y)}`,
    `A ${formatNumber(innerRadius)} ${formatNumber(innerRadius)} 0 ${largeArc} ${sweep ? 0 : 1} ${formatNumber(innerStart.x)} ${formatNumber(innerStart.y)}`,
    'Z',
  ].join(' ');
}

function circlePathData(x: number, y: number, radius: number, reverse = false): string {
  const sweep = reverse ? 0 : 1;
  return [
    `M ${formatNumber(x)} ${formatNumber(y - radius)}`,
    `A ${formatNumber(radius)} ${formatNumber(radius)} 0 1 ${sweep} ${formatNumber(
      x,
    )} ${formatNumber(y + radius)}`,
    `A ${formatNumber(radius)} ${formatNumber(radius)} 0 1 ${sweep} ${formatNumber(
      x,
    )} ${formatNumber(y - radius)}`,
    'Z',
  ].join(' ');
}

function polarPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const theta = angle - Math.PI / 2;
  return {
    x: cx + Math.cos(theta) * radius,
    y: cy + Math.sin(theta) * radius,
  };
}

function symbolPathData(mark: SerializableChartSymbolMark): string {
  const { x, y, size, shape } = mark;
  const radius = Math.sqrt(size / Math.PI);

  switch (shape) {
    case 'circle':
      return circlePathData(x, y, radius);
    case 'square': {
      const side = Math.sqrt(size);
      const half = side / 2;
      return rectPathData(x - half, y - half, side, side);
    }
    case 'diamond': {
      const halfDiag = (Math.sqrt(size) * Math.SQRT2) / 2;
      return `M ${formatNumber(x)} ${formatNumber(y - halfDiag)} L ${formatNumber(
        x + halfDiag,
      )} ${formatNumber(y)} L ${formatNumber(x)} ${formatNumber(y + halfDiag)} L ${formatNumber(
        x - halfDiag,
      )} ${formatNumber(y)} Z`;
    }
    case 'cross': {
      const crossRadius = radius * 1.2;
      const arm = crossRadius * 0.35;
      return [
        rectPathData(x - crossRadius, y - arm / 2, crossRadius * 2, arm),
        rectPathData(x - arm / 2, y - crossRadius, arm, crossRadius * 2),
      ].join(' ');
    }
    case 'x': {
      const xRadius = radius * 1.2;
      return `M ${formatNumber(x - xRadius)} ${formatNumber(y - xRadius)} L ${formatNumber(
        x + xRadius,
      )} ${formatNumber(y + xRadius)} M ${formatNumber(x + xRadius)} ${formatNumber(
        y - xRadius,
      )} L ${formatNumber(x - xRadius)} ${formatNumber(y + xRadius)}`;
    }
    case 'star': {
      const outer = radius * 1.35;
      const inner = outer * 0.45;
      const points: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        const pointRadius = i % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = x + Math.cos(angle) * pointRadius;
        const py = y + Math.sin(angle) * pointRadius;
        points.push(`${i === 0 ? 'M' : 'L'} ${formatNumber(px)} ${formatNumber(py)}`);
      }
      points.push('Z');
      return points.join(' ');
    }
    case 'dash': {
      const dashRadius = radius * 1.3;
      return `M ${formatNumber(x - dashRadius)} ${formatNumber(y)} L ${formatNumber(
        x + dashRadius,
      )} ${formatNumber(y)}`;
    }
    case 'triangle-up':
    case 'triangle-down': {
      const side = Math.sqrt((4 * size) / Math.sqrt(3));
      const height = (side * Math.sqrt(3)) / 2;
      const offset = height / 3;
      if (shape === 'triangle-up') {
        return `M ${formatNumber(x)} ${formatNumber(y - height + offset)} L ${formatNumber(
          x + side / 2,
        )} ${formatNumber(y + offset)} L ${formatNumber(x - side / 2)} ${formatNumber(
          y + offset,
        )} Z`;
      }
      return `M ${formatNumber(x)} ${formatNumber(y + height - offset)} L ${formatNumber(
        x + side / 2,
      )} ${formatNumber(y - offset)} L ${formatNumber(x - side / 2)} ${formatNumber(
        y - offset,
      )} Z`;
    }
  }
}

function rectPathData(x: number, y: number, width: number, height: number): string {
  return `M ${formatNumber(x)} ${formatNumber(y)} H ${formatNumber(x + width)} V ${formatNumber(
    y + height,
  )} H ${formatNumber(x)} Z`;
}

function textAnchor(align: SerializableChartTextMark['textAlign']): 'start' | 'middle' | 'end' {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

function dominantBaseline(
  baseline: SerializableChartTextMark['textBaseline'],
): 'text-before-edge' | 'middle' | 'text-after-edge' {
  if (baseline === 'top') return 'text-before-edge';
  if (baseline === 'bottom') return 'text-after-edge';
  return 'middle';
}

function textDecoration(mark: SerializableChartTextMark): string {
  const values: string[] = [];
  if (mark.underline) values.push('underline');
  if (mark.strikethrough) values.push('line-through');
  return values.length > 0 ? ` text-decoration="${values.join(' ')}"` : '';
}

function validatePaint(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '') {
    throw new Error(`${field} must be a non-empty paint string`);
  }
  if (/url\s*\(/i.test(normalized)) {
    throw new Error(`${field} cannot reference external paint URLs`);
  }
  if (!/^[#a-zA-Z0-9(),.%\s+-]+$/.test(normalized)) {
    throw new Error(`${field} contains characters that are unsafe for SVG paint attributes`);
  }
  return normalized;
}

function validatePathData(value: string): void {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error('SVG path data contains control characters');
  }
}

function nonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
  return value;
}

function unitInterval(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a finite number between 0 and 1`);
  }
  return value;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('SVG numeric attribute must be finite');
  }
  const rounded = Math.abs(value) < 1e-12 ? 0 : value;
  return Number(rounded.toFixed(6)).toString();
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
