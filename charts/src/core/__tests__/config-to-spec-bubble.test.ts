import type { UnitSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';
import { BUBBLE_SIZE_FIELD, SCATTER_X_FIELD, VALUE_FIELD } from '../config-to-spec/fields';

function asUnitSpec(config: ChartConfig, data: ChartData): UnitSpec {
  return configToSpec(config, data) as UnitSpec;
}

function specRows(spec: UnitSpec) {
  return spec.data && 'values' in spec.data ? spec.data.values : [];
}

describe('configToSpec bubble size semantics', () => {
  it('uses only renderable bubbles when normalizing width-based size values', () => {
    const data: ChartData = {
      categories: [1, 'not-x'],
      series: [
        {
          name: 'Bubbles',
          data: [
            { x: 1, y: 10, size: 10 },
            { x: 'not-x', y: 20, size: 100 },
          ],
        },
      ],
    };
    const config: ChartConfig = {
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      sizeRepresents: 'w',
    };

    const spec = asUnitSpec(config, data);
    const rows = specRows(spec);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        [SCATTER_X_FIELD]: 1,
        [VALUE_FIELD]: 10,
        [BUBBLE_SIZE_FIELD]: 10,
      }),
    );
  });

  it('omits non-positive bubbles by default and uses absolute size when negatives are shown', () => {
    const data: ChartData = {
      categories: [1, 2, 3],
      series: [
        {
          name: 'Bubbles',
          data: [
            { x: 1, y: 10, size: -5 },
            { x: 2, y: 20, size: 0 },
            { x: 3, y: 30, size: 15 },
          ],
        },
      ],
    };
    const baseConfig: ChartConfig = {
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
    };

    const defaultRows = specRows(asUnitSpec(baseConfig, data));
    const negativeRows = specRows(
      asUnitSpec({ ...baseConfig, showNegBubbles: true }, data),
    );

    expect(defaultRows.map((row) => row[SCATTER_X_FIELD])).toEqual([3]);
    expect(negativeRows.map((row) => row[BUBBLE_SIZE_FIELD])).toEqual([5, 0, 15]);
  });

  it('clamps bubbleScale to the OOXML 0-300 size range', () => {
    const data: ChartData = {
      categories: [1],
      series: [{ name: 'Bubbles', data: [{ x: 1, y: 10, size: 10 }] }],
    };

    const oversized = asUnitSpec(
      {
        type: 'bubble',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 5,
        bubbleScale: 500,
      },
      data,
    );
    const undersized = asUnitSpec(
      {
        type: 'bubble',
        anchorRow: 0,
        anchorCol: 0,
        width: 8,
        height: 5,
        bubbleScale: -50,
      },
      data,
    );

    expect(oversized.encoding?.size?.scale?.range).toEqual([0, 1200]);
    expect(undersized.encoding?.size?.scale?.range).toEqual([0, 0]);
  });
});
