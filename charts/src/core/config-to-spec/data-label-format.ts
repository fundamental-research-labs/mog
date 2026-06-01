import type { DataLabelConfig } from '../../types';
import {
  formatExcelValueResult,
  type ExcelNumberFormatResult,
} from '@mog/spreadsheet-utils/number-formats';

export interface DataLabelTextContext {
  seriesName: string;
  category: string | number;
  value: number;
  bubbleSize?: number;
  percentage?: number;
}

export function mergeLabels(
  chartLabel?: DataLabelConfig,
  seriesLabel?: DataLabelConfig,
  pointLabel?: DataLabelConfig,
): DataLabelConfig | undefined {
  const merged = [chartLabel, seriesLabel, pointLabel]
    .filter(Boolean)
    .reduce(
      (acc, label) => ({ ...acc, ...definedEntries(label!) }),
      {} as Partial<DataLabelConfig>,
    );
  return Object.keys(merged).length > 0
    ? ({ show: false, ...merged } as DataLabelConfig)
    : undefined;
}

export function composeLabelText(
  label: DataLabelConfig,
  context: DataLabelTextContext,
): { text: string; color?: string } {
  if (label.text) return { text: label.text };
  if (label.formula) return { text: label.formula };
  if (label.richText?.length) return { text: label.richText.map((run) => run.text).join('') };

  const showValue = label.showValue ?? defaultLabelShowsValue(label);
  const parts: string[] = [];
  let color: string | undefined;
  const pushNumber = (result: ExcelNumberFormatResult) => {
    parts.push(result.text);
    color ??= result.color;
  };
  if (label.showSeriesName) parts.push(context.seriesName);
  if (label.showCategoryName ?? label.showCategory) parts.push(String(context.category));
  if (showValue) pushNumber(formatLabelNumber(context.value, label.numberFormat ?? label.format));
  if (label.showPercentage ?? label.showPercent) {
    pushNumber(
      formatLabelNumber(context.percentage ?? 0, label.numberFormat ?? label.format ?? '0%'),
    );
  }
  if (label.showBubbleSize && context.bubbleSize !== undefined) {
    pushNumber(formatLabelNumber(context.bubbleSize, label.numberFormat ?? label.format));
  }
  return {
    text: parts.join(label.separator ?? ', '),
    ...(color !== undefined ? { color } : {}),
  };
}

function definedEntries<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function defaultLabelShowsValue(label: DataLabelConfig): boolean {
  return !(
    label.showSeriesName ||
    label.showCategoryName ||
    label.showCategory ||
    label.showPercentage ||
    label.showPercent ||
    label.showBubbleSize
  );
}

function formatLabelNumber(value: number, format?: string): ExcelNumberFormatResult {
  if (format) return formatExcelValueResult(value, format);
  return {
    text: Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12))),
    section: value < 0 ? 'negative' : value === 0 ? 'zero' : 'positive',
  };
}
