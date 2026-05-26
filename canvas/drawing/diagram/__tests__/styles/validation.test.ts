/**
 * Tests for Diagram Style Validation
 *
 * Verifies validation functions for QuickStyle and ColorTheme.
 */

import type { ColorTheme, QuickStyle } from '@mog-sdk/contracts/diagram';
import {
  isValidHexColor,
  validateColorTheme,
  validateColorThemeForGeneration,
  validateColorThemeSafe,
  validateQuickStyle,
  validateQuickStyleSafe,
} from '../../src/styles/validation';

describe('isValidHexColor', () => {
  it('should accept valid hex colors with #', () => {
    expect(isValidHexColor('#4472C4')).toBe(true);
    expect(isValidHexColor('#FFFFFF')).toBe(true);
    expect(isValidHexColor('#000000')).toBe(true);
    expect(isValidHexColor('#aabbcc')).toBe(true);
  });

  it('should accept valid hex colors without #', () => {
    expect(isValidHexColor('4472C4')).toBe(true);
    expect(isValidHexColor('FFFFFF')).toBe(true);
  });

  it('should reject invalid hex colors', () => {
    expect(isValidHexColor('#FFF')).toBe(false); // Short form
    expect(isValidHexColor('#GGGGGG')).toBe(false); // Invalid chars
    expect(isValidHexColor('')).toBe(false);
    expect(isValidHexColor('red')).toBe(false);
    expect(isValidHexColor('rgb(255,0,0)')).toBe(false);
  });
});

describe('validateQuickStyle', () => {
  const validStyle: QuickStyle = {
    id: 'test-style',
    name: 'Test Style',
    category: 'subtle',
    fillType: 'solid',
    fillOpacity: 1,
    strokeWidth: 1,
    strokeOpacity: 1,
    effects: {},
    thumbnail: '',
  };

  it('should pass for valid style', () => {
    expect(() => validateQuickStyle(validStyle)).not.toThrow();
  });

  it('should throw for empty id', () => {
    expect(() => validateQuickStyle({ ...validStyle, id: '' })).toThrow(
      'QuickStyle must have a non-empty id',
    );
  });

  it('should throw for whitespace-only id', () => {
    expect(() => validateQuickStyle({ ...validStyle, id: '   ' })).toThrow(
      'QuickStyle must have a non-empty id',
    );
  });

  it('should throw for empty name', () => {
    expect(() => validateQuickStyle({ ...validStyle, name: '' })).toThrow(
      'QuickStyle must have a non-empty name',
    );
  });

  it('should throw for fillOpacity less than 0', () => {
    expect(() => validateQuickStyle({ ...validStyle, fillOpacity: -0.1 })).toThrow(
      'fillOpacity must be a number between 0 and 1',
    );
  });

  it('should throw for fillOpacity greater than 1', () => {
    expect(() => validateQuickStyle({ ...validStyle, fillOpacity: 1.1 })).toThrow(
      'fillOpacity must be a number between 0 and 1',
    );
  });

  it('should throw for strokeOpacity less than 0', () => {
    expect(() => validateQuickStyle({ ...validStyle, strokeOpacity: -0.1 })).toThrow(
      'strokeOpacity must be a number between 0 and 1',
    );
  });

  it('should throw for strokeOpacity greater than 1', () => {
    expect(() => validateQuickStyle({ ...validStyle, strokeOpacity: 1.1 })).toThrow(
      'strokeOpacity must be a number between 0 and 1',
    );
  });

  it('should throw for negative strokeWidth', () => {
    expect(() => validateQuickStyle({ ...validStyle, strokeWidth: -1 })).toThrow(
      'strokeWidth must be a non-negative number',
    );
  });

  it('should throw for invalid category', () => {
    expect(() =>
      validateQuickStyle({ ...validStyle, category: 'invalid' as QuickStyle['category'] }),
    ).toThrow('Invalid category');
  });

  it('should throw for invalid fillType', () => {
    expect(() =>
      validateQuickStyle({ ...validStyle, fillType: 'invalid' as QuickStyle['fillType'] }),
    ).toThrow('Invalid fillType');
  });

  it('should accept all valid categories', () => {
    ['subtle', 'moderate', 'intense', '3d'].forEach((category) => {
      expect(() =>
        validateQuickStyle({ ...validStyle, category: category as QuickStyle['category'] }),
      ).not.toThrow();
    });
  });

  it('should accept all valid fillTypes', () => {
    ['solid', 'gradient', 'pattern'].forEach((fillType) => {
      expect(() =>
        validateQuickStyle({ ...validStyle, fillType: fillType as QuickStyle['fillType'] }),
      ).not.toThrow();
    });
  });
});

describe('validateColorTheme', () => {
  const validTheme: ColorTheme = {
    id: 'test-theme',
    name: 'Test Theme',
    category: 'colorful',
    colorStrategy: 'sequential',
    colors: ['#FF0000', '#00FF00', '#0000FF'],
    opacity: 1,
  };

  it('should pass for valid theme', () => {
    expect(() => validateColorTheme(validTheme)).not.toThrow();
  });

  it('should throw for empty id', () => {
    expect(() => validateColorTheme({ ...validTheme, id: '' })).toThrow(
      'ColorTheme must have a non-empty id',
    );
  });

  it('should throw for empty name', () => {
    expect(() => validateColorTheme({ ...validTheme, name: '' })).toThrow(
      'ColorTheme must have a non-empty name',
    );
  });

  it('should throw for empty colors array', () => {
    expect(() => validateColorTheme({ ...validTheme, colors: [] })).toThrow(
      'ColorTheme must have at least one color',
    );
  });

  it('should throw for invalid hex color', () => {
    expect(() => validateColorTheme({ ...validTheme, colors: ['#FF0000', 'invalid'] })).toThrow(
      'Invalid hex color at index 1: invalid',
    );
  });

  it('should throw for short hex color', () => {
    expect(() => validateColorTheme({ ...validTheme, colors: ['#FFF'] })).toThrow(
      'Invalid hex color at index 0: #FFF',
    );
  });

  it('should throw for opacity less than 0', () => {
    expect(() => validateColorTheme({ ...validTheme, opacity: -0.1 })).toThrow(
      'opacity must be a number between 0 and 1',
    );
  });

  it('should throw for opacity greater than 1', () => {
    expect(() => validateColorTheme({ ...validTheme, opacity: 1.1 })).toThrow(
      'opacity must be a number between 0 and 1',
    );
  });

  it('should throw for invalid category', () => {
    expect(() =>
      validateColorTheme({ ...validTheme, category: 'invalid' as ColorTheme['category'] }),
    ).toThrow('Invalid category');
  });

  it('should throw for invalid colorStrategy', () => {
    expect(() =>
      validateColorTheme({
        ...validTheme,
        colorStrategy: 'invalid' as ColorTheme['colorStrategy'],
      }),
    ).toThrow('Invalid colorStrategy');
  });

  it('should accept all valid categories', () => {
    ['colorful', 'accent', 'transparent'].forEach((category) => {
      expect(() =>
        validateColorTheme({ ...validTheme, category: category as ColorTheme['category'] }),
      ).not.toThrow();
    });
  });

  it('should accept all valid colorStrategies', () => {
    ['sequential', 'by-level', 'gradient', 'single'].forEach((strategy) => {
      expect(() =>
        validateColorTheme({
          ...validTheme,
          colorStrategy: strategy as ColorTheme['colorStrategy'],
        }),
      ).not.toThrow();
    });
  });
});

describe('validateColorThemeForGeneration', () => {
  const validTheme: ColorTheme = {
    id: 'test-theme',
    name: 'Test Theme',
    category: 'colorful',
    colorStrategy: 'sequential',
    colors: ['#FF0000', '#00FF00'],
    opacity: 1,
  };

  it('should pass for valid theme', () => {
    expect(() => validateColorThemeForGeneration(validTheme)).not.toThrow();
  });

  it('should throw for empty colors array', () => {
    expect(() => validateColorThemeForGeneration({ ...validTheme, colors: [] })).toThrow(
      'Color theme must have at least one color for generation',
    );
  });

  it('should throw for invalid hex color', () => {
    expect(() => validateColorThemeForGeneration({ ...validTheme, colors: ['invalid'] })).toThrow(
      'Invalid hex color in theme: invalid',
    );
  });

  it('should not check other fields (only colors for generation)', () => {
    // This is a minimal validation - doesn't check id, name, etc.
    const minimalTheme = { ...validTheme, id: '', name: '' };
    expect(() => validateColorThemeForGeneration(minimalTheme)).not.toThrow();
  });
});

describe('validateQuickStyleSafe', () => {
  const validStyle: QuickStyle = {
    id: 'test-style',
    name: 'Test Style',
    category: 'subtle',
    fillType: 'solid',
    fillOpacity: 1,
    strokeWidth: 1,
    strokeOpacity: 1,
    effects: {},
    thumbnail: '',
  };

  it('should return valid: true for valid style', () => {
    const result = validateQuickStyleSafe(validStyle);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return valid: false with errors for invalid style', () => {
    const invalidStyle = { ...validStyle, id: '', fillOpacity: -1 };
    const result = validateQuickStyleSafe(invalidStyle);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors).toContain('QuickStyle must have a non-empty id');
    expect(result.errors).toContain('fillOpacity must be a number between 0 and 1');
  });

  it('should collect multiple errors', () => {
    const invalidStyle = {
      ...validStyle,
      id: '',
      name: '',
      fillOpacity: -1,
      strokeOpacity: 2,
      strokeWidth: -1,
    };
    const result = validateQuickStyleSafe(invalidStyle);

    expect(result.errors.length).toBe(5);
  });
});

describe('validateColorThemeSafe', () => {
  const validTheme: ColorTheme = {
    id: 'test-theme',
    name: 'Test Theme',
    category: 'colorful',
    colorStrategy: 'sequential',
    colors: ['#FF0000'],
    opacity: 1,
  };

  it('should return valid: true for valid theme', () => {
    const result = validateColorThemeSafe(validTheme);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return valid: false with errors for invalid theme', () => {
    const invalidTheme = { ...validTheme, id: '', colors: [] };
    const result = validateColorThemeSafe(invalidTheme);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should validate all color values', () => {
    const invalidTheme = {
      ...validTheme,
      colors: ['#FF0000', 'invalid', '#GGG'],
    };
    const result = validateColorThemeSafe(invalidTheme);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid hex color at index 1'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Invalid hex color at index 2'))).toBe(true);
  });
});
