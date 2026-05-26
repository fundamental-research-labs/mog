/**
 * Tests for DefaultFontResolver -- maps font family names to base-14 PDF fonts.
 */

import type { FontResolver } from '../font-resolver';
import { DefaultFontResolver } from '../font-resolver';

describe('DefaultFontResolver', () => {
  let resolver: DefaultFontResolver;

  beforeEach(() => {
    resolver = new DefaultFontResolver();
  });

  // --------------------------------------------------------------------------
  // Sans-serif font families -> Helvetica
  // --------------------------------------------------------------------------

  describe('sans-serif families', () => {
    const sansSerifFamilies = [
      'Arial',
      'Calibri',
      'Helvetica',
      'Verdana',
      'Tahoma',
      'Trebuchet MS',
      'Segoe UI',
      'Open Sans',
      'Roboto',
      'sans-serif',
      'sans',
    ];

    for (const family of sansSerifFamilies) {
      it(`maps "${family}" to helvetica`, () => {
        const handle = resolver.resolve(family, false, false);
        expect(handle.family).toBe('helvetica');
      });
    }
  });

  // --------------------------------------------------------------------------
  // Serif font families -> Times
  // --------------------------------------------------------------------------

  describe('serif families', () => {
    const serifFamilies = [
      'Times',
      'Times New Roman',
      'Times-Roman',
      'Cambria',
      'Georgia',
      'Garamond',
      'Palatino',
      'serif',
    ];

    for (const family of serifFamilies) {
      it(`maps "${family}" to times`, () => {
        const handle = resolver.resolve(family, false, false);
        expect(handle.family).toBe('times');
      });
    }
  });

  // --------------------------------------------------------------------------
  // Monospace font families -> Courier
  // --------------------------------------------------------------------------

  describe('monospace families', () => {
    const monoFamilies = [
      'Courier',
      'Courier New',
      'Consolas',
      'Monaco',
      'Lucida Console',
      'Menlo',
      'monospace',
      'mono',
    ];

    for (const family of monoFamilies) {
      it(`maps "${family}" to courier`, () => {
        const handle = resolver.resolve(family, false, false);
        expect(handle.family).toBe('courier');
      });
    }
  });

  // --------------------------------------------------------------------------
  // Unknown fonts -> Helvetica (default)
  // --------------------------------------------------------------------------

  describe('unknown fonts', () => {
    it('defaults to helvetica for unknown font families', () => {
      const handle = resolver.resolve('Comic Sans MS', false, false);
      expect(handle.family).toBe('helvetica');
    });

    it('defaults to helvetica for empty string', () => {
      const handle = resolver.resolve('', false, false);
      expect(handle.family).toBe('helvetica');
    });
  });

  // --------------------------------------------------------------------------
  // Weight and Style
  // --------------------------------------------------------------------------

  describe('weight and style', () => {
    it('sets weight to bold when bold=true', () => {
      const handle = resolver.resolve('Arial', true, false);
      expect(handle.weight).toBe('bold');
    });

    it('sets weight to normal when bold=false', () => {
      const handle = resolver.resolve('Arial', false, false);
      expect(handle.weight).toBe('normal');
    });

    it('sets style to italic when italic=true', () => {
      const handle = resolver.resolve('Arial', false, true);
      expect(handle.style).toBe('italic');
    });

    it('sets style to normal when italic=false', () => {
      const handle = resolver.resolve('Arial', false, false);
      expect(handle.style).toBe('normal');
    });

    it('handles bold+italic combination', () => {
      const handle = resolver.resolve('Times New Roman', true, true);
      expect(handle.family).toBe('times');
      expect(handle.weight).toBe('bold');
      expect(handle.style).toBe('italic');
    });
  });

  // --------------------------------------------------------------------------
  // Case Insensitivity
  // --------------------------------------------------------------------------

  describe('case insensitivity', () => {
    it('handles uppercase font names', () => {
      const handle = resolver.resolve('ARIAL', false, false);
      expect(handle.family).toBe('helvetica');
    });

    it('handles mixed case font names', () => {
      const handle = resolver.resolve('Times New Roman', false, false);
      expect(handle.family).toBe('times');
    });

    it('handles lowercase font names', () => {
      const handle = resolver.resolve('courier new', false, false);
      expect(handle.family).toBe('courier');
    });
  });

  // --------------------------------------------------------------------------
  // Caching
  // --------------------------------------------------------------------------

  describe('caching', () => {
    it('returns the same FontHandle for the same inputs', () => {
      const handle1 = resolver.resolve('Arial', true, false);
      const handle2 = resolver.resolve('Arial', true, false);
      expect(handle1).toBe(handle2); // Same reference
    });

    it('returns different FontHandle for different weights', () => {
      const normal = resolver.resolve('Arial', false, false);
      const bold = resolver.resolve('Arial', true, false);
      expect(normal).not.toBe(bold);
      expect(normal.weight).toBe('normal');
      expect(bold.weight).toBe('bold');
    });

    it('returns different FontHandle for different styles', () => {
      const normal = resolver.resolve('Arial', false, false);
      const italic = resolver.resolve('Arial', false, true);
      expect(normal).not.toBe(italic);
    });

    it('clearCache resets the cache', () => {
      const handle1 = resolver.resolve('Arial', false, false);
      resolver.clearCache();
      const handle2 = resolver.resolve('Arial', false, false);
      expect(handle1).not.toBe(handle2); // Different reference after clear
      expect(handle1).toEqual(handle2); // But same values
    });
  });

  // --------------------------------------------------------------------------
  // FontHandle ID format
  // --------------------------------------------------------------------------

  describe('FontHandle id', () => {
    it('generates correct id for normal weight and style', () => {
      const handle = resolver.resolve('Arial', false, false);
      expect(handle.id).toBe('helvetica-normal-normal');
    });

    it('generates correct id for bold', () => {
      const handle = resolver.resolve('Arial', true, false);
      expect(handle.id).toBe('helvetica-bold-normal');
    });

    it('generates correct id for italic', () => {
      const handle = resolver.resolve('Arial', false, true);
      expect(handle.id).toBe('helvetica-normal-italic');
    });

    it('generates correct id for bold+italic courier', () => {
      const handle = resolver.resolve('Consolas', true, true);
      expect(handle.id).toBe('courier-bold-italic');
    });
  });

  // --------------------------------------------------------------------------
  // Interface compliance
  // --------------------------------------------------------------------------

  describe('interface compliance', () => {
    it('implements FontResolver interface', () => {
      const fr: FontResolver = resolver;
      const handle = fr.resolve('Arial', false, false);
      expect(handle.id).toBeDefined();
      expect(handle.family).toBeDefined();
      expect(handle.weight).toBeDefined();
      expect(handle.style).toBeDefined();
    });
  });
});
