/**
 * Axis Component Tests
 */

import {
  calculateAxisSpace,
  flattenAxisMarks,
  generateAxis,
  getAxisOrient,
  type AxisMarks,
} from '../../src/components/axis';
import type { ChannelSpec, Layout } from '../../src/grammar/spec';
import type { BandScale, ContinuousScale } from '../../src/primitives/scales/types';

// Mock scales for testing
function mockLinearScale(domain: [number, number], range: [number, number]): ContinuousScale {
  const scale = function (value: number): number {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const t = (value - d0) / (d1 - d0);
    return r0 + t * (r1 - r0);
  };

  scale.domain = function (values?: [number, number]) {
    if (values === undefined) return [...domain] as [number, number];
    domain = [...values] as [number, number];
    return scale;
  };

  scale.range = function (values?: [number, number]) {
    if (values === undefined) return [...range] as [number, number];
    range = [...values] as [number, number];
    return scale;
  };

  scale.ticks = function (count: number = 10): number[] {
    const [d0, d1] = domain;
    const step = (d1 - d0) / count;
    const ticks: number[] = [];
    for (let i = 0; i <= count; i++) {
      ticks.push(d0 + i * step);
    }
    return ticks;
  };

  scale.tickFormat = function () {
    return (n: number) => String(n);
  };

  scale.invert = function (value: number): number {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const t = (value - r0) / (r1 - r0);
    return d0 + t * (d1 - d0);
  };

  scale.nice = function () {
    return scale;
  };
  scale.clamp = function () {
    return false;
  };
  scale.copy = function () {
    return mockLinearScale(domain, range);
  };

  return scale as ContinuousScale;
}

function mockBandScale(domain: string[], range: [number, number]): BandScale {
  const bandwidth = ((range[1] - range[0]) / domain.length) * 0.8;

  const scale = function (value: string): number {
    const index = domain.indexOf(value);
    if (index === -1) return 0;
    const step = (range[1] - range[0]) / domain.length;
    return range[0] + index * step + step * 0.1; // 0.1 padding
  };

  scale.domain = function (values?: string[]) {
    if (values === undefined) return [...domain];
    domain = [...values];
    return scale;
  };

  scale.range = function (values?: [number, number]) {
    if (values === undefined) return [...range] as [number, number];
    range = [...values] as [number, number];
    return scale;
  };

  scale.bandwidth = function () {
    return bandwidth;
  };
  scale.step = function () {
    return (range[1] - range[0]) / domain.length;
  };
  scale.padding = function () {
    return 0.1;
  };
  scale.paddingInner = function () {
    return 0.1;
  };
  scale.paddingOuter = function () {
    return 0.05;
  };
  scale.align = function () {
    return 0.5;
  };
  scale.round = function () {
    return false;
  };
  scale.copy = function () {
    return mockBandScale(domain, range);
  };

  return scale as BandScale;
}

const mockLayout: Layout = {
  width: 800,
  height: 600,
  plotArea: {
    x: 50,
    y: 30,
    width: 700,
    height: 500,
  },
  margin: {
    top: 30,
    right: 50,
    bottom: 70,
    left: 50,
  },
};

describe('generateAxis', () => {
  describe('with continuous scale', () => {
    it('generates axis marks for bottom orientation', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
        axis: { title: 'Value' },
      };
      const scale = mockLinearScale([0, 100], [0, 700]);

      const axis = generateAxis(channel, scale, 'bottom', mockLayout);

      expect(axis.ticks.length).toBeGreaterThan(0);
      expect(axis.labels.length).toBeGreaterThan(0);
      expect(axis.domain).toBeDefined();
      expect(axis.title).toBeDefined();
      expect(axis.title?.text).toBe('Value');
    });

    it('generates axis marks for left orientation', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
        axis: { title: 'Y Axis' },
      };
      const scale = mockLinearScale([0, 100], [0, 500]);

      const axis = generateAxis(channel, scale, 'left', mockLayout);

      expect(axis.ticks.length).toBeGreaterThan(0);
      expect(axis.labels.length).toBeGreaterThan(0);
      expect(axis.domain).toBeDefined();
    });

    it('generates axis marks for top orientation', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
      };
      const scale = mockLinearScale([0, 100], [0, 700]);

      const axis = generateAxis(channel, scale, 'top', mockLayout);

      expect(axis.ticks.length).toBeGreaterThan(0);
      expect(axis.domain).toBeDefined();
    });

    it('generates axis marks for right orientation', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
      };
      const scale = mockLinearScale([0, 100], [0, 500]);

      const axis = generateAxis(channel, scale, 'right', mockLayout);

      expect(axis.ticks.length).toBeGreaterThan(0);
      expect(axis.domain).toBeDefined();
    });
  });

  describe('with band scale', () => {
    it('generates axis marks for categorical data', () => {
      const channel: ChannelSpec = {
        field: 'category',
        type: 'nominal',
      };
      const scale = mockBandScale(['A', 'B', 'C', 'D'], [0, 700]);

      const axis = generateAxis(channel, scale, 'bottom', mockLayout);

      expect(axis.ticks.length).toBe(4);
      expect(axis.labels.length).toBe(4);
      expect(axis.labels[0].text).toBe('A');
      expect(axis.labels[1].text).toBe('B');
      expect(axis.labels[2].text).toBe('C');
      expect(axis.labels[3].text).toBe('D');
    });
  });

  describe('axis configuration', () => {
    it('respects axis: null to hide axis', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
        axis: null,
      };
      const scale = mockLinearScale([0, 100], [0, 700]);

      const axis = generateAxis(channel, scale, 'bottom', mockLayout);

      expect(axis.ticks).toHaveLength(0);
      expect(axis.labels).toHaveLength(0);
      expect(axis.domain).toBeUndefined();
    });

    it('generates grid lines when enabled', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
        axis: { grid: true },
      };
      const scale = mockLinearScale([0, 100], [0, 700]);

      const axis = generateAxis(channel, scale, 'left', mockLayout);

      expect(axis.gridLines).toBeDefined();
      expect(axis.gridLines!.length).toBeGreaterThan(0);
    });

    it('hides ticks when disabled', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
        axis: { ticks: false },
      };
      const scale = mockLinearScale([0, 100], [0, 700]);

      const axis = generateAxis(channel, scale, 'bottom', mockLayout);

      expect(axis.ticks).toHaveLength(0);
    });

    it('hides labels when disabled', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
        axis: { labels: false },
      };
      const scale = mockLinearScale([0, 100], [0, 700]);

      const axis = generateAxis(channel, scale, 'bottom', mockLayout);

      expect(axis.labels).toHaveLength(0);
    });
  });

  describe('title from channel', () => {
    it('uses axis title if provided', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
        title: 'Channel Title',
        axis: { title: 'Axis Title' },
      };
      const scale = mockLinearScale([0, 100], [0, 700]);

      const axis = generateAxis(channel, scale, 'bottom', mockLayout);

      expect(axis.title?.text).toBe('Axis Title');
    });

    it('falls back to channel title', () => {
      const channel: ChannelSpec = {
        field: 'value',
        type: 'quantitative',
        title: 'Channel Title',
        axis: {},
      };
      const scale = mockLinearScale([0, 100], [0, 700]);

      const axis = generateAxis(channel, scale, 'bottom', mockLayout);

      expect(axis.title?.text).toBe('Channel Title');
    });
  });
});

describe('getAxisOrient', () => {
  it('returns bottom for x channel', () => {
    expect(getAxisOrient('x')).toBe('bottom');
  });

  it('returns left for y channel', () => {
    expect(getAxisOrient('y')).toBe('left');
  });

  it('respects explicit orient in spec', () => {
    expect(getAxisOrient('x', { orient: 'top' })).toBe('top');
    expect(getAxisOrient('y', { orient: 'right' })).toBe('right');
  });
});

describe('calculateAxisSpace', () => {
  it('calculates space for default axis', () => {
    const space = calculateAxisSpace('bottom', {});

    expect(space).toBeGreaterThan(0);
    expect(space).toBeLessThan(100);
  });

  it('includes title space when title is set', () => {
    const spaceWithoutTitle = calculateAxisSpace('bottom', {});
    const spaceWithTitle = calculateAxisSpace('bottom', { title: 'My Axis' });

    expect(spaceWithTitle).toBeGreaterThan(spaceWithoutTitle);
  });
});

describe('flattenAxisMarks', () => {
  it('flattens axis marks into array', () => {
    const axis: AxisMarks = {
      domain: {
        type: 'path',
        x: 0,
        y: 0,
        path: 'M0,0',
        style: {},
      },
      ticks: [
        { type: 'path', x: 0, y: 0, path: 'M0,0', style: {} },
        { type: 'path', x: 100, y: 0, path: 'M100,0', style: {} },
      ],
      labels: [
        {
          type: 'text',
          x: 0,
          y: 10,
          text: '0',
          fontSize: 11,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          textBaseline: 'top',
          style: {},
        },
        {
          type: 'text',
          x: 100,
          y: 10,
          text: '100',
          fontSize: 11,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          textBaseline: 'top',
          style: {},
        },
      ],
      title: {
        type: 'text',
        x: 50,
        y: 30,
        text: 'Title',
        fontSize: 12,
        fontFamily: 'sans-serif',
        textAlign: 'center',
        textBaseline: 'top',
        style: {},
      },
      gridLines: [{ type: 'path', x: 0, y: 0, path: 'M0,0', style: {} }],
    };

    const marks = flattenAxisMarks(axis);

    // domain + 1 grid + 2 ticks + 2 labels + title = 7
    expect(marks).toHaveLength(7);
  });

  it('handles empty axis', () => {
    const axis: AxisMarks = {
      ticks: [],
      labels: [],
    };

    const marks = flattenAxisMarks(axis);

    expect(marks).toHaveLength(0);
  });
});
