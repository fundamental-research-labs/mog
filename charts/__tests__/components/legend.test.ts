/**
 * Legend Component Tests
 */

import {
  calculateLegendPosition,
  calculateLegendSpace,
  flattenLegendMarks,
  generateLegend,
  type LegendMarks,
} from '../../src/components/legend';
import type { ChannelSpec, Layout } from '../../src/grammar/spec';
import type { OrdinalColorScale } from '../../src/primitives/scales/types';

// Mock ordinal color scale for testing
function mockOrdinalColorScale(domain: string[], colors: string[]): OrdinalColorScale {
  const scale = function (value: string): string {
    const index = domain.indexOf(value);
    if (index === -1) return colors[0];
    return colors[index % colors.length];
  };

  scale.domain = function (values?: string[]) {
    if (values === undefined) return [...domain];
    domain = [...values];
    return scale;
  };

  scale.range = function (colors_?: string[]) {
    if (colors_ === undefined) return [...colors];
    colors = [...colors_];
    return scale;
  };

  scale.unknown = function () {
    return undefined;
  };
  scale.copy = function () {
    return mockOrdinalColorScale(domain, colors);
  };

  return scale as OrdinalColorScale;
}

const mockLayout: Layout = {
  width: 800,
  height: 600,
  plotArea: {
    x: 50,
    y: 30,
    width: 600,
    height: 500,
  },
  margin: {
    top: 30,
    right: 150,
    bottom: 70,
    left: 50,
  },
};

describe('generateLegend', () => {
  describe('basic legend', () => {
    it('generates legend entries from scale', () => {
      const channel: ChannelSpec = {
        field: 'category',
        type: 'nominal',
        legend: { title: 'Categories' },
      };
      const scale = mockOrdinalColorScale(['A', 'B', 'C'], ['#4e79a7', '#f28e2c', '#e15759']);

      const legend = generateLegend(channel, scale, mockLayout);

      expect(legend.entries).toHaveLength(3);
      expect(legend.entries[0].label.text).toBe('A');
      expect(legend.entries[1].label.text).toBe('B');
      expect(legend.entries[2].label.text).toBe('C');
    });

    it('generates legend title', () => {
      const channel: ChannelSpec = {
        field: 'category',
        type: 'nominal',
        legend: { title: 'My Legend' },
      };
      const scale = mockOrdinalColorScale(['A', 'B'], ['#4e79a7', '#f28e2c']);

      const legend = generateLegend(channel, scale, mockLayout);

      expect(legend.title).toBeDefined();
      expect(legend.title?.text).toBe('My Legend');
    });

    it('uses channel title as fallback', () => {
      const channel: ChannelSpec = {
        field: 'category',
        type: 'nominal',
        title: 'Channel Title',
        legend: {},
      };
      const scale = mockOrdinalColorScale(['A', 'B'], ['#4e79a7', '#f28e2c']);

      const legend = generateLegend(channel, scale, mockLayout);

      expect(legend.title?.text).toBe('Channel Title');
    });
  });

  describe('legend visibility', () => {
    it('returns empty entries when legend is null', () => {
      const channel: ChannelSpec = {
        field: 'category',
        type: 'nominal',
        legend: null,
      };
      const scale = mockOrdinalColorScale(['A', 'B'], ['#4e79a7', '#f28e2c']);

      const legend = generateLegend(channel, scale, mockLayout);

      expect(legend.entries).toHaveLength(0);
    });

    it('returns empty entries when scale has no domain', () => {
      const channel: ChannelSpec = {
        field: 'category',
        type: 'nominal',
      };
      const scale = mockOrdinalColorScale([], []);

      const legend = generateLegend(channel, scale, mockLayout);

      expect(legend.entries).toHaveLength(0);
    });
  });

  describe('legend entry symbols', () => {
    it('creates symbol marks for entries', () => {
      const channel: ChannelSpec = {
        field: 'category',
        type: 'nominal',
        legend: { symbolType: 'circle' },
      };
      const scale = mockOrdinalColorScale(['A'], ['#4e79a7']);

      const legend = generateLegend(channel, scale, mockLayout);

      expect(legend.entries[0].symbol.type).toBe('symbol');
      expect((legend.entries[0].symbol as any).shape).toBe('circle');
    });

    it('creates rect marks for square symbols', () => {
      const channel: ChannelSpec = {
        field: 'category',
        type: 'nominal',
        legend: { symbolType: 'square' },
      };
      const scale = mockOrdinalColorScale(['A'], ['#4e79a7']);

      const legend = generateLegend(channel, scale, mockLayout);

      expect(legend.entries[0].symbol.type).toBe('rect');
    });
  });
});

describe('calculateLegendPosition', () => {
  const defaultConfig = {
    direction: 'vertical' as const,
    labelFontSize: 11,
    labelColor: '#333333',
    titleFontSize: 12,
    titleColor: '#333333',
    symbolSize: 100,
    symbolType: 'circle' as const,
    padding: 10,
    offset: 10,
  };

  it('positions legend on right', () => {
    const position = calculateLegendPosition('right', mockLayout, 3, defaultConfig);

    expect(position.x).toBeGreaterThan(mockLayout.plotArea.x + mockLayout.plotArea.width);
  });

  it('positions legend on left', () => {
    const position = calculateLegendPosition('left', mockLayout, 3, defaultConfig);

    expect(position.x).toBeLessThan(mockLayout.plotArea.x);
  });

  it('positions legend on top', () => {
    const position = calculateLegendPosition('top', mockLayout, 3, defaultConfig);

    expect(position.y).toBeLessThan(mockLayout.plotArea.y);
  });

  it('positions legend on bottom', () => {
    const position = calculateLegendPosition('bottom', mockLayout, 3, defaultConfig);

    expect(position.y).toBeGreaterThan(mockLayout.plotArea.y + mockLayout.plotArea.height);
  });

  it('positions legend at top-left corner', () => {
    const position = calculateLegendPosition('top-left', mockLayout, 3, defaultConfig);

    expect(position.x).toBeCloseTo(mockLayout.plotArea.x + defaultConfig.offset);
    expect(position.y).toBeCloseTo(mockLayout.plotArea.y + defaultConfig.offset);
  });

  it('positions legend at top-right corner', () => {
    const position = calculateLegendPosition('top-right', mockLayout, 3, defaultConfig);

    expect(position.x).toBeLessThan(mockLayout.plotArea.x + mockLayout.plotArea.width);
    expect(position.y).toBeCloseTo(mockLayout.plotArea.y + defaultConfig.offset);
  });

  it('positions legend at bottom-left corner', () => {
    const position = calculateLegendPosition('bottom-left', mockLayout, 3, defaultConfig);

    expect(position.x).toBeCloseTo(mockLayout.plotArea.x + defaultConfig.offset);
    expect(position.y).toBeLessThan(mockLayout.plotArea.y + mockLayout.plotArea.height);
  });

  it('positions legend at bottom-right corner', () => {
    const position = calculateLegendPosition('bottom-right', mockLayout, 3, defaultConfig);

    expect(position.x).toBeLessThan(mockLayout.plotArea.x + mockLayout.plotArea.width);
    expect(position.y).toBeLessThan(mockLayout.plotArea.y + mockLayout.plotArea.height);
  });

  it('hides legend when orient is none', () => {
    const position = calculateLegendPosition('none', mockLayout, 3, defaultConfig);

    expect(position.x).toBeLessThan(0);
    expect(position.y).toBeLessThan(0);
  });
});

describe('calculateLegendSpace', () => {
  it('calculates space for vertical legend', () => {
    const space = calculateLegendSpace('right', 5, { direction: 'vertical' });

    expect(space.width).toBeGreaterThan(0);
    expect(space.height).toBeGreaterThan(0);
    expect(space.height).toBeGreaterThan(space.width); // Taller than wide
  });

  it('calculates space for horizontal legend', () => {
    const space = calculateLegendSpace('top', 5, { direction: 'horizontal' });

    expect(space.width).toBeGreaterThan(0);
    expect(space.height).toBeGreaterThan(0);
    expect(space.width).toBeGreaterThan(space.height); // Wider than tall
  });

  it('scales with entry count', () => {
    const space3 = calculateLegendSpace('right', 3, { direction: 'vertical' });
    const space5 = calculateLegendSpace('right', 5, { direction: 'vertical' });

    expect(space5.height).toBeGreaterThan(space3.height);
  });

  it('includes title space when title is set', () => {
    const spaceWithoutTitle = calculateLegendSpace('right', 3, {});
    const spaceWithTitle = calculateLegendSpace('right', 3, { title: 'Legend' });

    expect(spaceWithTitle.height).toBeGreaterThan(spaceWithoutTitle.height);
  });
});

describe('flattenLegendMarks', () => {
  it('flattens legend marks into array', () => {
    const legend: LegendMarks = {
      title: {
        type: 'text',
        x: 10,
        y: 10,
        text: 'Title',
        fontSize: 12,
        fontFamily: 'sans-serif',
        textAlign: 'left',
        textBaseline: 'top',
        style: {},
      },
      entries: [
        {
          symbol: { type: 'symbol', x: 10, y: 30, size: 100, shape: 'circle', style: {} },
          label: {
            type: 'text',
            x: 30,
            y: 30,
            text: 'A',
            fontSize: 11,
            fontFamily: 'sans-serif',
            textAlign: 'left',
            textBaseline: 'middle',
            style: {},
          },
          value: 'A',
        },
        {
          symbol: { type: 'symbol', x: 10, y: 50, size: 100, shape: 'circle', style: {} },
          label: {
            type: 'text',
            x: 30,
            y: 50,
            text: 'B',
            fontSize: 11,
            fontFamily: 'sans-serif',
            textAlign: 'left',
            textBaseline: 'middle',
            style: {},
          },
          value: 'B',
        },
      ],
    };

    const marks = flattenLegendMarks(legend);

    // title + 2 * (symbol + label) = 5
    expect(marks).toHaveLength(5);
  });

  it('handles legend without title', () => {
    const legend: LegendMarks = {
      entries: [
        {
          symbol: { type: 'symbol', x: 10, y: 30, size: 100, shape: 'circle', style: {} },
          label: {
            type: 'text',
            x: 30,
            y: 30,
            text: 'A',
            fontSize: 11,
            fontFamily: 'sans-serif',
            textAlign: 'left',
            textBaseline: 'middle',
            style: {},
          },
          value: 'A',
        },
      ],
    };

    const marks = flattenLegendMarks(legend);

    expect(marks).toHaveLength(2); // symbol + label
  });

  it('handles empty legend', () => {
    const legend: LegendMarks = {
      entries: [],
    };

    const marks = flattenLegendMarks(legend);

    expect(marks).toHaveLength(0);
  });

  it('includes background if present', () => {
    const legend: LegendMarks = {
      background: { type: 'rect', x: 0, y: 0, width: 100, height: 100, style: {} },
      entries: [
        {
          symbol: { type: 'symbol', x: 10, y: 30, size: 100, shape: 'circle', style: {} },
          label: {
            type: 'text',
            x: 30,
            y: 30,
            text: 'A',
            fontSize: 11,
            fontFamily: 'sans-serif',
            textAlign: 'left',
            textBaseline: 'middle',
            style: {},
          },
          value: 'A',
        },
      ],
    };

    const marks = flattenLegendMarks(legend);

    expect(marks).toHaveLength(3); // background + symbol + label
    expect(marks[0].type).toBe('rect');
  });
});
