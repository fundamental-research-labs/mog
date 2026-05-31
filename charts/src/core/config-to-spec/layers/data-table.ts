import type { DataRow, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData, ChartDataPoint } from '../../../types';
import { DEFAULT_CATEGORY_COLORS } from '../../../utils/colors';
import {
  CLIP_TO_PLOT_AREA_FIELD,
  DATA_TABLE_FILL_FIELD,
  DATA_TABLE_STROKE_FIELD,
  DATA_TABLE_STROKE_WIDTH_FIELD,
  DATA_TABLE_TEXT_FIELD,
  DATA_TABLE_X2_FIELD,
  DATA_TABLE_X_FIELD,
  DATA_TABLE_Y2_FIELD,
  DATA_TABLE_Y_FIELD,
} from '../fields';

const BORDER_COLOR = '#b8bec7';
const BORDER_WIDTH = 1;
const KEY_SIZE = 0.38;

export function buildDataTableLayers(config: ChartConfig, data: ChartData): UnitSpec[] {
  if (!isDataTableVisible(config)) return [];
  const table = buildDataTableRows(config, data);
  if (!table) return [];

  const layers: UnitSpec[] = [
    {
      mark: {
        type: 'text',
        xField: DATA_TABLE_X_FIELD,
        yField: DATA_TABLE_Y_FIELD,
        coordinateSystem: 'dataTableFraction',
        align: 'center',
        textBaseline: 'middle',
        fontSize: 10,
      },
      data: { values: table.textRows },
      encoding: { text: { field: DATA_TABLE_TEXT_FIELD, type: 'nominal' } },
    },
  ];

  if (table.keyRows.length > 0) {
    layers.push({
      mark: {
        type: 'rect',
        xField: DATA_TABLE_X_FIELD,
        yField: DATA_TABLE_Y_FIELD,
        x2Field: DATA_TABLE_X2_FIELD,
        y2Field: DATA_TABLE_Y2_FIELD,
        coordinateSystem: 'dataTableFraction',
        fillField: DATA_TABLE_FILL_FIELD,
        stroke: BORDER_COLOR,
        strokeWidth: 0.5,
      },
      data: { values: table.keyRows },
    });
  }

  if (table.ruleRows.length > 0) {
    layers.push({
      mark: {
        type: 'rule',
        xField: DATA_TABLE_X_FIELD,
        yField: DATA_TABLE_Y_FIELD,
        x2Field: DATA_TABLE_X2_FIELD,
        y2Field: DATA_TABLE_Y2_FIELD,
        coordinateSystem: 'dataTableFraction',
        strokeField: DATA_TABLE_STROKE_FIELD,
        strokeWidthField: DATA_TABLE_STROKE_WIDTH_FIELD,
      },
      data: { values: table.ruleRows },
    });
  }

  return layers;
}

export function isDataTableVisible(config: ChartConfig): boolean {
  return Boolean(config.dataTable && config.dataTable.visible !== false);
}

export function dataTableRowCount(config: ChartConfig, data: ChartData | undefined): number {
  if (!data || !isDataTableVisible(config) || data.series.length === 0) return 0;
  return data.series.length + 1;
}

function buildDataTableRows(
  config: ChartConfig,
  data: ChartData,
): { textRows: DataRow[]; keyRows: DataRow[]; ruleRows: DataRow[] } | undefined {
  if (data.series.length === 0 || data.categories.length === 0) return undefined;

  const columnCount = data.categories.length + 1;
  const rowCount = data.series.length + 1;
  const textRows: DataRow[] = [];
  const keyRows: DataRow[] = [];
  const ruleRows: DataRow[] = [];

  for (let categoryIndex = 0; categoryIndex < data.categories.length; categoryIndex += 1) {
    textRows.push(textRow(categoryIndex + 1, 0, columnCount, rowCount, data.categories[categoryIndex]));
  }

  for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
    const series = data.series[seriesIndex];
    textRows.push(textRow(0, seriesIndex + 1, columnCount, rowCount, series.name));

    if (config.dataTable?.showKeys || config.dataTable?.showLegendKey) {
      const color = series.color ?? config.series?.[seriesIndex]?.color ?? DEFAULT_CATEGORY_COLORS[seriesIndex % DEFAULT_CATEGORY_COLORS.length];
      keyRows.push(keyRow(seriesIndex + 1, rowCount, color));
    }

    for (let categoryIndex = 0; categoryIndex < data.categories.length; categoryIndex += 1) {
      textRows.push(
        textRow(
          categoryIndex + 1,
          seriesIndex + 1,
          columnCount,
          rowCount,
          valueText(series.data[categoryIndex]),
        ),
      );
    }
  }

  addBorderRows(config, ruleRows, columnCount, rowCount);
  return { textRows, keyRows, ruleRows };
}

function textRow(
  column: number,
  row: number,
  columnCount: number,
  rowCount: number,
  value: unknown,
): DataRow {
  return {
    [DATA_TABLE_X_FIELD]: (column + 0.5) / columnCount,
    [DATA_TABLE_Y_FIELD]: (row + 0.5) / rowCount,
    [DATA_TABLE_TEXT_FIELD]: value == null ? '' : String(value),
    [CLIP_TO_PLOT_AREA_FIELD]: false,
  };
}

function keyRow(row: number, rowCount: number, color: string): DataRow {
  const yCenter = (row + 0.5) / rowCount;
  const halfHeight = KEY_SIZE / rowCount / 2;
  return {
    [DATA_TABLE_X_FIELD]: 0.025,
    [DATA_TABLE_Y_FIELD]: yCenter - halfHeight,
    [DATA_TABLE_X2_FIELD]: 0.055,
    [DATA_TABLE_Y2_FIELD]: yCenter + halfHeight,
    [DATA_TABLE_FILL_FIELD]: color,
    [CLIP_TO_PLOT_AREA_FIELD]: false,
  };
}

function addBorderRows(
  config: ChartConfig,
  rows: DataRow[],
  columnCount: number,
  rowCount: number,
): void {
  const showHorizontal = config.dataTable?.showHorzBorder === true;
  const showVertical = config.dataTable?.showVertBorder === true;
  const showOutline = config.dataTable?.showOutline === true;

  if (showHorizontal) {
    for (let row = 1; row < rowCount; row += 1) {
      rows.push(ruleRow(0, row / rowCount, 1, row / rowCount));
    }
  }
  if (showVertical) {
    for (let column = 1; column < columnCount; column += 1) {
      rows.push(ruleRow(column / columnCount, 0, column / columnCount, 1));
    }
  }
  if (showOutline) {
    rows.push(
      ruleRow(0, 0, 1, 0),
      ruleRow(1, 0, 1, 1),
      ruleRow(1, 1, 0, 1),
      ruleRow(0, 1, 0, 0),
    );
  }
}

function ruleRow(x: number, y: number, x2: number, y2: number): DataRow {
  return {
    [DATA_TABLE_X_FIELD]: x,
    [DATA_TABLE_Y_FIELD]: y,
    [DATA_TABLE_X2_FIELD]: x2,
    [DATA_TABLE_Y2_FIELD]: y2,
    [DATA_TABLE_STROKE_FIELD]: BORDER_COLOR,
    [DATA_TABLE_STROKE_WIDTH_FIELD]: BORDER_WIDTH,
    [CLIP_TO_PLOT_AREA_FIELD]: false,
  };
}

function valueText(point: ChartDataPoint | undefined): string {
  if (!point || (point.valueState && point.valueState !== 'value')) return '';
  return Number.isInteger(point.y) ? String(point.y) : String(Number(point.y.toPrecision(12)));
}
