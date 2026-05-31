import type { ChartConfig, ChartData } from '../../../types';
import { configToSpec } from '../../../core/config-to-spec';
import type { ChartSpec } from '../../../grammar/spec';
import { toOOXML } from '../../index';

function inlineRows(spec: ChartSpec) {
  return spec.data && 'values' in spec.data ? spec.data.values : [];
}

describe('bar OOXML export', () => {
  it('exports clamped Excel bar geometry from ChartSpec config', () => {
    const data: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Revenue',
          data: [
            { x: 'A', y: 10 },
            { x: 'B', y: 20 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'column',
      subType: 'stacked',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      gapWidth: 999,
      overlap: -999,
    };

    const spec = configToSpec(config, data);
    const { chartXml } = toOOXML(spec, inlineRows(spec));

    expect(spec.config?.barGeometry).toMatchObject({
      grouping: 'stacked',
      sourceGapWidth: 999,
      sourceOverlap: -999,
      gapWidth: 500,
      overlap: -100,
      gapWidthClamped: true,
      overlapClamped: true,
    });
    expect(chartXml).toContain('<c:grouping val="stacked"/>');
    expect(chartXml).toContain('<c:gapWidth val="500"/>');
    expect(chartXml).toContain('<c:overlap val="-100"/>');
  });
});
