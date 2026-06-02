import { compile } from '../../grammar/compiler';
import type { CompileResult } from '../../grammar/types';
import type { PathMark } from '../../primitives/types';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import {
  STOCK_CLOSE_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
} from '../config-to-spec/fields';

type PathEndpoints = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

function stockConfig(subType: NonNullable<ChartConfig['subType']>): ChartConfig {
  return {
    type: 'stock',
    subType,
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 5,
  };
}

function stockData(): ChartData {
  return {
    categories: ['D1', 'D2'],
    series: [
      {
        name: 'Price',
        data: [
          {
            x: 'D1',
            y: 20,
            [STOCK_OPEN_FIELD]: 14,
            [STOCK_HIGH_FIELD]: 30,
            [STOCK_LOW_FIELD]: 10,
            [STOCK_CLOSE_FIELD]: 20,
          },
          {
            x: 'D2',
            y: 40,
            [STOCK_OPEN_FIELD]: 35,
            [STOCK_HIGH_FIELD]: 50,
            [STOCK_LOW_FIELD]: 0,
            [STOCK_CLOSE_FIELD]: 40,
          },
        ],
      },
    ],
  };
}

function compileStock(config: ChartConfig, data: ChartData): CompileResult {
  return compile(configToSpec(config, data), undefined, {
    skipAxes: true,
    skipLegend: true,
    skipTitle: true,
  });
}

function pathMarks(result: CompileResult): PathMark[] {
  return result.marks.filter((mark): mark is PathMark => mark.type === 'path');
}

function endpoints(mark: PathMark): PathEndpoints {
  const match = /^M([^,]+),([^ ]+) L([^,]+),(.+)$/.exec(mark.path);
  expect(match).not.toBeNull();
  return {
    x1: Number(match![1]),
    y1: Number(match![2]),
    x2: Number(match![3]),
    y2: Number(match![4]),
  };
}

function isVertical(mark: PathMark): boolean {
  const path = endpoints(mark);
  return path.x1 === path.x2 && path.y1 !== path.y2;
}

function isHorizontal(mark: PathMark): boolean {
  const path = endpoints(mark);
  return path.x1 !== path.x2 && path.y1 === path.y2;
}

describe('configToSpec stock render layers', () => {
  it('renders HLC high-low wicks as bounded y2 rules plus close ticks', () => {
    const result = compileStock(stockConfig('hlc'), stockData());
    const marks = pathMarks(result);
    const wick = marks.find(
      (mark) =>
        isVertical(mark) &&
        mark.datum?.[STOCK_LOW_FIELD] === 10 &&
        mark.datum?.[STOCK_HIGH_FIELD] === 30,
    );
    const closeTick = marks.find(
      (mark) => isHorizontal(mark) && mark.datum?.[STOCK_CLOSE_FIELD] === 20,
    );

    expect(wick).toBeDefined();
    expect(closeTick).toBeDefined();

    const wickPath = endpoints(wick!);
    const wickHeight = Math.abs(wickPath.y2 - wickPath.y1);
    expect(wickHeight).toBeGreaterThan(0);
    expect(wickHeight).toBeLessThan(result.layout.plotArea.height);
    expect(wick!.datum).toEqual(
      expect.objectContaining({
        [STOCK_LOW_FIELD]: 10,
        [STOCK_HIGH_FIELD]: 30,
        [STOCK_CLOSE_FIELD]: 20,
      }),
    );
  });

  it('renders OHLC open and close ticks instead of full-height bodies', () => {
    const result = compileStock(stockConfig('ohlc'), stockData());
    const marks = pathMarks(result);
    const openTick = marks.find(
      (mark) =>
        isHorizontal(mark) &&
        mark.datum?.[STOCK_OPEN_FIELD] === 14 &&
        !isCloseTick(mark, result) &&
        mark.datum?.[STOCK_CLOSE_FIELD] === 20,
    );
    const closeTick = marks.find(
      (mark) =>
        isHorizontal(mark) &&
        mark.datum?.[STOCK_OPEN_FIELD] === 14 &&
        isCloseTick(mark, result) &&
        mark.datum?.[STOCK_CLOSE_FIELD] === 20,
    );

    expect(openTick).toBeDefined();
    expect(closeTick).toBeDefined();
    expect(openTick!.datum).toEqual(
      expect.objectContaining({
        [STOCK_OPEN_FIELD]: 14,
        [STOCK_CLOSE_FIELD]: 20,
      }),
    );
    expect(closeTick!.datum).toEqual(openTick!.datum);
  });
});

function isCloseTick(mark: PathMark, result: CompileResult): boolean {
  const path = endpoints(mark);
  return (
    result.stockGlyphTrace?.points.some(
      (point) =>
        point.closeTick !== undefined &&
        path.x1 === point.closeTick.x1 &&
        path.y1 === point.closeTick.y1 &&
        path.x2 === point.closeTick.x2 &&
        path.y2 === point.closeTick.y2,
    ) ?? false
  );
}
