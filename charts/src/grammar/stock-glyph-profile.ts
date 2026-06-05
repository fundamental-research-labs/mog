export interface NativeStockGlyphProfile {
  effectiveGapWidth: number;
  slotOccupancy: number;
  minSlotOccupancy: number;
  maxSlotOccupancy: number;
  minGlyphWidth: number;
  denseMinGlyphWidth: number;
  maxGlyphWidth: number;
  denseCategoryPitchThreshold: number;
  tickLengthRatio: number;
  minTickLength: number;
  denseMinTickLength: number;
  maxTickLength: number;
  stemStrokeWidth: number;
  tickStrokeWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
}

export const NATIVE_STOCK_GLYPH_PROFILE: NativeStockGlyphProfile = {
  effectiveGapWidth: 70,
  slotOccupancy: 0.58,
  minSlotOccupancy: 0.58,
  maxSlotOccupancy: 0.82,
  minGlyphWidth: 2.75,
  denseMinGlyphWidth: 2.6,
  maxGlyphWidth: 20,
  denseCategoryPitchThreshold: 4,
  tickLengthRatio: 0.62,
  minTickLength: 2.25,
  denseMinTickLength: 2.1,
  maxTickLength: 10,
  stemStrokeWidth: 1.35,
  tickStrokeWidth: 1.45,
  lineCap: 'square',
  lineJoin: 'miter',
};

export function nativeStockSlotOccupancyForGapWidth(gapWidth: number): number {
  return clamp(
    Math.max(100 / (100 + gapWidth), NATIVE_STOCK_GLYPH_PROFILE.minSlotOccupancy),
    NATIVE_STOCK_GLYPH_PROFILE.minSlotOccupancy,
    NATIVE_STOCK_GLYPH_PROFILE.maxSlotOccupancy,
  );
}

export function nativeStockGlyphWidth(
  categoryPitch: number,
  slotOccupancy = NATIVE_STOCK_GLYPH_PROFILE.slotOccupancy,
): number {
  const dense = categoryPitch < NATIVE_STOCK_GLYPH_PROFILE.denseCategoryPitchThreshold;
  const minWidth = dense
    ? NATIVE_STOCK_GLYPH_PROFILE.denseMinGlyphWidth
    : NATIVE_STOCK_GLYPH_PROFILE.minGlyphWidth;
  return clamp(categoryPitch * slotOccupancy, minWidth, NATIVE_STOCK_GLYPH_PROFILE.maxGlyphWidth);
}

export function nativeStockTickLength(categoryPitch: number, glyphWidth: number): number {
  const dense = categoryPitch < NATIVE_STOCK_GLYPH_PROFILE.denseCategoryPitchThreshold;
  const minLength = dense
    ? NATIVE_STOCK_GLYPH_PROFILE.denseMinTickLength
    : NATIVE_STOCK_GLYPH_PROFILE.minTickLength;
  return clamp(
    glyphWidth * NATIVE_STOCK_GLYPH_PROFILE.tickLengthRatio,
    minLength,
    NATIVE_STOCK_GLYPH_PROFILE.maxTickLength,
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
