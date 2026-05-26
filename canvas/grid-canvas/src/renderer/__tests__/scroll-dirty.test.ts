/**
 * Scroll Dirty Tests
 *
 * Verifies that setScroll() only marks scroll-dependent layers dirty,
 * NOT static chrome layers (dividers, overlay).
 *
 * Since GridRendererImpl requires a DOM container, we test the dirty-marking
 * logic by calling private methods on a minimal mock that mirrors the relevant
 * internal structure of GridRendererImpl.
 *
 * @module grid-canvas/renderer/__tests__/scroll-dirty
 */

import { GridRendererImpl } from '../grid-renderer';
import type { ViewportLayout } from '@mog-sdk/contracts/viewport';
import { jest } from '@jest/globals';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a fake GridRendererImpl-shaped object with just enough structure
 * to exercise markAllDirty() and markScrollDirty().
 */
function createFakeRenderer() {
  const markDirtyCalls: string[] = [];

  const gridLayerIds = [
    'background',
    'cells',
    'validationCircles',
    'pageBreaks',
    'selection',
    'traceArrows',
    'remoteCursors',
    'ui',
    'sticky-headers',
    'headers',
    'dividers',
  ];

  const fake = {
    engine: {
      markDirty: jest.fn((id: string) => {
        markDirtyCalls.push(id);
      }),
      setLayout: jest.fn(),
    },
    gridLayers: {
      layers: gridLayerIds.map((id) => ({ id })),
      headers: { setRegions: jest.fn() },
      dividers: { setRegions: jest.fn() },
    },
    drawing: {
      layer: { id: 'drawing' },
    },
    overlay: { id: 'overlay' },
    coords: {
      getViewport: () => ({ scrollTop: 0, scrollLeft: 0 }),
      setViewport: jest.fn(),
      setFrozenPanes: jest.fn(),
    },
    currentSheetId: 'sheet-1',
    viewportLayout: null,
  };

  // Attach prototype methods to the fake so internal this-calls resolve
  const proto = GridRendererImpl.prototype as any;
  (fake as any).markAllDirty = proto.markAllDirty.bind(fake);
  (fake as any).markScrollDirty = proto.markScrollDirty.bind(fake);
  (fake as any).setScroll = proto.setScroll.bind(fake);
  (fake as any).setViewportLayout = proto.setViewportLayout.bind(fake);

  return {
    fake,
    markDirtyCalls,
    markAllDirty: (fake as any).markAllDirty as () => void,
    markScrollDirty: (fake as any).markScrollDirty as () => void,
    setScroll: (fake as any).setScroll as (scrollTop: number, scrollLeft: number) => void,
    setViewportLayout: (fake as any).setViewportLayout as GridRendererImpl['setViewportLayout'],
  };
}

function makeLayout(scrollOffset = { x: 0, y: 0 }): ViewportLayout {
  return {
    viewports: [
      {
        id: 'main',
        bounds: { x: 0, y: 0, width: 640, height: 360 },
        cellRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 10 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset,
        scrollBehavior: { type: 'free' },
        zoom: 1,
      },
    ],
    primaryViewportId: 'main',
    dividers: [],
    contentSize: { width: 2000, height: 2000 },
    maxScroll: { x: 1360, y: 1640 },
    headerInfo: {
      frozenRows: 0,
      frozenCols: 0,
      frozenRowsHeight: 0,
      frozenColsWidth: 0,
      scrollPosition: scrollOffset,
      zoom: 1,
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('markScrollDirty', () => {
  it('does NOT mark dividers layer dirty', () => {
    const { markDirtyCalls, markScrollDirty } = createFakeRenderer();
    markScrollDirty();
    expect(markDirtyCalls).not.toContain('dividers');
  });

  it('does NOT mark overlay layer dirty', () => {
    const { markDirtyCalls, markScrollDirty } = createFakeRenderer();
    markScrollDirty();
    expect(markDirtyCalls).not.toContain('overlay');
  });

  it('DOES mark cells layer dirty', () => {
    const { markDirtyCalls, markScrollDirty } = createFakeRenderer();
    markScrollDirty();
    expect(markDirtyCalls).toContain('cells');
  });

  it('DOES mark selection layer dirty', () => {
    const { markDirtyCalls, markScrollDirty } = createFakeRenderer();
    markScrollDirty();
    expect(markDirtyCalls).toContain('selection');
  });

  it('DOES mark background layer dirty', () => {
    const { markDirtyCalls, markScrollDirty } = createFakeRenderer();
    markScrollDirty();
    expect(markDirtyCalls).toContain('background');
  });

  it('DOES mark headers layer dirty', () => {
    const { markDirtyCalls, markScrollDirty } = createFakeRenderer();
    markScrollDirty();
    expect(markDirtyCalls).toContain('headers');
  });

  it('DOES mark drawing layer dirty', () => {
    const { markDirtyCalls, markScrollDirty } = createFakeRenderer();
    markScrollDirty();
    expect(markDirtyCalls).toContain('drawing');
  });

  it('marks fewer layers than markAllDirty', () => {
    const scrollRenderer = createFakeRenderer();
    scrollRenderer.markScrollDirty();
    const scrollCount = scrollRenderer.markDirtyCalls.length;

    const allRenderer = createFakeRenderer();
    allRenderer.markAllDirty();
    const allCount = allRenderer.markDirtyCalls.length;

    // markScrollDirty skips dividers and overlay = 2 fewer
    expect(scrollCount).toBe(allCount - 2);
  });
});

describe('setScroll', () => {
  it('calls markScrollDirty, not markAllDirty', () => {
    const { fake, markDirtyCalls, setScroll } = createFakeRenderer();
    setScroll(100, 50);
    // Should NOT contain dividers or overlay (markAllDirty would include them)
    expect(markDirtyCalls).not.toContain('dividers');
    expect(markDirtyCalls).not.toContain('overlay');
    // Should contain scroll-dependent layers
    expect(markDirtyCalls).toContain('cells');
    expect(markDirtyCalls).toContain('selection');
    expect(markDirtyCalls).toContain('background');
  });

  it('updates viewport coordinates', () => {
    const { fake, setScroll } = createFakeRenderer();
    setScroll(200, 150);
    expect(fake.coords.setViewport).toHaveBeenCalledWith(
      expect.objectContaining({ scrollTop: 200, scrollLeft: 150 }),
    );
  });
});

describe('setViewportLayout invalidation mode', () => {
  it('scroll layout update pushes region metadata without marking static layers dirty', () => {
    const { fake, markDirtyCalls, setViewportLayout } = createFakeRenderer();

    setViewportLayout(makeLayout({ x: 200, y: 0 }), { invalidation: 'scroll' });

    expect(fake.engine.setLayout).toHaveBeenCalledWith(
      expect.objectContaining({
        regions: [expect.objectContaining({ scrollOffset: { x: 200, y: 0 } })],
      }),
      { invalidation: 'scroll' },
    );
    expect(fake.gridLayers.headers.setRegions).toHaveBeenCalled();
    expect(fake.gridLayers.dividers.setRegions).toHaveBeenCalled();
    expect(markDirtyCalls).toContain('cells');
    expect(markDirtyCalls).not.toContain('dividers');
    expect(markDirtyCalls).not.toContain('overlay');
  });

  it('structural layout update keeps full dirty behavior', () => {
    const { fake, markDirtyCalls, setViewportLayout } = createFakeRenderer();

    setViewportLayout(makeLayout(), { invalidation: 'structural' });

    expect(fake.engine.setLayout).toHaveBeenCalledWith(expect.any(Object), {
      invalidation: 'structural',
    });
    expect(markDirtyCalls).toContain('dividers');
    expect(markDirtyCalls).toContain('overlay');
    expect(markDirtyCalls).toContain('cells');
  });
});

describe('markAllDirty (baseline)', () => {
  it('marks ALL layers including dividers and overlay', () => {
    const { markDirtyCalls, markAllDirty } = createFakeRenderer();
    markAllDirty();
    expect(markDirtyCalls).toContain('dividers');
    expect(markDirtyCalls).toContain('overlay');
    expect(markDirtyCalls).toContain('cells');
    expect(markDirtyCalls).toContain('drawing');
  });
});
