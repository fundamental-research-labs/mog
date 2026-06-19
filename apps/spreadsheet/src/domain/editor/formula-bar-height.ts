export const FORMULA_BAR_COLLAPSED_HEIGHT_PX = 28;
export const FORMULA_BAR_DEFAULT_EXPANDED_HEIGHT_PX = 92;
export const FORMULA_BAR_MIN_HEIGHT_PX = FORMULA_BAR_COLLAPSED_HEIGHT_PX;
export const FORMULA_BAR_MAX_HEIGHT_PX = 240;

export function clampFormulaBarHeight(heightPx: number): number {
  if (!Number.isFinite(heightPx)) {
    return FORMULA_BAR_COLLAPSED_HEIGHT_PX;
  }
  return Math.min(
    FORMULA_BAR_MAX_HEIGHT_PX,
    Math.max(FORMULA_BAR_MIN_HEIGHT_PX, Math.round(heightPx)),
  );
}

export function isFormulaBarHeightExpanded(heightPx: number): boolean {
  return clampFormulaBarHeight(heightPx) > FORMULA_BAR_COLLAPSED_HEIGHT_PX;
}
