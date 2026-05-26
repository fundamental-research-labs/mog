/**
 * Cell Styles Module
 *
 * Exports built-in styles, themes, and fonts.
 */

export {
  ALL_FONTS,
  FONT_CATEGORIES,
  FONT_CATEGORY_LABELS,
  MAX_RECENT_FONTS,
  MONOSPACE_FONTS,
  RECENT_FONTS_KEY,
  SYSTEM_FONTS,
  addRecentFont,
  clearRecentFonts,
  getRecentFonts,
  isFontAvailable,
  isMonospaceFont,
} from './fonts';

// Theme exports (Issue 4: Page Layout - Themes)
export {
  ARIAL_FONT_THEME,
  // Font themes
  BUILT_IN_FONT_THEMES,
  BUILT_IN_THEMES,
  CENTURY_GOTHIC_FONT_THEME,
  FACET_THEME,
  GALLERY_THEME,
  GEORGIA_FONT_THEME,
  INTEGRAL_THEME,
  ION_THEME,
  OFFICE_2007_FONT_THEME,
  OFFICE_2007_THEME,
  OFFICE_FONT_THEME,
  OFFICE_THEME,
  SLICE_THEME,
  TIMES_FONT_THEME,
  TREBUCHET_FONT_THEME,
  VAPOR_TRAIL_THEME,
  VERDANA_FONT_THEME,
  getBuiltInFontTheme,
  getBuiltInTheme,
  getBuiltInThemeIds,
  getEffectiveFonts,
  getTheme,
  isBuiltInTheme,
} from './built-in-themes';

// Recent colors (fill, font, border)
export {
  addRecentColor,
  clearAllRecentColors,
  clearRecentColors,
  getRecentColors,
  type ColorType,
} from './recent-colors';

export {
  AUTO_SCROLL_CURSOR,
  DRAW_BORDER_CURSOR,
  ERASE_BORDER_CURSOR,
  FORMAT_PAINTER_CURSOR,
  GRABBING_CURSOR,
  GRAB_CURSOR,
  INK_ERASER_CURSOR,
  INK_HIGHLIGHTER_CURSOR,
  INK_PEN_CURSOR,
  getInkCursor,
} from './cursors';

export {
  GRADIENT_CATEGORY_LABELS,
  GRADIENT_CATEGORY_ORDER,
  PRESET_GRADIENTS,
  getPresetGradientById,
  getPresetGradientsByCategory,
  gradientFillToCSS,
  type PresetGradient,
} from './preset-gradients';
