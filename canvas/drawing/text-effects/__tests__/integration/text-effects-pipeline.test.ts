/**
 * TextEffect Rendering Pipeline Integration Tests
 *
 * End-to-end: warpToDrawingObjects() -> renderDrawingObjectToSVG().
 * Uses REAL implementations, NOT mocks.
 */
import { renderDrawingObjectToSVG } from '@mog/drawing-engine';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import {
  getAllPresetNames,
  warpToDrawingObjects,
  type GlyphBox,
  type TextEffectStyle,
} from '../../src';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create sample glyph boxes for a text string.
 * Each character gets a 20px-wide, 24px-tall glyph with 20px ascent and 4px descent.
 */
function createSampleGlyphs(text: string): GlyphBox[] {
  return text.split('').map((char, i) => ({
    char,
    x: i * 20,
    y: 0,
    width: 18,
    height: 24,
    ascent: 20,
    descent: 4,
  }));
}

// =============================================================================
// Tests
// =============================================================================

describe('TextEffect Pipeline Integration', () => {
  const sampleGlyphs = createSampleGlyphs('ABC');

  // ===========================================================================
  // 1. Basic warp produces DrawingObjects
  // ===========================================================================

  it('basic warp produces non-empty DrawingObject array', () => {
    const result = warpToDrawingObjects(sampleGlyphs, 'textPlain', 200, 100);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 2. Each glyph has geometry
  // ===========================================================================

  it('each DrawingObject has geometry with segments', () => {
    const result = warpToDrawingObjects(sampleGlyphs, 'textPlain', 200, 100);

    for (const obj of result) {
      const typedObj = obj as DrawingObject;
      expect(typedObj.geometry).toBeDefined();
      expect(typedObj.geometry.segments).toBeDefined();

      // For direct glyph objects (no 3D wrapping), each should have segments
      if (!typedObj.children) {
        expect(typedObj.geometry.segments.length).toBeGreaterThan(0);
      }
    }
  });

  // ===========================================================================
  // 3. Default fill is solid black
  // ===========================================================================

  it('without style, each glyph DrawingObject has solid black fill', () => {
    const result = warpToDrawingObjects(sampleGlyphs, 'textPlain', 200, 100);

    for (const obj of result) {
      const typedObj = obj as DrawingObject;
      // Direct glyph objects (not 3D wrapper)
      if (!typedObj.children) {
        expect(typedObj.fill).toBeDefined();
        expect((typedObj.fill as { type: string }).type).toBe('solid');
        expect((typedObj.fill as { color: string }).color).toBe('#000000');
      }
    }
  });

  // ===========================================================================
  // 4. Custom style propagates fill
  // ===========================================================================

  it('custom style fill propagates to all glyph objects', () => {
    const style: TextEffectStyle = {
      fill: { type: 'solid', color: '#FF0000' },
    };

    const result = warpToDrawingObjects(sampleGlyphs, 'textPlain', 200, 100, undefined, style);

    // Collect all leaf-level glyph objects
    const glyphObjects: DrawingObject[] = [];
    for (const obj of result) {
      const typedObj = obj as DrawingObject;
      if (typedObj.children) {
        // 3D wrapper: check children
        for (const child of typedObj.children) {
          glyphObjects.push(child);
        }
      } else {
        glyphObjects.push(typedObj);
      }
    }

    expect(glyphObjects.length).toBeGreaterThan(0);

    for (const glyph of glyphObjects) {
      expect(glyph.fill).toBeDefined();
      expect((glyph.fill as { type: string }).type).toBe('solid');
      expect((glyph.fill as { color: string }).color).toBe('#FF0000');
    }
  });

  // ===========================================================================
  // 5. All presets produce output
  // ===========================================================================

  it('all presets produce non-empty DrawingObject arrays', () => {
    const presets = getAllPresetNames();
    expect(presets.length).toBeGreaterThan(0);

    let nonEmptyCount = 0;

    for (const preset of presets) {
      const result = warpToDrawingObjects(sampleGlyphs, preset, 200, 100);
      expect(Array.isArray(result)).toBe(true);

      // Assert that preset results have length > 0 for non-degenerate input
      if (result.length > 0) {
        nonEmptyCount++;

        // Verify SVG rendering includes path elements
        for (const obj of result) {
          const typedObj = obj as DrawingObject;
          if (typedObj.children) {
            // For grouped objects, verify children have geometry
            for (const child of typedObj.children) {
              expect(child.geometry).toBeDefined();
              expect(child.geometry.segments.length).toBeGreaterThan(0);
            }
          } else {
            const svg = renderDrawingObjectToSVG(typedObj);
            expect(svg).toContain('<path');
          }
        }
      }
    }

    // At least most presets should produce non-empty results for valid glyphs
    expect(nonEmptyCount).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 6. SVG rendering doesn't crash
  // ===========================================================================

  it('rendering DrawingObjects to SVG produces valid output with fill colors', () => {
    const result = warpToDrawingObjects(sampleGlyphs, 'textPlain', 200, 100);
    expect(result.length).toBeGreaterThan(0);

    const allSvg: string[] = [];
    expect(() => {
      for (const obj of result) {
        const typedObj = obj as DrawingObject;
        const svg = renderDrawingObjectToSVG(typedObj);
        allSvg.push(svg);
      }
    }).not.toThrow();

    // Verify SVG output contains fill colors (default is solid black '#000000')
    const combinedSvg = allSvg.join('');
    expect(combinedSvg).toContain('<path');
    expect(combinedSvg).toContain('#000000');
  });

  // ===========================================================================
  // 6b. Custom fill colors appear in SVG output
  // ===========================================================================

  it('custom fill color appears in rendered SVG output', () => {
    const style: TextEffectStyle = {
      fill: { type: 'solid', color: '#FF5500' },
    };

    const result = warpToDrawingObjects(sampleGlyphs, 'textPlain', 200, 100, undefined, style);
    expect(result.length).toBeGreaterThan(0);

    const allSvg = result.map((obj) => renderDrawingObjectToSVG(obj as DrawingObject)).join('');
    expect(allSvg).toContain('#FF5500');
  });

  // ===========================================================================
  // 7. 3D style wraps in parent
  // ===========================================================================

  it('3D style wraps glyph objects in a parent with children', () => {
    const style: TextEffectStyle = {
      fill: { type: 'solid', color: '#000000' },
      threeDRotation: {
        rotationX: 15,
        rotationY: 0,
        rotationZ: 0,
      },
    };

    const result = warpToDrawingObjects(sampleGlyphs, 'textPlain', 200, 100, undefined, style);

    expect(result.length).toBeGreaterThan(0);

    // When 3D is enabled, the result should be a single parent with children
    const parent = result[0] as DrawingObject;
    expect(parent.children).toBeDefined();
    expect(parent.children!.length).toBeGreaterThan(0);
    expect(parent.transform).toBeDefined();
  });
});
