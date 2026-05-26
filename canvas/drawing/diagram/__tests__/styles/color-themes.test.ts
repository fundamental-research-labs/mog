/**
 * Tests for Diagram Color Themes
 *
 * Verifies all 36 color themes, color generation strategies,
 * color utilities, and DEFAULT_ACCENT_COLORS immutability.
 */

import type { ColorTheme } from '@mog-sdk/contracts/diagram';
import {
  DEFAULT_ACCENT_COLORS,
  colorThemes,
  darkenColor,
  generateNodeColors,
  getAllColorThemeIds,
  getColorTheme,
  getColorThemesByCategory,
  hexToRgb,
  interpolateColors,
  lightenColor,
  rgbToHex,
} from '../../src/styles/color-themes';

describe('DEFAULT_ACCENT_COLORS', () => {
  it('should have 6 accent colors', () => {
    expect(DEFAULT_ACCENT_COLORS.length).toBe(6);
  });

  it('should be frozen and immutable', () => {
    expect(Object.isFrozen(DEFAULT_ACCENT_COLORS)).toBe(true);
  });

  it('should not allow modification', () => {
    // TypeScript prevents this at compile time with `readonly`,
    // but we test runtime behavior too
    expect(() => {
      // @ts-expect-error - Testing runtime immutability
      DEFAULT_ACCENT_COLORS[0] = '#000000';
    }).toThrow();
  });

  it('should have valid hex colors', () => {
    DEFAULT_ACCENT_COLORS.forEach((color) => {
      expect(color).toMatch(/^#[A-F0-9]{6}$/);
    });
  });

  it('should have expected Office theme colors', () => {
    expect(DEFAULT_ACCENT_COLORS[0]).toBe('#4472C4'); // Blue
    expect(DEFAULT_ACCENT_COLORS[1]).toBe('#ED7D31'); // Orange
    expect(DEFAULT_ACCENT_COLORS[2]).toBe('#A5A5A5'); // Gray
    expect(DEFAULT_ACCENT_COLORS[3]).toBe('#FFC000'); // Gold
    expect(DEFAULT_ACCENT_COLORS[4]).toBe('#5B9BD5'); // Light Blue
    expect(DEFAULT_ACCENT_COLORS[5]).toBe('#70AD47'); // Green
  });
});

describe('colorThemes map', () => {
  it('should have 36 color themes', () => {
    expect(colorThemes.size).toBe(36);
  });

  it('should have 5 colorful themes', () => {
    const colorfulThemes = getColorThemesByCategory('colorful');
    expect(colorfulThemes.length).toBe(5);
  });

  it('should have 29 accent themes (24 accent variations + 5 primary)', () => {
    const accentThemes = getColorThemesByCategory('accent');
    expect(accentThemes.length).toBe(29);
  });

  it('should have 2 transparent themes', () => {
    const transparentThemes = getColorThemesByCategory('transparent');
    expect(transparentThemes.length).toBe(2);
  });

  it('should have all expected colorful theme IDs', () => {
    ['colorful-1', 'colorful-2', 'colorful-3', 'colorful-4', 'colorful-5'].forEach((id) => {
      expect(colorThemes.has(id)).toBe(true);
    });
  });

  it('should have all accent variation themes for 6 accents', () => {
    for (let i = 1; i <= 6; i++) {
      expect(colorThemes.has(`accent-${i}-light`)).toBe(true);
      expect(colorThemes.has(`accent-${i}-outline`)).toBe(true);
      expect(colorThemes.has(`accent-${i}-fill`)).toBe(true);
      expect(colorThemes.has(`accent-${i}-gradient`)).toBe(true);
    }
  });

  it('should have primary theme colors', () => {
    expect(colorThemes.has('dark-1-outline')).toBe(true);
    expect(colorThemes.has('light-1-outline')).toBe(true);
    expect(colorThemes.has('dark-1-fill')).toBe(true);
  });

  it('should have transparent themes', () => {
    expect(colorThemes.has('transparent-gradient')).toBe(true);
    expect(colorThemes.has('transparent-outline')).toBe(true);
  });
});

describe('theme structure', () => {
  it('all themes should have required properties', () => {
    colorThemes.forEach((theme, id) => {
      expect(theme.id).toBe(id);
      expect(theme.name).toBeTruthy();
      expect(['colorful', 'accent', 'transparent']).toContain(theme.category);
      expect(['sequential', 'by-level', 'gradient', 'single']).toContain(theme.colorStrategy);
      expect(Array.isArray(theme.colors)).toBe(true);
      expect(theme.colors.length).toBeGreaterThan(0);
      expect(typeof theme.opacity).toBe('number');
      expect(theme.opacity).toBeGreaterThanOrEqual(0);
      expect(theme.opacity).toBeLessThanOrEqual(1);
    });
  });

  it('transparent themes should have opacity less than 1', () => {
    const transparentThemes = getColorThemesByCategory('transparent');
    transparentThemes.forEach((theme) => {
      expect(theme.opacity).toBeLessThan(1);
    });
  });
});

describe('getColorTheme', () => {
  it('should return theme for valid ID', () => {
    const theme = getColorTheme('colorful-1');
    expect(theme).toBeDefined();
    expect(theme?.id).toBe('colorful-1');
  });

  it('should return undefined for invalid ID', () => {
    const theme = getColorTheme('non-existent');
    expect(theme).toBeUndefined();
  });
});

describe('getAllColorThemeIds', () => {
  it('should return 36 theme IDs', () => {
    const ids = getAllColorThemeIds();
    expect(ids.length).toBe(36);
  });
});

describe('hexToRgb', () => {
  it('should parse valid hex colors with #', () => {
    const result = hexToRgb('#4472C4');
    expect(result).toEqual({ r: 68, g: 114, b: 196 });
  });

  it('should parse valid hex colors without #', () => {
    const result = hexToRgb('4472C4');
    expect(result).toEqual({ r: 68, g: 114, b: 196 });
  });

  it('should handle lowercase hex', () => {
    const result = hexToRgb('#aabbcc');
    expect(result).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('should handle uppercase hex', () => {
    const result = hexToRgb('#AABBCC');
    expect(result).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('should parse 3-char shorthand hex (#FFF)', () => {
    const result = hexToRgb('#FFF');
    expect(result).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('should throw for invalid hex (invalid characters)', () => {
    expect(() => hexToRgb('#GGGGGG')).toThrow('Invalid hex color: #GGGGGG');
  });

  it('should throw for empty string', () => {
    expect(() => hexToRgb('')).toThrow('Invalid hex color: ');
  });
});

describe('rgbToHex', () => {
  it('should convert RGB to hex', () => {
    expect(rgbToHex(68, 114, 196)).toBe('#4472C4');
  });

  it('should clamp values to 0-255', () => {
    expect(rgbToHex(-10, 300, 128)).toBe('#00FF80');
  });

  it('should round decimal values', () => {
    expect(rgbToHex(128.4, 128.6, 128)).toBe('#808180');
  });
});

describe('lightenColor', () => {
  it('should lighten a color', () => {
    const result = lightenColor('#000000', 0.5);
    expect(result).toBe('#808080');
  });

  it('should return white when amount is 1', () => {
    const result = lightenColor('#000000', 1);
    expect(result).toBe('#FFFFFF');
  });

  it('should return same color when amount is 0', () => {
    const result = lightenColor('#4472C4', 0);
    expect(result).toBe('#4472C4');
  });
});

describe('darkenColor', () => {
  it('should darken a color', () => {
    const result = darkenColor('#FFFFFF', 0.5);
    expect(result).toBe('#808080');
  });

  it('should return black when amount is 1', () => {
    const result = darkenColor('#FFFFFF', 1);
    expect(result).toBe('#000000');
  });

  it('should return same color when amount is 0', () => {
    const result = darkenColor('#4472C4', 0);
    expect(result).toBe('#4472C4');
  });
});

describe('interpolateColors', () => {
  it('should return first color at t=0', () => {
    const result = interpolateColors(['#000000', '#FFFFFF'], 0);
    expect(result).toBe('#000000');
  });

  it('should return last color at t=1', () => {
    const result = interpolateColors(['#000000', '#FFFFFF'], 1);
    expect(result).toBe('#FFFFFF');
  });

  it('should return middle color at t=0.5', () => {
    const result = interpolateColors(['#000000', '#FFFFFF'], 0.5);
    expect(result).toBe('#808080');
  });

  it('should handle single color array', () => {
    const result = interpolateColors(['#4472C4'], 0.5);
    expect(result).toBe('#4472C4');
  });

  it('should handle empty array', () => {
    const result = interpolateColors([], 0.5);
    expect(result).toBe('#000000');
  });

  it('should interpolate through multiple colors', () => {
    const colors = ['#FF0000', '#00FF00', '#0000FF'];
    expect(interpolateColors(colors, 0)).toBe('#FF0000');
    expect(interpolateColors(colors, 0.5)).toBe('#00FF00');
    expect(interpolateColors(colors, 1)).toBe('#0000FF');
  });
});

describe('generateNodeColors', () => {
  const mockTheme: ColorTheme = {
    id: 'test',
    name: 'Test',
    category: 'colorful',
    colorStrategy: 'sequential',
    colors: ['#FF0000', '#00FF00', '#0000FF'],
    opacity: 1,
  };

  describe('sequential strategy', () => {
    it('should assign colors in sequence', () => {
      const nodes = [
        { id: 'a', level: 0 },
        { id: 'b', level: 0 },
        { id: 'c', level: 0 },
      ];

      const colors = generateNodeColors(mockTheme, nodes);

      expect(colors.get('a')).toBe('#FF0000');
      expect(colors.get('b')).toBe('#00FF00');
      expect(colors.get('c')).toBe('#0000FF');
    });

    it('should cycle through colors', () => {
      const nodes = [
        { id: 'a', level: 0 },
        { id: 'b', level: 0 },
        { id: 'c', level: 0 },
        { id: 'd', level: 0 },
      ];

      const colors = generateNodeColors(mockTheme, nodes);

      expect(colors.get('d')).toBe('#FF0000'); // Wraps around
    });
  });

  describe('by-level strategy', () => {
    const byLevelTheme: ColorTheme = {
      ...mockTheme,
      colorStrategy: 'by-level',
    };

    it('should assign colors based on hierarchy level', () => {
      const nodes = [
        { id: 'a', level: 0 },
        { id: 'b', level: 1 },
        { id: 'c', level: 2 },
      ];

      const colors = generateNodeColors(byLevelTheme, nodes);

      expect(colors.get('a')).toBe('#FF0000'); // Level 0
      expect(colors.get('b')).toBe('#00FF00'); // Level 1
      expect(colors.get('c')).toBe('#0000FF'); // Level 2
    });

    it('should clamp to last color for deep levels', () => {
      const nodes = [{ id: 'a', level: 10 }];

      const colors = generateNodeColors(byLevelTheme, nodes);

      expect(colors.get('a')).toBe('#0000FF'); // Last color
    });
  });

  describe('gradient strategy', () => {
    const gradientTheme: ColorTheme = {
      ...mockTheme,
      colorStrategy: 'gradient',
    };

    it('should interpolate colors across nodes', () => {
      const nodes = [
        { id: 'a', level: 0 },
        { id: 'b', level: 0 },
        { id: 'c', level: 0 },
      ];

      const colors = generateNodeColors(gradientTheme, nodes);

      expect(colors.get('a')).toBe('#FF0000'); // First
      expect(colors.get('b')).toBe('#00FF00'); // Middle
      expect(colors.get('c')).toBe('#0000FF'); // Last
    });

    it('should handle single node', () => {
      const nodes = [{ id: 'a', level: 0 }];

      const colors = generateNodeColors(gradientTheme, nodes);

      expect(colors.get('a')).toBe('#FF0000');
    });
  });

  describe('single strategy', () => {
    const singleTheme: ColorTheme = {
      ...mockTheme,
      colorStrategy: 'single',
    };

    it('should assign same color to all nodes', () => {
      const nodes = [
        { id: 'a', level: 0 },
        { id: 'b', level: 1 },
        { id: 'c', level: 2 },
      ];

      const colors = generateNodeColors(singleTheme, nodes);

      expect(colors.get('a')).toBe('#FF0000');
      expect(colors.get('b')).toBe('#FF0000');
      expect(colors.get('c')).toBe('#FF0000');
    });
  });

  describe('edge cases', () => {
    it('should return empty map for empty nodes array', () => {
      const colors = generateNodeColors(mockTheme, []);
      expect(colors.size).toBe(0);
    });

    it('should handle empty colors array with fallback', () => {
      const emptyTheme: ColorTheme = {
        ...mockTheme,
        colors: [],
      };
      const nodes = [{ id: 'a', level: 0 }];

      const colors = generateNodeColors(emptyTheme, nodes);
      expect(colors.get('a')).toBe('#000000'); // Fallback
    });

    it('should use accent colors override when provided', () => {
      const nodes = [{ id: 'a', level: 0 }];
      const accentColors = ['#AABBCC'];

      const colors = generateNodeColors(mockTheme, nodes, accentColors);

      expect(colors.get('a')).toBe('#AABBCC');
    });
  });
});
