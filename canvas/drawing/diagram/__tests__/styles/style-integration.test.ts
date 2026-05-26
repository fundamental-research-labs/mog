/**
 * Style Integration Tests for Diagram
 *
 * Tests quick style application and color theme generation in an integration
 * context, verifying the end-to-end styling pipeline works correctly.
 */

import {
  generateNodeColors,
  getAllColorThemeIds,
  getColorTheme,
} from '../../src/styles/color-themes';
import {
  applyQuickStyleToShape,
  getAllQuickStyleIds,
  getQuickStyle,
} from '../../src/styles/quick-styles';

// =============================================================================
// Quick Style Application Integration Tests
// =============================================================================

describe('Quick style application (integration)', () => {
  it('should have exactly 16 valid quick style IDs', () => {
    const ids = getAllQuickStyleIds();
    expect(ids).toHaveLength(16);
  });

  it('all 16 quick style IDs should resolve to valid QuickStyle objects', () => {
    const ids = getAllQuickStyleIds();
    ids.forEach((id) => {
      const style = getQuickStyle(id);
      expect(style).toBeDefined();
      expect(style!.id).toBe(id);
      expect(style!.name).toBeTruthy();
    });
  });

  it('should produce a valid shape config when applying each quick style', () => {
    const ids = getAllQuickStyleIds();
    const baseStyle = { fill: '#4472C4', stroke: '#2E5090' };

    ids.forEach((id) => {
      const quickStyle = getQuickStyle(id)!;
      const result = applyQuickStyleToShape(baseStyle, quickStyle);

      // Verify all required output fields exist and have valid types
      expect(result.fill).toBe('#4472C4');
      expect(result.stroke).toBe('#2E5090');
      expect(typeof result.strokeWidth).toBe('number');
      expect(result.strokeWidth).toBeGreaterThanOrEqual(0);
      expect(typeof result.fillOpacity).toBe('number');
      expect(result.fillOpacity).toBeGreaterThanOrEqual(0);
      expect(result.fillOpacity).toBeLessThanOrEqual(1);
      expect(typeof result.strokeOpacity).toBe('number');
      expect(result.strokeOpacity).toBeGreaterThanOrEqual(0);
      expect(result.strokeOpacity).toBeLessThanOrEqual(1);
      expect(result.effects).toBeDefined();
      expect(typeof result.effects).toBe('object');
    });
  });

  it('should deep-clone effects (modifying result does not affect original)', () => {
    const quickStyle = getQuickStyle('subtle-effect')!;
    const baseStyle = { fill: '#FF0000', stroke: '#000000' };

    const result1 = applyQuickStyleToShape(baseStyle, quickStyle);
    const result2 = applyQuickStyleToShape(baseStyle, quickStyle);

    // Both should have shadow effects
    expect(result1.effects.shadow).toBeDefined();
    expect(result2.effects.shadow).toBeDefined();

    // Mutate result1's shadow
    if (result1.effects.shadow) {
      result1.effects.shadow.blur = 999;
    }

    // result2 should not be affected
    expect(result2.effects.shadow!.blur).not.toBe(999);

    // Original quick style should not be affected either
    expect(quickStyle.effects.shadow!.blur).not.toBe(999);
  });

  it('should deep-clone bevel effects for 3D styles', () => {
    const quickStyle = getQuickStyle('3d-cartoon')!;
    const baseStyle = { fill: '#FF0000', stroke: '#000000' };

    const result1 = applyQuickStyleToShape(baseStyle, quickStyle);
    const result2 = applyQuickStyleToShape(baseStyle, quickStyle);

    expect(result1.effects.bevel).toBeDefined();
    expect(result2.effects.bevel).toBeDefined();

    // Mutate result1's bevel
    if (result1.effects.bevel) {
      result1.effects.bevel.width = 999;
    }

    // result2 should not be affected
    expect(result2.effects.bevel!.width).not.toBe(999);
  });

  it('getQuickStyle should return undefined for invalid IDs (not throw)', () => {
    expect(() => getQuickStyle('invalid-id')).not.toThrow();
    expect(getQuickStyle('invalid-id')).toBeUndefined();

    expect(() => getQuickStyle('')).not.toThrow();
    expect(getQuickStyle('')).toBeUndefined();

    expect(() => getQuickStyle('null')).not.toThrow();
    expect(getQuickStyle('null')).toBeUndefined();
  });

  it('should produce different effects for different quick styles', () => {
    const baseStyle = { fill: '#4472C4', stroke: '#2E5090' };

    const simpleFill = applyQuickStyleToShape(baseStyle, getQuickStyle('simple-fill')!);
    const intenseEffect = applyQuickStyleToShape(baseStyle, getQuickStyle('intense-effect')!);
    const cartoon3d = applyQuickStyleToShape(baseStyle, getQuickStyle('3d-cartoon')!);

    // simple-fill has no effects
    expect(simpleFill.effects.shadow).toBeUndefined();
    expect(simpleFill.effects.glow).toBeUndefined();
    expect(simpleFill.effects.bevel).toBeUndefined();

    // intense-effect has shadow and glow
    expect(intenseEffect.effects.shadow).toBeDefined();
    expect(intenseEffect.effects.glow).toBeDefined();

    // 3d-cartoon has bevel and shadow
    expect(cartoon3d.effects.bevel).toBeDefined();
    expect(cartoon3d.effects.shadow).toBeDefined();
  });
});

// =============================================================================
// Color Theme Generation Integration Tests
// =============================================================================

describe('Color theme generation (integration)', () => {
  it('should have all color theme IDs valid', () => {
    const ids = getAllColorThemeIds();
    expect(ids.length).toBe(36);

    ids.forEach((id) => {
      const theme = getColorTheme(id);
      expect(theme).toBeDefined();
      expect(theme!.id).toBe(id);
    });
  });

  it('should generate colors for each node', () => {
    const theme = getColorTheme('colorful-1')!;
    const nodes = [
      { id: 'node-1', level: 0 },
      { id: 'node-2', level: 0 },
      { id: 'node-3', level: 0 },
    ];

    const colors = generateNodeColors(theme, nodes);

    expect(colors.size).toBe(3);
    expect(colors.has('node-1')).toBe(true);
    expect(colors.has('node-2')).toBe(true);
    expect(colors.has('node-3')).toBe(true);

    // All colors should be valid hex strings
    colors.forEach((color) => {
      expect(color).toMatch(/^#[A-Fa-f0-9]{6}$/);
    });
  });

  it('should produce different colors for different levels in colorful by-level theme', () => {
    const theme = getColorTheme('colorful-3')!;
    // colorful-3 uses by-level strategy
    expect(theme.colorStrategy).toBe('by-level');

    const nodes = [
      { id: 'root', level: 0 },
      { id: 'child', level: 1 },
      { id: 'grandchild', level: 2 },
    ];

    const colors = generateNodeColors(theme, nodes);

    // Different levels should get different colors
    expect(colors.get('root')).not.toBe(colors.get('child'));
    expect(colors.get('child')).not.toBe(colors.get('grandchild'));
  });

  it('should produce different colors for different levels in accent light themes', () => {
    // accent-1-light uses by-level strategy
    const theme = getColorTheme('accent-1-light')!;
    expect(theme.colorStrategy).toBe('by-level');

    const nodes = [
      { id: 'root', level: 0 },
      { id: 'child', level: 1 },
      { id: 'grandchild', level: 2 },
    ];

    const colors = generateNodeColors(theme, nodes);

    // Level 0 and level 1 should have different colors
    expect(colors.get('root')).not.toBe(colors.get('child'));
  });

  it('should produce same color for all nodes in single-strategy themes', () => {
    const theme = getColorTheme('accent-1-outline')!;
    expect(theme.colorStrategy).toBe('single');

    const nodes = [
      { id: 'a', level: 0 },
      { id: 'b', level: 1 },
      { id: 'c', level: 2 },
    ];

    const colors = generateNodeColors(theme, nodes);

    expect(colors.get('a')).toBe(colors.get('b'));
    expect(colors.get('b')).toBe(colors.get('c'));
  });

  it('getColorTheme should return undefined for invalid IDs', () => {
    expect(getColorTheme('invalid-theme-id')).toBeUndefined();
    expect(getColorTheme('')).toBeUndefined();
    expect(getColorTheme('nonexistent')).toBeUndefined();
  });

  it('should handle empty nodes array', () => {
    const theme = getColorTheme('colorful-1')!;
    const colors = generateNodeColors(theme, []);
    expect(colors.size).toBe(0);
  });

  it('should generate valid colors for all theme IDs', () => {
    const ids = getAllColorThemeIds();
    const sampleNodes = [
      { id: 'a', level: 0 },
      { id: 'b', level: 1 },
      { id: 'c', level: 0 },
    ];

    ids.forEach((themeId) => {
      const theme = getColorTheme(themeId)!;
      const colors = generateNodeColors(theme, sampleNodes);

      expect(colors.size).toBe(3);
      colors.forEach((color) => {
        // Each color should be a valid hex string
        expect(color).toMatch(/^#[A-Fa-f0-9]{6}$/);
      });
    });
  });

  it('should produce gradient colors that vary across nodes', () => {
    const theme = getColorTheme('colorful-2')!;
    expect(theme.colorStrategy).toBe('gradient');

    const nodes = [
      { id: 'first', level: 0 },
      { id: 'middle', level: 0 },
      { id: 'last', level: 0 },
    ];

    const colors = generateNodeColors(theme, nodes);

    // First and last nodes in a gradient should have different colors
    expect(colors.get('first')).not.toBe(colors.get('last'));
  });

  it('should cycle sequential colors when more nodes than colors', () => {
    const theme = getColorTheme('colorful-1')!;
    expect(theme.colorStrategy).toBe('sequential');

    // Create more nodes than accent colors (6 accents)
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      id: `node-${i}`,
      level: 0,
    }));

    const colors = generateNodeColors(theme, nodes);

    // Node 0 and node 6 should have the same color (cycling through 6 colors)
    expect(colors.get('node-0')).toBe(colors.get('node-6'));
    expect(colors.get('node-1')).toBe(colors.get('node-7'));
  });
});
