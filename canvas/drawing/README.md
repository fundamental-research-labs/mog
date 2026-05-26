# Drawing System

7 standalone TypeScript packages for 2D drawing, shapes, inking, diagrams, text effects, and visual rendering. Pure computation — no DOM, Canvas, React, or Yjs dependencies (except rendering output paths). Part of the [Spreadsheet OS](../docs/README.md) hardware layer.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CONSUMERS                                    │
│  file-io (OOXML import/export) │ kernel (bridges) │ shell (render) │
├─────────────────────────────────────────────────────────────────────┤
│                     DRAWING PACKAGES                                │
│                                                                     │
│  diagram ─────────┬──▶ drawing-engine ──▶ geometry                 │
│   (diagrams)       ├──▶ shape-engine ────▶ geometry                 │
│                    └──▶ geometry                                    │
│                                                                     │
│  text-effects-engine ──────▶ geometry                                    │
│   (text warp)                                                       │
│                                                                     │
│  ink-engine                                                         │
│   (strokes)         (no geometry dep — uses contracts directly)     │
│                                                                     │
│  lab ──▶ ALL packages (private visual test app)                     │
├─────────────────────────────────────────────────────────────────────┤
│                    spreadsheet-contracts                             │
│  (types only: Point2D, Path, DrawingObject, ShapeType, etc.)       │
└─────────────────────────────────────────────────────────────────────┘
```

## Packages

| Package | npm Name | Source Files | Tests | Purpose |
|---------|----------|:---:|:---:|---------|
| [geometry/](geometry/) | `@mog/geometry` | 12 | 10 | 2D geometry primitives: points, paths, transforms, matrices |
| [engine/](engine/) | `@mog/drawing-engine` | 26 | 20 | Composition engine: z-order, grouping, anchors, layout, rendering |
| [shapes/](shapes/) | `@mog/shape-engine` | 18 | 19 | Shape generation from 80+ OOXML presets |
| [ink/](ink/) | `@mog/ink-engine` | 8 | 8 | Ink/stroke drawing: smoothing, pressure, eraser, spatial index |
| [text-effects/](text-effects/) | `@mog/text-effects-engine` | 18 | 8 | Text-effects engine: 36+ OOXML text warp presets, 3D effects |
| [diagram/](diagram/) | `@mog/diagram-engine` | 64 | 41 | Diagram engine: 10 layout algorithms, OOXML parser, styles |
| [lab/](lab/) | `@mog/canvas-lab` | 31 | 0 | Private Vite app for visual testing (not published) |

**Totals:** 177 source files, 106 test files

## Dependency Graph

```
                  spreadsheet-contracts (types only)
                 /        |          |         \
           geometry    ink-engine    |          |
           /    \                    |          |
     shape-engine  drawing-engine   |          |
          \         /               |          |
           \       /           text-effects-engine  |
            \     /                            |
            diagram ──────────────────────────┘
                |
               lab (private — consumes all packages)
```

**Rules:**
- `contracts` is the only shared dependency (types, never implementation)
- `geometry` is the foundational math layer — depended on by engine, shapes, text-effects, diagram
- `ink-engine` is fully independent (only depends on contracts)
- `diagram` is the highest-level package (depends on engine + shapes + geometry)
- No circular dependencies. No peer dependencies.

## Quick Start

### Verification Commands

```bash
# From repo root — run all drawing tests
pnpm --filter '@mog/geometry' test
pnpm --filter '@mog/drawing-engine' test
pnpm --filter '@mog/shape-engine' test
pnpm --filter '@mog/ink-engine' test
pnpm --filter '@mog/text-effects-engine' test
pnpm --filter '@mog/diagram-engine' test

# Type checking
pnpm --filter '@mog/geometry' run check-types
pnpm --filter '@mog/drawing-engine' run check-types

# Visual testing (canvas-lab)
cd canvas/drawing/lab && pnpm dev
```

### Import Patterns

```typescript
// Geometry primitives
import { Matrix, Transform, PathOps } from '@mog/geometry';

// Drawing engine — composition
import { hitTest, resolveAnchor, bringToFront, createGroup } from '@mog/drawing-engine';

// Drawing engine — rendering
import { renderDrawingObjectToCanvas } from '@mog/drawing-engine';
import { renderDrawingObjectToSVG } from '@mog/drawing-engine';

// Shapes
import { generateShapePath, getPreset, createDrawingObject } from '@mog/shape-engine';

// Ink
import { createStroke, smoothStroke, strokeToDrawingObject } from '@mog/ink-engine';

// Text effects
import { warpText, getWarpPreset, warpToDrawingObjects } from '@mog/text-effects-engine';

// Diagrams
import { createDiagram, computeLayout, layoutToDrawingObjects } from '@mog/diagram-engine';
```

## Package Details

### geometry (`@mog/geometry`)

Pure 2D geometry math. Foundation for all other drawing packages.

**Public API (namespace exports):**

| Namespace | Key Functions | Purpose |
|-----------|--------------|---------|
| `Matrix` | `multiply`, `invert`, `transformPoint`, `decompose` | 3x3 affine matrix operations |
| `Transform` | `translate`, `rotate`, `scale`, `compose` | High-level transform builders |
| `PathOps` | `moveTo`, `lineTo`, `curveTo`, `close`, `bounds`, `length` | Path construction and measurement |
| `Diagnostics` | `validatePath`, `validateTransform` | Geometry validation |

**Also exports:** `BoundedCache` (LRU cache), all geometry types from contracts (`Point2D`, `Path`, `BoundingBox`, `AffineTransform`, etc.)

---

### engine (`@mog/drawing-engine`)

Composition engine for floating objects on a sheet. Manages how objects are ordered, grouped, positioned, and rendered — without knowing what kind of object they are.

**Public API by domain:**

| Domain | Key Functions | Purpose |
|--------|--------------|---------|
| **Z-Order** | `bringToFront`, `sendToBack`, `bringForward`, `sendBackward`, `sortByZOrder` | Layer ordering |
| **Grouping** | `createGroup`, `ungroup`, `getGroupMembers`, `validateGroupHierarchy` | Object groups |
| **Spatial** | `hitTest`, `findOverlapping`, `findNearby`, `selectInRect` | Spatial queries |
| **Selection** | `setSelection`, `addToSelection`, `getSelectionBounds` | Selection state |
| **Anchors** | `resolveAnchor`, `positionToAnchor`, `boundsToTwoCellAnchor`, `recomputeBoundsOnCellResize` | Cell-relative positioning |
| **Layout** | `snapToGrid`, `snapToObjects`, `alignObjects`, `distributeObjects` | Alignment & snapping |
| **Canvas** | `renderDrawingObjectToCanvas` | Canvas 2D rendering |
| **SVG** | `renderDrawingObjectToSVG` | SVG rendering |
| **Hit Test** | `isPointInDrawingObject`, `buildHitTestPath` | Narrow-phase hit testing |
| **Effects** | `renderOuterShadowToCanvas`, `glowToSVGFilter`, `bevelToSVGFilter` | Visual effects (shadow, glow, bevel) |
| **Diagnostics** | `validateZOrder`, `validateGroups`, `traceAnchorResolution` | Debug & validation |

**Subpath exports:** `@mog/drawing-engine/canvas`, `@mog/drawing-engine/svg`, `@mog/drawing-engine/hit-test`

---

### shapes (`@mog/shape-engine`)

Generates geometric paths from 80+ OOXML shape presets (arrows, callouts, flowcharts, stars, math, etc.). Also handles custom geometry from OOXML `<a:custGeom>`.

**Public API:**

| Domain | Key Functions | Purpose |
|--------|--------------|---------|
| **Core** | `generateShapePath`, `isValidShapeType`, `getRegisteredShapeTypes` | Shape path generation |
| **Presets** | `getPreset`, `getAllPresetNames`, `hasPreset`, `registerPreset` | Preset registry (80+ shapes) |
| **Custom Geometry** | `customGeometryToPath`, `parseCustomGeometry`, `resolveOoxmlPath` | OOXML custom geometry |
| **Text** | `computeTextInset` | Text-in-shape inset calculation |
| **Output** | `createDrawingObject` | Shape → DrawingObject conversion |
| **Diagnostics** | `validateShape`, `compareShapes`, `generateShapeReport` | Shape validation & diff |

**Preset categories:** `primitives`, `basic`, `arrows`, `callouts`, `flowchart`, `stars`, `math`

---

### ink (`@mog/ink-engine`)

Standalone inking engine for freehand drawing. Handles the full ink lifecycle from raw pointer input to rendered output.

**Public API:**

| Domain | Key Functions | Purpose |
|--------|--------------|---------|
| **Stroke** | `createStroke`, `smoothStroke`, `simplifyStroke`, `strokeToPath` | Stroke creation & processing |
| **Spatial Index** | `createSpatialIndex` | Fast spatial lookup of strokes |
| **Intersection** | `strokeIntersectsRect`, `strokesIntersect`, `pointNearStroke` | Collision detection |
| **Eraser** | `strokeErase`, `pointErase`, `eraseFromStroke` | Stroke/point eraser modes |
| **Pressure** | `applyPressureProfile`, `linearPressureToWidth`, `curvePressureToWidth` | Pressure-sensitive width |
| **Output** | `strokeToDrawingObject` | Stroke → DrawingObject conversion |
| **Diagnostics** | `validateStroke`, `validateSpatialIndex` | Validation |

---

### text-effects (`@mog/text-effects-engine`)

Implements all 36+ OOXML text warp presets (arc, wave, cascade, inflate, etc.) plus 3D transform effects and style presets.

**Public API:**

| Domain | Key Functions | Purpose |
|--------|--------------|---------|
| **Presets** | `getWarpPreset`, `getAllPresetNames`, `isValidPresetName` | 36+ warp presets |
| **Warp** | `warpText` | Text → warped glyphs |
| **Path Text** | `layoutTextOnPath` | Text along arbitrary path |
| **Handles** | `getAdjustHandle`, `updateAdjustment` | Interactive adjustment |
| **3D** | `compute3DTransform` | 3D rotation/perspective |
| **Styles** | `getStylePreset`, `STYLE_PRESETS` | Visual style presets |
| **Output** | `warpToDrawingObjects` | Warped text → DrawingObjects |
| **Diagnostics** | `Diagnostics.*` (namespace) | Validation & comparison |

**Preset categories:** `arc`, `cascade`, `fade`, `geometric`, `inflate`, `slant`, `wave`

---

### diagram (`@mog/diagram-engine`)

Full diagram engine — the most complex drawing package (64 source files, 41 tests). Includes diagram modeling, 10 OOXML layout algorithms, constraint solver, OOXML parsers, styles, and a gallery system.

**Public API by subsystem:**

| Subsystem | Key Functions | Purpose |
|-----------|--------------|---------|
| **Models** | `createDiagram`, `addNodeToDiagram`, `createNode`, `promoteNode`, `demoteNode` | Diagram CRUD |
| **Legacy Layouts** | `computeLayout`, `layoutRegistry` | Hardcoded layout algorithms |
| **Quick Styles** | `getQuickStyle`, `applyQuickStyleToShape` | 16 OOXML-compatible styles |
| **Color Themes** | `colorThemes`, `generateNodeColors`, `darkenColor`, `lightenColor` | 36+ color themes |
| **Effects** | `applyEffectsToCanvas`, `createShadow`, `createGlow`, `createBevel` | Visual effects |
| **Output** | `layoutToDrawingObjects` | ComputedLayout → DrawingObjects |
| **Gallery** | `getCatalog`, `searchLayouts`, `generateLayoutPreviewSVG` | Layout browser |
| **OOXML Engine** | `DataModel`, `solveConstraints`, `executeForEach`, `navigateAxis`, `applyRules` | Generic OOXML engine |
| **Algorithms** | `LinearAlgorithm`, `HierRootAlgorithm`, `CycleAlgorithm`, `SnakeAlgorithm`, + 6 more | 10 layout algorithms |
| **Parsers** | `parseDataModel`, `parseLayoutDefinition`, `parseStyleDef`, `parseColorsDef` | OOXML XML parsing |
| **Lifecycle** | `dispose()` | Free module-level caches |

**Subpath exports:** `@mog/diagram-engine/parser`, `@mog/diagram-engine/engine`

---

### lab (`@mog/canvas-lab`)

Private Vite application for visual testing. Not published. Renders interactive scenarios for all drawing packages on an HTML canvas.

```bash
cd canvas/drawing/lab && pnpm dev   # Start visual test server
```

**Scenario categories:** shapes (6), diagram (6), text-effects (3), ink (4), charts (6), marks (1)

## Design Patterns

### 1. Pure Computation

All packages (except lab) are pure computation — they take data in and return data out. No side effects, no DOM access, no global state. This enables:
- Headless testing (Jest, no jsdom needed for core logic)
- Server-side rendering
- Web Worker execution
- WASM compilation (future)

### 2. DrawingObject as Universal Output

Every package produces `DrawingObject` (from contracts) as its output format:

```
shape preset → generateShapePath() → createDrawingObject() → DrawingObject
ink stroke   → createStroke()      → strokeToDrawingObject() → DrawingObject
decorative text   → warpText()          → warpToDrawingObjects()  → DrawingObject[]
diagram     → computeLayout()     → layoutToDrawingObjects() → DrawingObject[]
```

The `drawing-engine` then handles composition (z-order, grouping, anchoring) and rendering (canvas/SVG) of `DrawingObject[]` without knowing what created them.

### 3. Diagnostics in Every Package

Every package exports a diagnostics API for headless debugging:
- `validate*()` functions return structured `DiagnosticIssue[]`
- `compare*()` functions diff two objects
- `generate*Report()` functions produce human-readable summaries

See [docs/DIAGNOSTICS.md](../docs/DIAGNOSTICS.md) for the framework.

### 4. OOXML Compatibility

Shape presets, warp presets, diagram layouts, and effects all follow OOXML (Office Open XML) specifications. This ensures OOXML file fidelity in import/export via `file-io`.

## Adding a New Drawing Package

1. Create directory under `canvas/drawing/<name>/`
2. Add `package.json` with name `@mog/<name>` (or `@mog/<name>-engine`)
3. Add `tsconfig.json` extending `../../tsconfig.base.json`
4. Add `jest.config.js` using `../../jest.paths.cjs` for module resolution
5. Depend only on `@mog/spreadsheet-contracts` and optionally `@mog/geometry`
6. Export a `DrawingObject` output function
7. Export a `Diagnostics` API
8. Workspace is auto-discovered via `pnpm-workspace.yaml` glob `canvas/drawing/*`

## Related Documentation

| Document | Purpose |
|----------|---------|
| [docs/README.md](../docs/README.md) | OS architecture overview |
| [docs/spreadsheet/ARCHITECTURE.md](../docs/spreadsheet/ARCHITECTURE.md) | Spreadsheet architecture (drawing is in hardware layer) |
| [docs/DIAGNOSTICS.md](../docs/DIAGNOSTICS.md) | Headless diagnostics framework |
| [docs/DEVELOPMENT-PHILOSOPHY.md](../docs/DEVELOPMENT-PHILOSOPHY.md) | AI-assisted parallel development |
