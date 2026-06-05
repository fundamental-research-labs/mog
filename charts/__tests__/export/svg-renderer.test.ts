import type { ChartMark } from '@mog-sdk/contracts/bridges';

import { normalizeImageExportOptions } from '../../src/export/image-options';
import { serializeChartMarks } from '../../src/export/mark-serialization';
import { renderChartMarksSvg } from '../../src/export/svg-renderer';

describe('renderChartMarksSvg', () => {
  it('renders well-formed base64 SVG for core mark types and escapes XML content', () => {
    const options = vectorOptions({
      width: 120,
      height: 80,
      backgroundColor: '#ffffff',
    });
    const marks: ChartMark[] = [
      {
        type: 'rect',
        x: 4,
        y: 6,
        width: 30,
        height: 20,
        clip: { x: 0, y: 0, width: 60, height: 50 },
        style: { fillPaint: { type: 'solid', color: '#123456', opacity: 0.5 }, cornerRadius: 3 },
      },
      {
        type: 'path',
        x: 10,
        y: 12,
        path: 'M 0 0 L 12 8',
        style: { stroke: '#111111', strokeWidth: 2, fillPaint: { type: 'none' } },
      },
      {
        type: 'arc',
        x: 70,
        y: 30,
        innerRadius: 6,
        outerRadius: 14,
        startAngle: 0,
        endAngle: Math.PI,
        style: { fill: '#abcdef' },
      },
      {
        type: 'symbol',
        x: 95,
        y: 30,
        shape: 'diamond',
        size: 64,
        style: { fill: '#654321' },
      },
      {
        type: 'text',
        x: 8,
        y: 70,
        text: 'Sales & <Q1> "A"',
        fontSize: 12,
        fontFamily: 'A "Font", sans-serif',
        textAlign: 'left',
        textBaseline: 'top',
        rotation: Math.PI / 8,
        style: { fill: '#222222' },
      },
    ];

    const rendered = renderChartMarksSvg({
      marks: serializeChartMarks(marks),
      options,
    });

    expect(rendered.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const svg = decodeDataUrl(rendered.dataUrl);
    expect(() => assertWellFormedXml(svg)).not.toThrow();
    expect(svg).toContain('viewBox="0 0 120 80"');
    expect(svg).toContain('id="mog-chart-clip-0"');
    expect(svg).toContain('clip-path="url(#mog-chart-clip-0)"');
    expect(svg).toContain('fill="rgba(18, 52, 86, 0.5)"');
    expect(svg).toContain('transform="translate(10 12)"');
    expect(svg).toContain('Sales &amp; &lt;Q1&gt; "A"');
    expect(svg).toContain('font-family="A &quot;Font&quot;, sans-serif"');
  });

  it('renders every supported symbol shape into path elements', () => {
    const options = vectorOptions({ width: 160, height: 40 });
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
      x: 10 + index * 16,
      y: 20,
      shape,
      size: 36,
      style: { fill: '#123456' },
    })) satisfies ChartMark[];

    const svg = decodeDataUrl(
      renderChartMarksSvg({ marks: serializeChartMarks(marks), options }).dataUrl,
    );

    expect(() => assertWellFormedXml(svg)).not.toThrow();
    expect(svg.match(/<path /g)).toHaveLength(shapes.length);
  });
});

function vectorOptions(input: {
  readonly width: number;
  readonly height: number;
  readonly backgroundColor?: string;
}) {
  const normalized = normalizeImageExportOptions({ format: 'svg', ...input });
  if (normalized.kind !== 'vector') {
    throw new Error('Expected vector options');
  }
  return normalized;
}

function decodeDataUrl(dataUrl: string): string {
  const [, base64] = dataUrl.split(',', 2);
  return Buffer.from(base64, 'base64').toString('utf8');
}

function assertWellFormedXml(xml: string): void {
  const stack: string[] = [];
  const tagPattern = /<([^!?][^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(xml)) !== null) {
    const raw = match[1].trim();
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      expect(stack.pop()).toBe(name);
      continue;
    }
    if (raw.endsWith('/')) continue;
    const name = raw.split(/\s+/, 1)[0];
    stack.push(name);
  }

  expect(stack).toEqual([]);
}
