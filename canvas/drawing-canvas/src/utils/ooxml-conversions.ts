/**
 * OOXML <-> TypeScript scale conversion utilities.
 *
 * OOXML uses integer scales (typically 0-100000) for percentages.
 * TS scene uses fractional (0-1) and the contract layer uses 0-100.
 *
 * Field mapping reference:
 * | Rust Type                     | Rust Scale      | TS Contract              | Contract Scale | TS Scene       | Scene Scale |
 * |-------------------------------|-----------------|--------------------------|----------------|----------------|-------------|
 * | SourceRect                    | 0-100000        | PictureCrop              | 0-100          | crop (0-1)     | 0-1         |
 * | BlipEffect::AlphaModFix.amt  | 0-100000 opaque | PictureAdjustments.transparency | 0-100 inverted | opacity   | 0-1         |
 * | BlipEffect::Luminance.bright | -100000..100000 | PictureAdjustments.brightness | -100..100      | —         | —           |
 * | BlipEffect::Luminance.contrast| -100000..100000| PictureAdjustments.contrast   | -100..100      | —         | —           |
 */

// === Source Rectangle / Crop Conversions ===

/**
 * Convert OOXML source rect value (0-100000) to scene crop fraction (0-1).
 * OOXML: 100000 = 100% cropped. Scene: 1.0 = 100% cropped.
 */
export function sourceRectToFraction(ooxmlValue: number): number {
  return ooxmlValue / 100_000;
}

/**
 * Convert scene crop fraction (0-1) to OOXML source rect value (0-100000).
 */
export function fractionToSourceRect(fraction: number): number {
  return Math.round(fraction * 100_000);
}

/**
 * Convert OOXML source rect value (0-100000) to contract crop percentage (0-100).
 */
export function sourceRectToContractCrop(ooxmlValue: number): number {
  return ooxmlValue / 1_000;
}

/**
 * Convert contract crop percentage (0-100) to OOXML source rect value (0-100000).
 */
export function contractCropToSourceRect(cropPercent: number): number {
  return Math.round(cropPercent * 1_000);
}

// === Opacity / Transparency Conversions ===

/**
 * Convert OOXML alpha-mod-fix amount (0-100000, opaque) to scene opacity (0-1, opaque).
 * OOXML: 100000 = fully opaque. Scene: 1.0 = fully opaque.
 */
export function ooxmlOpacityToFraction(amt: number): number {
  return amt / 100_000;
}

/**
 * Convert scene opacity (0-1) to OOXML alpha-mod-fix amount (0-100000).
 */
export function fractionToOoxmlOpacity(opacity: number): number {
  return Math.round(opacity * 100_000);
}

/**
 * Convert contract transparency (0-100, transparent) to scene opacity (0-1, opaque).
 * Transparency is the inverse of opacity: transparency 0 = fully opaque, 100 = fully transparent.
 */
export function transparencyToOpacity(transparency: number): number {
  return 1 - transparency / 100;
}

/**
 * Convert scene opacity (0-1, opaque) to contract transparency (0-100, transparent).
 */
export function opacityToTransparency(opacity: number): number {
  return Math.round((1 - opacity) * 100);
}

// === Brightness / Contrast Conversions ===

/**
 * Convert OOXML brightness value (-100000..100000) to contract percentage (-100..100).
 */
export function ooxmlBrightnessToPercent(bright: number): number {
  return bright / 1_000;
}

/**
 * Convert contract brightness percentage (-100..100) to OOXML value (-100000..100000).
 */
export function percentToOoxmlBrightness(pct: number): number {
  return Math.round(pct * 1_000);
}

/**
 * Convert OOXML contrast value (-100000..100000) to contract percentage (-100..100).
 */
export function ooxmlContrastToPercent(contrast: number): number {
  return contrast / 1_000;
}

/**
 * Convert contract contrast percentage (-100..100) to OOXML value (-100000..100000).
 */
export function percentToOoxmlContrast(pct: number): number {
  return Math.round(pct * 1_000);
}
