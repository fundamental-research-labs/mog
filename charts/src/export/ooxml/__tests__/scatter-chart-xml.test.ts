import type { ChartConfig, ChartData } from '../../../types';
import { configToSpec } from '../../../core/config-to-spec';
import type { ChartSpec } from '../../../grammar/spec';
import { toOOXML } from '../../index';

function inlineRows(spec: ChartSpec) {
  return spec.data && 'values' in spec.data ? spec.data.values : [];
}

describe('scatter and bubble OOXML export', () => {
  it('exports bubble scalar settings from ChartSpec config', () => {
    const data: ChartData = {
      categories: [1],
      series: [{ name: 'Bubbles', data: [{ x: 1, y: 10, size: 20 }] }],
    };
    const config: ChartConfig = {
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      bubbleScale: 250,
      showNegBubbles: true,
      sizeRepresents: 'w',
      bubble3DEffect: true,
    };

    const spec = configToSpec(config, data);
    const { chartXml } = toOOXML(spec, inlineRows(spec), { sheetName: 'Bubble Data' });

    expect(spec.config).toMatchObject({
      bubbleScale: 250,
      showNegBubbles: true,
      sizeRepresents: 'w',
      bubble3DEffect: true,
    });
    expect(chartXml).toContain('<c:bubbleScale val="250"/>');
    expect(chartXml).toContain('<c:showNegBubbles val="1"/>');
    expect(chartXml).toContain('<c:sizeRepresents val="w"/>');
    expect(chartXml).toContain('<c:bubble3D val="1"/>');
  });

  it('clamps exported bubbleScale to OOXML bounds', () => {
    const data: ChartData = {
      categories: [1],
      series: [{ name: 'Bubbles', data: [{ x: 1, y: 10, size: 20 }] }],
    };
    const config: ChartConfig = {
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      bubbleScale: 999,
    };

    const spec = configToSpec(config, data);
    const { chartXml } = toOOXML(spec, inlineRows(spec));

    expect(chartXml).toContain('<c:bubbleScale val="300"/>');
    expect(chartXml).toContain('<c:showNegBubbles val="0"/>');
    expect(chartXml).toContain('<c:bubble3D val="0"/>');
  });
});
