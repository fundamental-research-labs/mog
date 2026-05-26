/**
 * Tests for Diagram Quick Styles
 *
 * Verifies all 16 quick styles are defined and functions work correctly.
 */

import {
  applyQuickStyleToShape,
  getAllQuickStyleIds,
  getQuickStyle,
  getQuickStylesByCategory,
  quickStyles,
} from '../../src/styles/quick-styles';

describe('Quick Styles', () => {
  describe('quickStyles map', () => {
    it('should have exactly 16 quick styles', () => {
      expect(quickStyles.size).toBe(16);
    });

    it('should have all expected style IDs', () => {
      const expectedIds = [
        // 2D styles
        'simple-fill',
        'subtle-effect',
        'subtle-line',
        'moderate-effect',
        'intense-effect',
        // 3D styles
        'polished',
        'inset',
        '3d-cartoon',
        'powder',
        '3d-polished',
        '3d-flat-scene',
        '3d-powder',
        'brick-scene',
        'metallic-scene',
        'sunrise-scene',
        'birds-eye-scene',
      ];

      expectedIds.forEach((id) => {
        expect(quickStyles.has(id)).toBe(true);
      });
    });

    it('should have 3 subtle styles', () => {
      const subtleStyles = getQuickStylesByCategory('subtle');
      expect(subtleStyles.length).toBe(3);
    });

    it('should have 3 moderate styles', () => {
      const moderateStyles = getQuickStylesByCategory('moderate');
      expect(moderateStyles.length).toBe(3);
    });

    it('should have 3 intense styles', () => {
      const intenseStyles = getQuickStylesByCategory('intense');
      expect(intenseStyles.length).toBe(3);
    });

    it('should have 7 3d styles', () => {
      const styles3d = getQuickStylesByCategory('3d');
      expect(styles3d.length).toBe(7);
    });
  });

  describe('style structure', () => {
    it('all styles should have required properties', () => {
      quickStyles.forEach((style, id) => {
        expect(style.id).toBe(id);
        expect(style.name).toBeTruthy();
        expect(['subtle', 'moderate', 'intense', '3d']).toContain(style.category);
        expect(['solid', 'gradient', 'pattern']).toContain(style.fillType);
        expect(typeof style.fillOpacity).toBe('number');
        expect(style.fillOpacity).toBeGreaterThanOrEqual(0);
        expect(style.fillOpacity).toBeLessThanOrEqual(1);
        expect(typeof style.strokeWidth).toBe('number');
        expect(style.strokeWidth).toBeGreaterThanOrEqual(0);
        expect(typeof style.strokeOpacity).toBe('number');
        expect(style.strokeOpacity).toBeGreaterThanOrEqual(0);
        expect(style.strokeOpacity).toBeLessThanOrEqual(1);
        expect(style.effects).toBeDefined();
        expect(typeof style.thumbnail).toBe('string');
      });
    });

    it('3d styles should have bevel effects', () => {
      const styles3d = getQuickStylesByCategory('3d');
      styles3d.forEach((style) => {
        expect(style.effects.bevel).toBeDefined();
        expect(style.effects.bevel?.type).toBeTruthy();
        expect(typeof style.effects.bevel?.width).toBe('number');
        expect(typeof style.effects.bevel?.height).toBe('number');
      });
    });

    it('subtle-effect should have shadow', () => {
      const style = getQuickStyle('subtle-effect');
      expect(style?.effects.shadow).toBeDefined();
      expect(style?.effects.shadow?.blur).toBeGreaterThan(0);
    });

    it('intense-effect should have shadow and glow', () => {
      const style = getQuickStyle('intense-effect');
      expect(style?.effects.shadow).toBeDefined();
      expect(style?.effects.glow).toBeDefined();
    });
  });

  describe('getQuickStyle', () => {
    it('should return style for valid ID', () => {
      const style = getQuickStyle('subtle-effect');
      expect(style).toBeDefined();
      expect(style?.id).toBe('subtle-effect');
      expect(style?.name).toBe('Subtle Effect');
    });

    it('should return undefined for invalid ID', () => {
      const style = getQuickStyle('non-existent');
      expect(style).toBeUndefined();
    });
  });

  describe('getQuickStylesByCategory', () => {
    it('should return only styles in the specified category', () => {
      const moderateStyles = getQuickStylesByCategory('moderate');
      moderateStyles.forEach((style) => {
        expect(style.category).toBe('moderate');
      });
    });
  });

  describe('getAllQuickStyleIds', () => {
    it('should return all 16 style IDs', () => {
      const ids = getAllQuickStyleIds();
      expect(ids.length).toBe(16);
    });
  });

  describe('applyQuickStyleToShape', () => {
    it('should apply style settings to base colors', () => {
      const baseStyle = { fill: '#4472C4', stroke: '#2E5090' };
      const quickStyle = getQuickStyle('subtle-effect')!;

      const result = applyQuickStyleToShape(baseStyle, quickStyle);

      expect(result.fill).toBe('#4472C4');
      expect(result.stroke).toBe('#2E5090');
      expect(result.strokeWidth).toBe(quickStyle.strokeWidth);
      expect(result.fillOpacity).toBe(quickStyle.fillOpacity);
      expect(result.strokeOpacity).toBe(quickStyle.strokeOpacity);
      expect(result.effects).toStrictEqual(quickStyle.effects);
    });

    it('should preserve base colors when applying different styles', () => {
      const baseStyle = { fill: '#FF0000', stroke: '#00FF00' };

      const subtleResult = applyQuickStyleToShape(baseStyle, getQuickStyle('subtle-effect')!);
      const intenseResult = applyQuickStyleToShape(baseStyle, getQuickStyle('intense-effect')!);

      // Both should have same base colors
      expect(subtleResult.fill).toBe('#FF0000');
      expect(intenseResult.fill).toBe('#FF0000');

      // But different effects
      expect(subtleResult.effects).not.toBe(intenseResult.effects);
    });
  });
});
