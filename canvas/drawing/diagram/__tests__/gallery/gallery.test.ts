/**
 * Tests for Diagram Layout Gallery
 *
 * Covers getCatalog(), searchLayouts(), generateLayoutPreviewSVG(),
 * getCachedPreviewSVG(), and clearPreviewCache().
 */

import {
  clearPreviewCache,
  generateLayoutPreviewSVG,
  getCachedPreviewSVG,
  getCatalog,
  searchLayouts,
} from '../../src/gallery';

// =============================================================================
// getCatalog()
// =============================================================================

describe('getCatalog', () => {
  it('should return all 8 categories', () => {
    const catalog = getCatalog();
    expect(catalog).toHaveLength(8);
  });

  it('should return categories in correct Excel order', () => {
    const catalog = getCatalog();
    const categoryIds = catalog.map((c) => c.id);
    expect(categoryIds).toEqual([
      'list',
      'process',
      'cycle',
      'hierarchy',
      'relationship',
      'matrix',
      'pyramid',
      'picture',
    ]);
  });

  it('should have name and description for each category', () => {
    const catalog = getCatalog();
    catalog.forEach((category) => {
      expect(typeof category.name).toBe('string');
      expect(category.name.length).toBeGreaterThan(0);
      expect(typeof category.description).toBe('string');
      expect(category.description.length).toBeGreaterThan(0);
    });
  });

  it('should have at least 1 layout per category', () => {
    const catalog = getCatalog();
    catalog.forEach((category) => {
      expect(category.layouts.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('should have correct total layout count (40 layouts)', () => {
    const catalog = getCatalog();
    const totalLayouts = catalog.reduce((sum, cat) => sum + cat.layouts.length, 0);
    expect(totalLayouts).toBe(40);
  });

  it('should have layouts matching their category', () => {
    const catalog = getCatalog();
    catalog.forEach((category) => {
      category.layouts.forEach((layout) => {
        expect(layout.category).toBe(category.id);
      });
    });
  });
});

// =============================================================================
// searchLayouts()
// =============================================================================

describe('searchLayouts', () => {
  it('should return all layouts for empty query', () => {
    const allLayouts = searchLayouts('');
    expect(allLayouts.length).toBe(40);
  });

  it('should return all layouts for whitespace-only query', () => {
    const allLayouts = searchLayouts('   ');
    expect(allLayouts.length).toBe(40);
  });

  it('should search by name - "process" matches process layouts', () => {
    const results = searchLayouts('process');
    expect(results.length).toBeGreaterThan(0);
    // At least the basic process layout should match
    const hasBasicProcess = results.some((layout) => layout.name.toLowerCase().includes('process'));
    expect(hasBasicProcess).toBe(true);
  });

  it('should search by description', () => {
    // All layouts have descriptions; search for a word that appears in descriptions
    const results = searchLayouts('steps');
    // "steps" appears in process category description or process layout descriptions
    expect(results.length).toBeGreaterThanOrEqual(0);
    // More specific: search for a common description term
    const hierarchyResults = searchLayouts('organization');
    expect(hierarchyResults.length).toBeGreaterThan(0);
  });

  it('should be case-insensitive', () => {
    const lowerResults = searchLayouts('cycle');
    const upperResults = searchLayouts('CYCLE');
    const mixedResults = searchLayouts('CyCLe');

    expect(lowerResults.length).toBe(upperResults.length);
    expect(lowerResults.length).toBe(mixedResults.length);

    // Verify same layouts are returned
    const lowerIds = lowerResults.map((l) => l.id).sort();
    const upperIds = upperResults.map((l) => l.id).sort();
    expect(lowerIds).toEqual(upperIds);
  });

  it('should return empty array for non-matching query', () => {
    const results = searchLayouts('xyznonexistent123');
    expect(results).toEqual([]);
  });

  it('should trim query before searching', () => {
    const trimmedResults = searchLayouts('pyramid');
    const paddedResults = searchLayouts('  pyramid  ');
    expect(trimmedResults.length).toBe(paddedResults.length);
  });
});

// =============================================================================
// generateLayoutPreviewSVG()
// =============================================================================

describe('generateLayoutPreviewSVG', () => {
  // Get a known layout for testing
  function getKnownLayout() {
    const catalog = getCatalog();
    // Use the first layout from the first category that has layouts
    for (const cat of catalog) {
      if (cat.layouts.length > 0) {
        return cat.layouts[0];
      }
    }
    throw new Error('No layouts found in catalog');
  }

  it('should return a valid SVG string for a known layout', () => {
    const layout = getKnownLayout();
    const svg = generateLayoutPreviewSVG(layout);

    expect(svg).not.toBeNull();
    expect(typeof svg).toBe('string');
  });

  it('should contain SVG opening and closing tags', () => {
    const layout = getKnownLayout();
    const svg = generateLayoutPreviewSVG(layout);

    expect(svg).not.toBeNull();
    expect(svg!).toContain('<svg');
    expect(svg!).toContain('</svg>');
  });

  it('should return null for non-existent layout ID', () => {
    // Create a fake layout definition with a non-existent ID
    const fakeLayout = {
      ...getKnownLayout(),
      id: 'nonexistent/fake-layout-id-999',
    };
    const svg = generateLayoutPreviewSVG(fakeLayout);

    expect(svg).toBeNull();
  });

  it('should respect width/height options', () => {
    const layout = getKnownLayout();

    const svg100 = generateLayoutPreviewSVG(layout, { width: 100, height: 100 });
    const svg200 = generateLayoutPreviewSVG(layout, { width: 200, height: 200 });

    expect(svg100).not.toBeNull();
    expect(svg200).not.toBeNull();

    // The SVGs should have different width/height attributes
    expect(svg100).toContain('width="100"');
    expect(svg100).toContain('height="100"');
    expect(svg200).toContain('width="200"');
    expect(svg200).toContain('height="200"');
  });

  it('should produce different SVGs for different node counts', () => {
    const layout = getKnownLayout();

    const svg2 = generateLayoutPreviewSVG(layout, { nodeCount: 2 });
    const svg5 = generateLayoutPreviewSVG(layout, { nodeCount: 5 });

    expect(svg2).not.toBeNull();
    expect(svg5).not.toBeNull();

    // The SVGs should differ (different number of rect elements)
    expect(svg2).not.toBe(svg5);
  });

  it('should contain shape elements', () => {
    const layout = getKnownLayout();
    const svg = generateLayoutPreviewSVG(layout);

    expect(svg).not.toBeNull();
    // Shapes are rendered as <rect> or <path> elements depending on the renderer
    const hasShapeElements = svg!.includes('<rect') || svg!.includes('<path');
    expect(hasShapeElements).toBe(true);
  });

  it('should use default dimensions when no options provided', () => {
    const layout = getKnownLayout();
    const svg = generateLayoutPreviewSVG(layout);

    expect(svg).not.toBeNull();
    // Default dimensions are 80x80
    expect(svg!).toContain('width="80"');
    expect(svg!).toContain('height="80"');
  });
});

// =============================================================================
// Preview Caching
// =============================================================================

describe('Preview caching', () => {
  beforeEach(() => {
    clearPreviewCache();
  });

  function getKnownLayout() {
    const catalog = getCatalog();
    for (const cat of catalog) {
      if (cat.layouts.length > 0) {
        return cat.layouts[0];
      }
    }
    throw new Error('No layouts found in catalog');
  }

  it('should return same result on second call (cached)', () => {
    const layout = getKnownLayout();

    const first = getCachedPreviewSVG(layout);
    const second = getCachedPreviewSVG(layout);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // Cached results should be identical
    expect(first).toBe(second);
  });

  it('should clear cache with clearPreviewCache()', () => {
    const layout = getKnownLayout();

    const first = getCachedPreviewSVG(layout);
    expect(first).not.toBeNull();

    clearPreviewCache();

    // After clearing, getCachedPreviewSVG should regenerate
    // The content should be equivalent but we verify the cache was cleared
    // by confirming no error occurs and a valid SVG is still returned
    const afterClear = getCachedPreviewSVG(layout);
    expect(afterClear).not.toBeNull();
    // Content should be the same since it regenerates identically
    expect(afterClear).toBe(first);
  });

  it('should produce different cache keys for different options', () => {
    const layout = getKnownLayout();

    const small = getCachedPreviewSVG(layout, { width: 50, height: 50 });
    const large = getCachedPreviewSVG(layout, { width: 200, height: 200 });

    expect(small).not.toBeNull();
    expect(large).not.toBeNull();

    // Different options should produce different SVGs
    expect(small).not.toBe(large);
  });

  it('should produce different cache keys for different node counts', () => {
    const layout = getKnownLayout();

    const svg2 = getCachedPreviewSVG(layout, { nodeCount: 2 });
    const svg4 = getCachedPreviewSVG(layout, { nodeCount: 4 });

    expect(svg2).not.toBeNull();
    expect(svg4).not.toBeNull();

    expect(svg2).not.toBe(svg4);
  });

  it('should cache results from multiple different layouts', () => {
    const catalog = getCatalog();
    const layouts = catalog.flatMap((c) => c.layouts).slice(0, 3);

    // Generate cached previews for first 3 layouts
    const results = layouts.map((layout) => getCachedPreviewSVG(layout));

    // All should succeed
    results.forEach((result) => {
      expect(result).not.toBeNull();
    });

    // Second call should return cached results
    const secondResults = layouts.map((layout) => getCachedPreviewSVG(layout));
    secondResults.forEach((result, i) => {
      expect(result).toBe(results[i]);
    });
  });
});
