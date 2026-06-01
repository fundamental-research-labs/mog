import { compile } from '../../grammar/compiler';
import type { CompileResult } from '../../grammar/types';
import type { PathMark } from '../../primitives/types';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import { CANDLESTICK_BAR_WIDTH } from '../config-to-spec/constants';
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

  it('renders OHLC open-close bodies with candlestick width instead of full-height rules', () => {
    const result = compileStock(stockConfig('ohlc'), stockData());
    const marks = pathMarks(result);
    const body = marks.find(
      (mark) =>
        mark.style.strokeWidth === CANDLESTICK_BAR_WIDTH &&
        mark.datum?.[STOCK_OPEN_FIELD] === 14 &&
        mark.datum?.[STOCK_CLOSE_FIELD] === 20,
    );

    expect(body).toBeDefined();
    expect(isVertical(body!)).toBe(true);
    const bodyPath = endpoints(body!);
    expect(Math.abs(bodyPath.y2 - bodyPath.y1)).toBeGreaterThan(0);
    expect(Math.abs(bodyPath.y2 - bodyPath.y1)).toBeLessThan(result.layout.plotArea.height);
    expect(body!.datum).toEqual(
      expect.objectContaining({
        [STOCK_OPEN_FIELD]: 14,
        [STOCK_CLOSE_FIELD]: 20,
      }),
    );
  });
});
