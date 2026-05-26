import { CHART_CATEGORIES } from '../chart-variants';
import { CHART_CATEGORY_BUTTON_ROWS, CHART_DROPDOWN_CATEGORIES } from '../chart-ribbon-layout';

function categoryIds(categories: readonly { id: string }[]): string[] {
  return categories.map((category) => category.id);
}

describe('chart ribbon layout', () => {
  const ribbonCategoryIds = [
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
  ];

  it('routes only dedicated-icon chart categories through the ribbon dropdown', () => {
    expect(categoryIds(CHART_DROPDOWN_CATEGORIES)).toEqual(ribbonCategoryIds);
    expect(new Set(categoryIds(CHART_DROPDOWN_CATEGORIES)).size).toBe(
      CHART_DROPDOWN_CATEGORIES.length,
    );
  });

  it('keeps every ribbon-supported chart variant reachable from the dropdown catalog', () => {
    const dropdownVariantIds = CHART_DROPDOWN_CATEGORIES.flatMap((category) =>
      category.variants.map((variant) => variant.id),
    );
    const ribbonVariantIds = CHART_CATEGORIES.filter((category) =>
      ribbonCategoryIds.includes(category.id),
    ).flatMap((category) => category.variants.map((variant) => variant.id));

    expect(dropdownVariantIds).toEqual(ribbonVariantIds);
    expect(new Set(dropdownVariantIds).size).toBe(ribbonVariantIds.length);
  });

  it('keeps every dedicated-icon chart category visible in two stable icon rows', () => {
    expect(CHART_CATEGORY_BUTTON_ROWS.map(categoryIds)).toEqual([
      ['column', 'line', 'pie', 'bar', 'area', 'scatter'],
      ['combo', 'radar', 'stock', 'funnel', 'waterfall'],
    ]);

    const categoryButtonIds = CHART_CATEGORY_BUTTON_ROWS.flatMap(categoryIds);
    expect(categoryButtonIds.sort()).toEqual([...ribbonCategoryIds].sort());
    expect(new Set(categoryButtonIds).size).toBe(ribbonCategoryIds.length);
  });
});
