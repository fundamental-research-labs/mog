/**
 * More Colors Dialog Slice
 *
 * Manages state for the More Colors dialog that allows users
 * to select custom colors via RGB, HSL, or hex input.
 *
 * Excel parity 14.5: More Colors Dialog
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Constants
// =============================================================================

const MAX_RECENT_COLORS = 10;
const RECENT_COLORS_STORAGE_KEY = 'spreadsheet-recent-colors';

// =============================================================================
// Types
// =============================================================================

/**
 * The type of color being selected (determines where the color will be applied).
 */
export type ColorTargetType = 'fill' | 'font' | 'border';

/**
 * RGB color values (0-255 for each channel).
 */
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/**
 * HSL color values.
 * - h: Hue (0-360)
 * - s: Saturation (0-100)
 * - l: Lightness (0-100)
 */
export interface HSLColor {
  h: number;
  s: number;
  l: number;
}

/**
 * More Colors dialog state
 */
export interface MoreColorsDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** The type of color being selected (fill, font, or border) */
  colorTarget: ColorTargetType;
  /** Active tab in the dialog */
  activeTab: 'standard' | 'custom';
  /** Current color value (the color we're editing from) */
  currentColor: string | null;
  /** Selected RGB values */
  rgb: RGBColor;
  /** Selected HSL values */
  hsl: HSLColor;
  /** Hex input value */
  hexInput: string;
  /** Error message for hex validation */
  hexError: string | null;
  /** Recent colors history */
  recentColors: string[];
}

export interface MoreColorsDialogSlice {
  moreColorsDialog: MoreColorsDialogState;
  /**
   * Open the More Colors dialog.
   * @param colorTarget - The type of color being selected
   * @param currentColor - Optional current color value
   */
  openMoreColorsDialog: (colorTarget: ColorTargetType, currentColor?: string) => void;
  /** Close the More Colors dialog */
  closeMoreColorsDialog: () => void;
  /** Set the active tab (standard/custom) */
  setMoreColorsActiveTab: (tab: 'standard' | 'custom') => void;
  /** Set RGB values (also updates HSL and hex) */
  setMoreColorsRGB: (rgb: Partial<RGBColor>) => void;
  /** Set HSL values (also updates RGB and hex) */
  setMoreColorsHSL: (hsl: Partial<HSLColor>) => void;
  /** Set hex input value (validates and updates RGB/HSL if valid) */
  setMoreColorsHex: (hex: string) => void;
  /** Add a color to recent colors history */
  addRecentColor: (color: string) => void;
  /** Load recent colors from localStorage */
  loadRecentColorsFromStorage: () => void;
  /** Clear the hex error */
  clearMoreColorsHexError: () => void;
  /** Get the current color as hex string */
  getSelectedColorHex: () => string;
}

// =============================================================================
// Color Conversion Utilities
// =============================================================================

/**
 * Convert RGB to hex string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Convert hex string to RGB.
 * Returns null if invalid hex.
 */
function hexToRgb(hex: string): RGBColor | null {
  // Remove # if present
  const clean = hex.replace('#', '');

  // Support both 3-digit and 6-digit hex
  let r: number, g: number, b: number;

  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
  } else {
    return null;
  }

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return null;
  }

  return { r, g, b };
}

/**
 * Convert RGB to HSL.
 */
function rgbToHsl(r: number, g: number, b: number): HSLColor {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL to RGB.
 */
function hslToRgb(h: number, s: number, l: number): RGBColor {
  h /= 360;
  s /= 100;
  l /= 100;

  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

// =============================================================================
// Initial State
// =============================================================================

const initialRGB: RGBColor = { r: 255, g: 0, b: 0 };
const initialHSL: HSLColor = { h: 0, s: 100, l: 50 };

const initialState: MoreColorsDialogState = {
  isOpen: false,
  colorTarget: 'fill',
  activeTab: 'custom',
  currentColor: null,
  rgb: { ...initialRGB },
  hsl: { ...initialHSL },
  hexInput: '#FF0000',
  hexError: null,
  recentColors: [],
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createMoreColorsDialogSlice: StateCreator<
  MoreColorsDialogSlice,
  [],
  [],
  MoreColorsDialogSlice
> = (set, get) => ({
  moreColorsDialog: initialState,

  openMoreColorsDialog: (colorTarget, currentColor) => {
    let rgb = { ...initialRGB };
    let hsl = { ...initialHSL };
    let hexInput = '#FF0000';

    // Parse current color if provided
    if (currentColor) {
      const parsed = hexToRgb(currentColor);
      if (parsed) {
        rgb = parsed;
        hsl = rgbToHsl(parsed.r, parsed.g, parsed.b);
        hexInput = rgbToHex(parsed.r, parsed.g, parsed.b);
      }
    }

    set({
      moreColorsDialog: {
        isOpen: true,
        colorTarget,
        activeTab: 'custom',
        currentColor: currentColor ?? null,
        rgb,
        hsl,
        hexInput,
        hexError: null,
        recentColors: get().moreColorsDialog.recentColors,
      },
    });
  },

  closeMoreColorsDialog: () => {
    set((state) => ({
      moreColorsDialog: {
        ...state.moreColorsDialog,
        isOpen: false,
      },
    }));
  },

  setMoreColorsActiveTab: (tab) => {
    set((state) => ({
      moreColorsDialog: {
        ...state.moreColorsDialog,
        activeTab: tab,
      },
    }));
  },

  setMoreColorsRGB: (rgbUpdate) => {
    set((state) => {
      const newRgb = {
        ...state.moreColorsDialog.rgb,
        ...rgbUpdate,
      };
      // Clamp values
      newRgb.r = Math.max(0, Math.min(255, Math.round(newRgb.r)));
      newRgb.g = Math.max(0, Math.min(255, Math.round(newRgb.g)));
      newRgb.b = Math.max(0, Math.min(255, Math.round(newRgb.b)));

      const newHsl = rgbToHsl(newRgb.r, newRgb.g, newRgb.b);
      const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);

      return {
        moreColorsDialog: {
          ...state.moreColorsDialog,
          rgb: newRgb,
          hsl: newHsl,
          hexInput: newHex,
          hexError: null,
        },
      };
    });
  },

  setMoreColorsHSL: (hslUpdate) => {
    set((state) => {
      const newHsl = {
        ...state.moreColorsDialog.hsl,
        ...hslUpdate,
      };
      // Clamp values
      newHsl.h = Math.max(0, Math.min(360, Math.round(newHsl.h)));
      newHsl.s = Math.max(0, Math.min(100, Math.round(newHsl.s)));
      newHsl.l = Math.max(0, Math.min(100, Math.round(newHsl.l)));

      const newRgb = hslToRgb(newHsl.h, newHsl.s, newHsl.l);
      const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);

      return {
        moreColorsDialog: {
          ...state.moreColorsDialog,
          rgb: newRgb,
          hsl: newHsl,
          hexInput: newHex,
          hexError: null,
        },
      };
    });
  },

  setMoreColorsHex: (hex) => {
    set((state) => {
      // Always update the input value
      const newState: Partial<MoreColorsDialogState> = {
        hexInput: hex,
        hexError: null,
      };

      // Try to parse and validate
      const parsed = hexToRgb(hex);
      if (parsed) {
        newState.rgb = parsed;
        newState.hsl = rgbToHsl(parsed.r, parsed.g, parsed.b);
        newState.hexError = null;
      } else if (hex.length > 0 && hex !== '#') {
        // Only show error if there's actual content
        const clean = hex.replace('#', '');
        if (clean.length >= 3) {
          newState.hexError = 'Invalid hex color. Use #RGB or #RRGGBB format.';
        }
      }

      return {
        moreColorsDialog: {
          ...state.moreColorsDialog,
          ...newState,
        },
      };
    });
  },

  addRecentColor: (color) => {
    set((state) => {
      // Normalize to uppercase hex
      const normalizedColor = color.toUpperCase();

      // Remove duplicate if exists, add to front
      const filtered = state.moreColorsDialog.recentColors.filter(
        (c) => c.toUpperCase() !== normalizedColor,
      );
      const updated = [normalizedColor, ...filtered].slice(0, MAX_RECENT_COLORS);

      // Persist to localStorage
      try {
        localStorage.setItem(RECENT_COLORS_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }

      return {
        moreColorsDialog: {
          ...state.moreColorsDialog,
          recentColors: updated,
        },
      };
    });
  },

  loadRecentColorsFromStorage: () => {
    try {
      const stored = localStorage.getItem(RECENT_COLORS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          set((state) => ({
            moreColorsDialog: {
              ...state.moreColorsDialog,
              recentColors: parsed.slice(0, MAX_RECENT_COLORS),
            },
          }));
        }
      }
    } catch {
      // Ignore storage errors
    }
  },

  clearMoreColorsHexError: () => {
    set((state) => ({
      moreColorsDialog: {
        ...state.moreColorsDialog,
        hexError: null,
      },
    }));
  },

  getSelectedColorHex: () => {
    const { rgb } = get().moreColorsDialog;
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  },
});
