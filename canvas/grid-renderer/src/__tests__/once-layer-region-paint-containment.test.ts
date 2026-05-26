/**
 * Structural enforcement test for the `renderMode: 'once'` per-region clip
 * contract.
 *
 * Asserts the architectural invariant:
 *
 *   A `renderMode: 'once'` layer that paints content keyed to a
 *   `RenderRegion` (i.e. reads `region.cellRange` or per-row/per-col
 *   geometry) MUST route every paint through a per-region clip. The
 *   bounding box of every captured paint must be FULLY CONTAINED in
 *   either:
 *     (a) some region's per-region clip band the layer entered via
 *         `BaseLayer.withRegionBandClip`, OR
 *     (b) a chrome rect declared by the layer via `OnceLayerWithChrome
 *         .getChromeExemptions`.
 *
 * Mixed paints (a paint whose bbox straddles a band edge into a non-band,
 * non-chrome area) fail the test by design — every paint must be 100% in
 * one bucket. This makes the rule unambiguous.
 *
 * Path-based strokes (`beginPath` + `moveTo`/`lineTo` + `stroke`) are not
 * recorded — reconstructing path bounding boxes for arbitrary commands
 * (rect, arc, quadraticCurveTo, bezierCurveTo) is its own library, and
 * the bug class shipping today is `fillText`/`fillRect`-driven. The
 * recorder DOES capture the `ctx.rect(x,y,w,h)` + `ctx.stroke()` pattern
 * by tagging the next `stroke` with the most-recent `rect`'s bbox; this
 * guards against a future once-layer using rect-based per-region strokes.
 * If a future once-layer regresses via a path-based per-region paint
 * (e.g. moveTo/lineTo without rect), extend the recorder then.
 *
 * Directory ratchet: at the start of each test run, the file system is
 * scanned for every .ts file in `canvas/grid-renderer/src/layers/` that
 * declares `renderMode: 'once'`. The resulting set MUST equal the test's
 * explicit list (`OnceLayerImplementation`). A new once-layer file added
 * without being registered here will fail the ratchet — not just be a
 * `rg` smoke check.
 */

import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname shim — jest VM-modules / ESM runs without `__dirname`. Resolve
// the test file's directory from `import.meta.url`.
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

import type { FrameContext, RenderRegion } from '@mog/canvas-engine';
import type { GridRegionMeta } from '@mog-sdk/contracts/rendering';

import { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import {
  NULL_GROUPING_DATA_SOURCE,
  NULL_SELECTION_DATA_SOURCE,
  NULL_SHEET_DATA_SOURCE,
} from '../data/defaults';
import type { OnceLayerWithChrome } from '../layers/base-layer';
import { DividersLayer } from '../layers/dividers';
import { HeadersLayer } from '../layers/headers';

// =============================================================================
// Recording mock CanvasRenderingContext2D
// =============================================================================

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type PaintOp =
  | {
      readonly kind: 'fillText';
      readonly text: string;
      readonly bbox: Rect;
      readonly clips: ReadonlyArray<Rect>;
    }
  | { readonly kind: 'fillRect'; readonly bbox: Rect; readonly clips: ReadonlyArray<Rect> }
  | { readonly kind: 'strokeRect'; readonly bbox: Rect; readonly clips: ReadonlyArray<Rect> }
  | { readonly kind: 'rectStroke'; readonly bbox: Rect; readonly clips: ReadonlyArray<Rect> };

function createRecordingContext(): { ctx: CanvasRenderingContext2D; ops: ReadonlyArray<PaintOp> } {
  const ops: PaintOp[] = [];
  // Each frame in the stack carries any pending rect (for clip / stroke
  // tagging) and the clips activated within the frame. Restore pops the
  // frame and its clips.
  const stack: Array<{ pendingRect: Rect | null; clips: Rect[] }> = [
    { pendingRect: null, clips: [] },
  ];

  const top = (): { pendingRect: Rect | null; clips: Rect[] } => stack[stack.length - 1];

  function activeClips(): ReadonlyArray<Rect> {
    const out: Rect[] = [];
    for (const f of stack) for (const c of f.clips) out.push(c);
    return out;
  }

  // textMetrics-ish bbox for fillText. We don't need exact metric width;
  // the helper records a small box centered on (x,y) consistent with
  // ctx.textBaseline='middle' / textAlign='center' that the headers
  // layer uses. The structural assertion only cares that the bbox is
  // contained — a small box keeps containment robust to font metrics.
  function fillTextBBox(text: string, x: number, y: number): Rect {
    const halfW = Math.max(2, text.length * 4);
    const halfH = 6;
    return { x: x - halfW, y: y - halfH, width: halfW * 2, height: halfH * 2 };
  }

  const ctx = {
    save: jest.fn(() => {
      stack.push({ pendingRect: null, clips: [] });
    }),
    restore: jest.fn(() => {
      if (stack.length > 1) stack.pop();
    }),
    beginPath: jest.fn(() => {
      // beginPath clears the current sub-paths but for our mock we only
      // track the most-recent rect; a beginPath followed by rect() will
      // overwrite pendingRect. Leave pendingRect alone here.
    }),
    closePath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    arc: jest.fn(),
    rect: jest.fn((x: number, y: number, width: number, height: number) => {
      top().pendingRect = { x, y, width, height };
    }),
    fill: jest.fn(),
    stroke: jest.fn(() => {
      // Tag the most-recent rect (if any) as a rect+stroke paint.
      const r = top().pendingRect;
      if (r) {
        ops.push({ kind: 'rectStroke', bbox: r, clips: activeClips() });
      }
    }),
    clip: jest.fn(() => {
      const f = top();
      if (f.pendingRect) {
        f.clips.push(f.pendingRect);
        f.pendingRect = null;
      }
    }),
    clearRect: jest.fn(),
    fillRect: jest.fn((x: number, y: number, w: number, h: number) => {
      ops.push({
        kind: 'fillRect',
        bbox: { x, y, width: w, height: h },
        clips: activeClips(),
      });
    }),
    strokeRect: jest.fn((x: number, y: number, w: number, h: number) => {
      ops.push({
        kind: 'strokeRect',
        bbox: { x, y, width: w, height: h },
        clips: activeClips(),
      });
    }),
    fillText: jest.fn((text: string, x: number, y: number) => {
      ops.push({
        kind: 'fillText',
        text,
        bbox: fillTextBBox(text, x, y),
        clips: activeClips(),
      });
    }),
    strokeText: jest.fn(),
    measureText: jest.fn().mockReturnValue({
      width: 6,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 10,
      fontBoundingBoxDescent: 3,
    }),
    setLineDash: jest.fn(),
    getLineDash: jest.fn().mockReturnValue([]),
    translate: jest.fn(),
    scale: jest.fn(),
    rotate: jest.fn(),
    transform: jest.fn(),
    setTransform: jest.fn(),
    resetTransform: jest.fn(),
    quadraticCurveTo: jest.fn(),
    bezierCurveTo: jest.fn(),
    arcTo: jest.fn(),
    ellipse: jest.fn(),
    drawImage: jest.fn(),
    createLinearGradient: jest.fn().mockReturnValue({ addColorStop: jest.fn() }),
    createRadialGradient: jest.fn().mockReturnValue({ addColorStop: jest.fn() }),
    roundRect: jest.fn((x: number, y: number, w: number, h: number) => {
      // Track as a rect for chrome (level / collapse buttons paint via
      // roundRect → fill / stroke). Treated identically to rect().
      top().pendingRect = { x, y, width: w, height: h };
    }),
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    canvas: { width: 1000, height: 600 } as HTMLCanvasElement,
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

// =============================================================================
// Layout fixtures
// =============================================================================

const ROW_HEIGHT = 20;
const COL_WIDTH = 100;
const NUM_ROWS = 50;
const NUM_COLS = 26;
const HEADER_X = 50; // ROW_HEADER_WIDTH
const HEADER_Y = 24; // COL_HEADER_HEIGHT
const CANVAS_W = 1000;
const CANVAS_H = 600;
const SHEET_ID = 'sheet1';

function buildPositionIndex(): ViewportPositionIndex {
  const pi = new ViewportPositionIndex(ROW_HEIGHT, COL_WIDTH);
  const rowPositions = new Float64Array(NUM_ROWS);
  for (let i = 0; i < NUM_ROWS; i++) rowPositions[i] = i * ROW_HEIGHT;
  const colPositions = new Float64Array(NUM_COLS);
  for (let i = 0; i < NUM_COLS; i++) colPositions[i] = i * COL_WIDTH;
  pi.setPositions(rowPositions, colPositions, 0, 0);
  pi.setTotalDimensions(NUM_ROWS, NUM_COLS);
  return pi;
}

interface FreezeFixture {
  readonly name: string;
  readonly regions: ReadonlyArray<RenderRegion<GridRegionMeta>>;
}

function freezeTopRow(scrollY: number): FreezeFixture {
  return {
    name: `freeze-top-row scrollY=${scrollY}`,
    regions: [
      {
        id: 'frozen-rows:sheet1',
        bounds: { x: HEADER_X, y: HEADER_Y, width: CANVAS_W - HEADER_X, height: ROW_HEIGHT },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1,
        metadata: {
          sheetId: SHEET_ID,
          cellRange: { startRow: 0, startCol: 0, endRow: 0, endCol: NUM_COLS - 1 },
          isFrozen: true,
          scrollBehavior: 'row-anchored',
          viewportId: 'frozen-rows',
        },
      },
      {
        id: 'main:sheet1',
        bounds: {
          x: HEADER_X,
          y: HEADER_Y + ROW_HEIGHT,
          width: CANVAS_W - HEADER_X,
          height: CANVAS_H - HEADER_Y - ROW_HEIGHT,
        },
        viewportOrigin: { x: 0, y: ROW_HEIGHT },
        scrollOffset: { x: 0, y: scrollY },
        zoom: 1,
        metadata: {
          sheetId: SHEET_ID,
          cellRange: { startRow: 1, startCol: 0, endRow: NUM_ROWS - 1, endCol: NUM_COLS - 1 },
          isFrozen: false,
          scrollBehavior: 'free',
          viewportId: 'main',
        },
      },
    ],
  };
}

function freezeFirstColumn(scrollX: number): FreezeFixture {
  return {
    name: `freeze-first-column scrollX=${scrollX}`,
    regions: [
      {
        id: 'frozen-cols:sheet1',
        bounds: { x: HEADER_X, y: HEADER_Y, width: COL_WIDTH, height: CANVAS_H - HEADER_Y },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1,
        metadata: {
          sheetId: SHEET_ID,
          cellRange: { startRow: 0, startCol: 0, endRow: NUM_ROWS - 1, endCol: 0 },
          isFrozen: true,
          scrollBehavior: 'col-anchored',
          viewportId: 'frozen-cols',
        },
      },
      {
        id: 'main:sheet1',
        bounds: {
          x: HEADER_X + COL_WIDTH,
          y: HEADER_Y,
          width: CANVAS_W - HEADER_X - COL_WIDTH,
          height: CANVAS_H - HEADER_Y,
        },
        viewportOrigin: { x: COL_WIDTH, y: 0 },
        scrollOffset: { x: scrollX, y: 0 },
        zoom: 1,
        metadata: {
          sheetId: SHEET_ID,
          cellRange: { startRow: 0, startCol: 1, endRow: NUM_ROWS - 1, endCol: NUM_COLS - 1 },
          isFrozen: false,
          scrollBehavior: 'free',
          viewportId: 'main',
        },
      },
    ],
  };
}

function freezePanes(scrollX: number, scrollY: number): FreezeFixture {
  return {
    name: `freeze-panes scrollX=${scrollX} scrollY=${scrollY}`,
    regions: [
      {
        id: 'frozen-corner:sheet1',
        bounds: { x: HEADER_X, y: HEADER_Y, width: COL_WIDTH, height: ROW_HEIGHT },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        zoom: 1,
        metadata: {
          sheetId: SHEET_ID,
          cellRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
          isFrozen: true,
          scrollBehavior: 'none',
          viewportId: 'frozen-corner',
        },
      },
      {
        id: 'frozen-rows:sheet1',
        bounds: {
          x: HEADER_X + COL_WIDTH,
          y: HEADER_Y,
          width: CANVAS_W - HEADER_X - COL_WIDTH,
          height: ROW_HEIGHT,
        },
        viewportOrigin: { x: COL_WIDTH, y: 0 },
        scrollOffset: { x: scrollX, y: 0 },
        zoom: 1,
        metadata: {
          sheetId: SHEET_ID,
          cellRange: { startRow: 0, startCol: 1, endRow: 0, endCol: NUM_COLS - 1 },
          isFrozen: true,
          scrollBehavior: 'row-anchored',
          viewportId: 'frozen-rows',
        },
      },
      {
        id: 'frozen-cols:sheet1',
        bounds: {
          x: HEADER_X,
          y: HEADER_Y + ROW_HEIGHT,
          width: COL_WIDTH,
          height: CANVAS_H - HEADER_Y - ROW_HEIGHT,
        },
        viewportOrigin: { x: 0, y: ROW_HEIGHT },
        scrollOffset: { x: 0, y: scrollY },
        zoom: 1,
        metadata: {
          sheetId: SHEET_ID,
          cellRange: { startRow: 1, startCol: 0, endRow: NUM_ROWS - 1, endCol: 0 },
          isFrozen: true,
          scrollBehavior: 'col-anchored',
          viewportId: 'frozen-cols',
        },
      },
      {
        id: 'main:sheet1',
        bounds: {
          x: HEADER_X + COL_WIDTH,
          y: HEADER_Y + ROW_HEIGHT,
          width: CANVAS_W - HEADER_X - COL_WIDTH,
          height: CANVAS_H - HEADER_Y - ROW_HEIGHT,
        },
        viewportOrigin: { x: COL_WIDTH, y: ROW_HEIGHT },
        scrollOffset: { x: scrollX, y: scrollY },
        zoom: 1,
        metadata: {
          sheetId: SHEET_ID,
          cellRange: { startRow: 1, startCol: 1, endRow: NUM_ROWS - 1, endCol: NUM_COLS - 1 },
          isFrozen: false,
          scrollBehavior: 'free',
          viewportId: 'main',
        },
      },
    ],
  };
}

const FIXTURES: ReadonlyArray<FreezeFixture> = [
  freezeTopRow(14),
  freezeFirstColumn(70),
  freezePanes(70, 14),
];

// =============================================================================
// Layer fixtures
// =============================================================================

const SHEET_WITH_HEADERS = {
  ...NULL_SHEET_DATA_SOURCE,
  sheetId: SHEET_ID,
  showRowHeaders: true,
  showColumnHeaders: true,
};

interface OnceLayerImplementation {
  readonly file: string; // basename, e.g. 'headers.ts'
  readonly construct: () => BaseLayerLike;
}

interface BaseLayerLike extends OnceLayerWithChrome {
  setRegions(regions: ReadonlyArray<RenderRegion<GridRegionMeta>>): void;
  render(ctx: CanvasRenderingContext2D, region: RenderRegion, frame: FrameContext): void;
}

const ONCE_LAYERS: ReadonlyArray<OnceLayerImplementation> = [
  {
    file: 'headers.ts',
    construct: () =>
      new HeadersLayer(
        SHEET_WITH_HEADERS as any,
        buildPositionIndex(),
        NULL_SELECTION_DATA_SOURCE,
        NULL_GROUPING_DATA_SOURCE,
      ) as unknown as BaseLayerLike,
  },
  {
    file: 'dividers.ts',
    construct: () => new DividersLayer() as unknown as BaseLayerLike,
  },
];

function makeFrame(): FrameContext {
  return {
    timestamp: 16.67,
    canvasSize: { width: CANVAS_W, height: CANVAS_H },
    dpr: 1,
    frameNumber: 1,
  };
}

// =============================================================================
// Containment helpers
// =============================================================================

function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

function regionBands(fixture: FreezeFixture, layerFile: string): ReadonlyArray<Rect> {
  // For headers.ts each region contributes up to four bands: the row-
  // header band, the col-header band, the row-outline-gutter band, and
  // the col-outline-gutter band. With grouping disabled (NULL grouping),
  // only the first two are non-degenerate; with grouping the others
  // light up. We declare all four shapes here so the test is robust to
  // future fixtures that flip grouping on.
  const bands: Rect[] = [];
  for (const reg of fixture.regions) {
    if (layerFile === 'headers.ts') {
      // Row-header per-region band
      bands.push({ x: 0, y: reg.bounds.y, width: HEADER_X, height: reg.bounds.height });
      // Col-header per-region band
      bands.push({ x: reg.bounds.x, y: 0, width: reg.bounds.width, height: HEADER_Y });
    }
    if (layerFile === 'dividers.ts') {
      // Dividers paints chrome only; no region-keyed paint. No bands.
    }
  }
  return bands;
}

// =============================================================================
// Tests
// =============================================================================

describe('once-layer per-region paint containment', () => {
  it('directory ratchet: every once-layer file is registered in ONCE_LAYERS', () => {
    const layersDir = path.resolve(TEST_DIR, '..', 'layers');
    const files = fs
      .readdirSync(layersDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
    const onceLayerFiles = new Set<string>();
    for (const file of files) {
      const contents = fs.readFileSync(path.join(layersDir, file), 'utf8');
      // Match `renderMode: 'once'` inside a `super({ … })` call — i.e. a
      // concrete layer's BaseLayer config. This is the exact shape every
      // concrete once-layer uses today (see headers.ts and dividers.ts).
      // base-layer.ts matches the bare `renderMode: 'once'` token in a
      // JSDoc example, so the broader regex would mis-flag it. If a
      // future layer construction changes the syntax (template literal,
      // const alias, factory wrapping super), this regex will miss it —
      // that's the intended failure mode. The author of the new layer
      // must update this regex AND register their layer below.
      if (/super\s*\(\s*\{[^}]*renderMode:\s*['"]once['"]/s.test(contents)) {
        onceLayerFiles.add(file);
      }
    }
    const registered = new Set(ONCE_LAYERS.map((l) => l.file));
    // Symmetric difference must be empty.
    const missing: string[] = [];
    for (const f of onceLayerFiles) if (!registered.has(f)) missing.push(f);
    const extra: string[] = [];
    for (const f of registered) if (!onceLayerFiles.has(f)) extra.push(f);
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  for (const layer of ONCE_LAYERS) {
    describe(`layer: ${layer.file}`, () => {
      for (const fx of FIXTURES) {
        it(`every paint is contained in either a region band or a chrome rect (${fx.name})`, () => {
          const instance = layer.construct();
          instance.setRegions(fx.regions);

          const { ctx, ops } = createRecordingContext();
          instance.render(ctx, undefined as any, makeFrame());

          const chromeRects = instance.getChromeExemptions({
            layout: { regions: fx.regions.map((r) => ({ bounds: r.bounds })) },
            canvasWidth: CANVAS_W,
            canvasHeight: CANVAS_H,
            dpr: 1,
          });
          const bands = regionBands(fx, layer.file);

          // For each captured paint, compute its bbox and verify it is
          // FULLY CONTAINED in at least one of (a) a region band or (b)
          // a chrome rect. Visible paints only — paints that are clipped
          // out by an active clip that excludes the bbox are filtered.
          //
          // A paint is visible iff every active clip contains its bbox.
          // (CanvasRenderingContext2D semantics: every clip in the stack
          // intersects.) If no active clips, the paint is visible
          // canvas-wide.
          const violations: Array<{ op: PaintOp; reason: string }> = [];
          for (const op of ops) {
            const visible =
              op.clips.length === 0 || op.clips.every((c) => rectContains(c, op.bbox));
            if (!visible) continue; // Clipped out — invisible to the user.

            // Containment check.
            const inBand = bands.some((b) => rectContains(b, op.bbox));
            const inChrome = chromeRects.some((c) => rectContains(c, op.bbox));
            if (!inBand && !inChrome) {
              violations.push({
                op,
                reason: `bbox ${JSON.stringify(op.bbox)} not contained in any region band or chrome rect`,
              });
            }
          }

          expect(violations).toEqual([]);
        });
      }
    });
  }

  // ===========================================================================
  // Walk-through: the three containment criteria for per-region paints
  // ===========================================================================
  //
  // Walked through here on the same `freeze-top-row scrollY=14 rowHeight=20`
  // layout the narrow test uses. If any criterion cannot be proved, the narrow
  // test stays alive.
  //
  //   (i)   Every fillText call from HeadersLayer.render has a bbox whose
  //         y lies in some region band.
  //   (ii)  bleedIntoFrozenPx — the narrow scenario's metric: main-pane
  //         label bbox intersection with the frozen-rows band, when that
  //         is not the label's home band — is 0.
  //   (iii) Both row-axis and column-axis are covered.
  //
  // (i) and (iii) are subsumed by the per-fixture loop above (which runs
  // freeze-top-row, freeze-first-column, AND freeze-panes — both axes).
  // (ii) is a stronger version of (i) for the specific layout the narrow
  // test exercises; we re-verify it here directly.

  it('PR3 acceptance (ii): no main-pane fillText bbox overlaps the frozen-rows band on freeze-top-row scrollY=14', () => {
    const fx = freezeTopRow(14);
    const headers = new HeadersLayer(
      SHEET_WITH_HEADERS as any,
      buildPositionIndex(),
      NULL_SELECTION_DATA_SOURCE,
      NULL_GROUPING_DATA_SOURCE,
    );
    headers.setRegions(fx.regions);

    const { ctx, ops } = createRecordingContext();
    headers.render(ctx, undefined as any, makeFrame());

    const frozenRowsBand: Rect = {
      x: 0,
      y: HEADER_Y,
      width: HEADER_X,
      height: ROW_HEIGHT,
    };

    function rectsOverlap(a: Rect, b: Rect): boolean {
      return !(
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y
      );
    }

    // Row labels: '1' is the frozen-rows pane's home band; '2' onwards
    // belong to main. A fillText bbox overlapping `frozenRowsBand` is a
    // bleed iff the label is not '1'. After PR2's clip migration, those
    // paints are still issued but the clip excludes them from
    // visibility — assertion mirrors the visibility check in the
    // per-fixture loop above.
    const visibleBleeds = ops.filter((op) => {
      if (op.kind !== 'fillText') return false;
      if (!/^\d+$/.test(op.text) || op.text === '1') return false;
      const visible = op.clips.length === 0 || op.clips.every((c) => rectContains(c, op.bbox));
      if (!visible) return false;
      return rectsOverlap(op.bbox, frozenRowsBand);
    });

    expect(visibleBleeds).toEqual([]);
  });
});
