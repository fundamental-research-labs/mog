import type { ChartType } from '@mog/charts';

import { CHART_CATEGORIES, type ChartCategory } from './chart-variants';

const categoryById = new Map<ChartType, ChartCategory>(
  CHART_CATEGORIES.map((category) => [category.id, category]),
);

function category(id: ChartType): ChartCategory {
  const match = categoryById.get(id);
  if (!match) {
    throw new Error(`Missing chart category for ribbon chart type: ${id}`);
  }
  return match;
}

const RIBBON_CHART_CATEGORY_IDS = [
  'column',
  'line',
  'pie',
  'bar',
  'area',
  'scatter',
  'combo',
  'radar',
  'stock',
  'funnel',
  'waterfall',
] as const satisfies readonly ChartType[];

/**
 * The Insert ribbon intentionally exposes only chart categories with dedicated
 * toolbar icons. More specialized internal chart types remain supported by the
 * chart catalog definitions, but are not shown as ribbon categories until they
 * have first-class ribbon affordances.
 */
export const CHART_DROPDOWN_CATEGORIES: readonly ChartCategory[] =
  RIBBON_CHART_CATEGORY_IDS.map(category);

const CATEGORY_BUTTON_ROW_IDS = [
  ['column', 'line', 'pie', 'bar', 'area', 'scatter'],
  ['combo', 'radar', 'stock', 'funnel', 'waterfall'],
] as const satisfies readonly (readonly ChartType[])[];

/**
 * Stable two-row category icon layout shown beside the Charts dropdown.
 * This intentionally does not use "first N, rest" slicing, so catalog changes
 * must update the visible ribbon contract deliberately.
 */
export const CHART_CATEGORY_BUTTON_ROWS: readonly (readonly ChartCategory[])[] =
  CATEGORY_BUTTON_ROW_IDS.map((row) => row.map(category));
