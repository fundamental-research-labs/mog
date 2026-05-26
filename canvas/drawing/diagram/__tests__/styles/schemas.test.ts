/**
 * Tests for Diagram Style Schema Definitions
 *
 * Verifies that QUICK_STYLE_SCHEMA and COLOR_THEME_SCHEMA follow
 * the correct FieldDef structure from schema-types.ts.
 */

import {
  COLOR_THEME_SCHEMA,
  getColorThemeSchemaDefault,
  getColorThemeSchemaDefaults,
  getQuickStyleSchemaDefault,
  getQuickStyleSchemaDefaults,
  isColorThemeFieldRequired,
  isQuickStyleFieldRequired,
  QUICK_STYLE_SCHEMA,
} from '../../src/styles/quick-style-schema';

describe('QUICK_STYLE_SCHEMA', () => {
  describe('structure', () => {
    it('should have all required fields for QuickStyle', () => {
      const expectedFields = [
        'id',
        'name',
        'category',
        'fillType',
        'fillOpacity',
        'strokeWidth',
        'strokeOpacity',
        'effects',
        'thumbnail',
      ];

      expectedFields.forEach((field) => {
        expect(QUICK_STYLE_SCHEMA).toHaveProperty(field);
      });
    });

    it('should use primitive type for all fields', () => {
      Object.values(QUICK_STYLE_SCHEMA).forEach((fieldDef) => {
        expect(fieldDef.type).toBe('primitive');
      });
    });

    it('should have required, copy, and lazyInit for all fields', () => {
      Object.entries(QUICK_STYLE_SCHEMA).forEach(([fieldName, fieldDef]) => {
        expect(fieldDef).toHaveProperty('required');
        expect(fieldDef).toHaveProperty('copy');
        expect(fieldDef).toHaveProperty('lazyInit');
        expect(typeof fieldDef.required).toBe('boolean');
        expect(['deep', 'shallow', 'skip']).toContain(fieldDef.copy);
        expect(typeof fieldDef.lazyInit).toBe('boolean');
      });
    });

    it('should have correct defaults for key fields', () => {
      expect(QUICK_STYLE_SCHEMA.id.default).toBe('');
      expect(QUICK_STYLE_SCHEMA.name.default).toBe('');
      expect(QUICK_STYLE_SCHEMA.category.default).toBe('subtle');
      expect(QUICK_STYLE_SCHEMA.fillType.default).toBe('solid');
      expect(QUICK_STYLE_SCHEMA.fillOpacity.default).toBe(1);
      expect(QUICK_STYLE_SCHEMA.strokeWidth.default).toBe(1);
      expect(QUICK_STYLE_SCHEMA.strokeOpacity.default).toBe(1);
      expect(QUICK_STYLE_SCHEMA.effects.default).toEqual({});
      expect(QUICK_STYLE_SCHEMA.thumbnail.default).toBe('');
    });

    it('should mark effects as deep copy', () => {
      expect(QUICK_STYLE_SCHEMA.effects.copy).toBe('deep');
    });
  });

  describe('utility functions', () => {
    it('getQuickStyleSchemaDefault should return correct defaults', () => {
      expect(getQuickStyleSchemaDefault('id')).toBe('');
      expect(getQuickStyleSchemaDefault('fillOpacity')).toBe(1);
      expect(getQuickStyleSchemaDefault('category')).toBe('subtle');
    });

    it('getQuickStyleSchemaDefaults should return all defaults', () => {
      const defaults = getQuickStyleSchemaDefaults();

      expect(defaults.id).toBe('');
      expect(defaults.fillOpacity).toBe(1);
      expect(defaults.strokeWidth).toBe(1);
      expect(defaults.effects).toEqual({});
    });

    it('isQuickStyleFieldRequired should correctly identify required fields', () => {
      expect(isQuickStyleFieldRequired('id')).toBe(true);
      expect(isQuickStyleFieldRequired('name')).toBe(true);
      expect(isQuickStyleFieldRequired('effects')).toBe(false);
      expect(isQuickStyleFieldRequired('thumbnail')).toBe(false);
    });
  });
});

describe('COLOR_THEME_SCHEMA', () => {
  describe('structure', () => {
    it('should have all required fields for ColorTheme', () => {
      const expectedFields = ['id', 'name', 'category', 'colorStrategy', 'colors', 'opacity'];

      expectedFields.forEach((field) => {
        expect(COLOR_THEME_SCHEMA).toHaveProperty(field);
      });
    });

    it('should use primitive type for all fields', () => {
      Object.values(COLOR_THEME_SCHEMA).forEach((fieldDef) => {
        expect(fieldDef.type).toBe('primitive');
      });
    });

    it('should have required, copy, and lazyInit for all fields', () => {
      Object.entries(COLOR_THEME_SCHEMA).forEach(([fieldName, fieldDef]) => {
        expect(fieldDef).toHaveProperty('required');
        expect(fieldDef).toHaveProperty('copy');
        expect(fieldDef).toHaveProperty('lazyInit');
        expect(typeof fieldDef.required).toBe('boolean');
        expect(['deep', 'shallow', 'skip']).toContain(fieldDef.copy);
        expect(typeof fieldDef.lazyInit).toBe('boolean');
      });
    });

    it('should have correct defaults for key fields', () => {
      expect(COLOR_THEME_SCHEMA.id.default).toBe('');
      expect(COLOR_THEME_SCHEMA.name.default).toBe('');
      expect(COLOR_THEME_SCHEMA.category.default).toBe('colorful');
      expect(COLOR_THEME_SCHEMA.colorStrategy.default).toBe('sequential');
      expect(COLOR_THEME_SCHEMA.colors.default).toEqual([]);
      expect(COLOR_THEME_SCHEMA.opacity.default).toBe(1);
    });

    it('should mark colors as deep copy', () => {
      expect(COLOR_THEME_SCHEMA.colors.copy).toBe('deep');
    });
  });

  describe('utility functions', () => {
    it('getColorThemeSchemaDefault should return correct defaults', () => {
      expect(getColorThemeSchemaDefault('id')).toBe('');
      expect(getColorThemeSchemaDefault('opacity')).toBe(1);
      expect(getColorThemeSchemaDefault('category')).toBe('colorful');
    });

    it('getColorThemeSchemaDefaults should return all defaults', () => {
      const defaults = getColorThemeSchemaDefaults();

      expect(defaults.id).toBe('');
      expect(defaults.opacity).toBe(1);
      expect(defaults.colorStrategy).toBe('sequential');
      expect(defaults.colors).toEqual([]);
    });

    it('isColorThemeFieldRequired should correctly identify required fields', () => {
      expect(isColorThemeFieldRequired('id')).toBe(true);
      expect(isColorThemeFieldRequired('name')).toBe(true);
      expect(isColorThemeFieldRequired('colors')).toBe(true);
      expect(isColorThemeFieldRequired('opacity')).toBe(true);
    });
  });
});
