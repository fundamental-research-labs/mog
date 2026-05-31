import type { PathMark } from '../../primitives/types';
import { compile } from '../../grammar/compiler';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import { POINT_INDEX_FIELD } from '../config-to-spec/fields';

function blankMiddleData(): ChartData {
  return {
    categories: ['A', 'B', 'C'],
    series: [
      {
        name: 'Series 1',
        data: [
          { x: 'A', y: 1 },
          { x: 'B', y: 0, valueState: 'blank' },
          { x: 'C', y: 2 },
        ],
      },
    ],
  };
}

function config(type: 'line' | 'area', displayBlanksAs: 'gap' | 'span'): ChartConfig {
  return {
    type,
    displayBlanksAs,
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 5,
  };
}

function dataPaths(type: 'line' | 'area', displayBlanksAs: 'gap' | 'span'): PathMark[] {
  const spec = configToSpec(config(type, displayBlanksAs), blankMiddleData());
  return compile(spec).marks.filter((mark): mark is PathMark => mark.type === 'path');
}

function plottedPointIndices(mark: PathMark): number[] {
  const datum = mark.datum as Array<Record<string, unknown>> | undefined;
  return Array.isArray(datum)
    ? datum.map((row) =>
        typeof row[POINT_INDEX_FIELD] === 'number' ? row[POINT_INDEX_FIELD] : -1,
      )
    : [];
}

describe('displayBlanksAs line and area path semantics', () => {
  it('breaks line paths at gap blanks and connects across span blanks', () => {
    const gapPaths = dataPaths('line', 'gap');
    const spanPaths = dataPaths('line', 'span');

    expect(gapPaths.map(plottedPointIndices)).toEqual([[0], [2]]);
    expect(spanPaths.map(plottedPointIndices)).toEqual([[0, 2]]);
  });

  it('breaks area paths at gap blanks and connects across span blanks', () => {
    const gapPaths = dataPaths('area', 'gap');
    const spanPaths = dataPaths('area', 'span');

    expect(gapPaths.map(plottedPointIndices)).toEqual([[0], [2]]);
    expect(spanPaths.map(plottedPointIndices)).toEqual([[0, 2]]);
  });
});
