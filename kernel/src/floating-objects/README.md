# Floating Objects — Canvas Object Hosting Infrastructure

Universal, app-agnostic infrastructure for positioning, z-order, grouping, and CRUD of canvas objects. Owns **how** objects live on a canvas; **what** they are (charts, drawings, equations) lives in `domain/`.

```
                    SpreadsheetObjectManager
                    (composition facade)
                            |
            ┌───────────────┼───────────────┐
            v               v               v
   SpreadsheetObject   IObjectStore    core/grouping
      Mutator          (ComputeBridge-    (z-order,
   (IObjectMutator)     ObjectStore)     group/ungroup)
            |
            v
     ComputeBridge
     (Rust compute-core)

  Reads: IObjectBoundsReader → scene graph (sync)
  Writes: IObjectMutator → Rust compute-core (async)
```

## Directory Structure

```
floating-objects/
├── index.ts                        Barrel exports
├── spreadsheet-object-manager.ts   Spreadsheet facade (delegates to mutator + store + core)
├── spreadsheet-object-mutator.ts   IObjectMutator impl — writes via ComputeBridge
├── object-store.ts                 IObjectStore + IGroupStore backed by ComputeBridge
├── object-events.ts                Universal event emission layer
├── types.ts                        ObjectBounds, CanvasObjectContext, constants
│
├── core/                           Universal hosting operations
│   ├── mutations.ts                Create / update / delete
│   ├── z-order.ts                  Bring-to-front, send-to-back, reorder
│   ├── grouping.ts                 Group / ungroup objects
│   ├── positioning.ts              Move, resize, rotate (pixel math)
│   ├── selection.ts                Multi-select, lasso, deselect
│   ├── events.ts                   Emit object/group lifecycle events
│   └── clipboard.ts                Copy/paste object serialization
│
├── spreadsheet/                    Spreadsheet-specific hosting adapters
│   ├── cell-anchor-resolver.ts     IPositionResolver<ObjectPosition> — cell -> pixel
│   ├── clipboard-anchors.ts        Anchor adjustment for paste operations
│   ├── ole-object-manager.ts       Embed external OLE objects
│   ├── group-bounds.ts             Group bounding box in cell coordinates
│   └── selection-bounds.ts         Selection bounds in cell coordinates
│
└── managers/                       Trivial type-specific managers
    ├── textbox-manager.ts          TextBox creation / duplication
    └── picture-manager.ts          Picture creation / duplication / export
```

## Key Design Decisions

### Hosting vs Content

The central organizing principle. This module owns **hosting** — the mechanics of placing, moving, layering, and grouping objects on a canvas. Object **content** (chart data, shape geometry, equation typesetting) lives in `domain/`:

| Hosting (here)          | Content (domain/)          |
|-------------------------|----------------------------|
| Position, size, rotation| Chart marks, data binding  |
| Z-order, layering       | Shape preset geometry      |
| Group / ungroup         | Equation OMML/LaTeX parse  |
| Cell-anchor resolution  | Diagram item layout       |
| CRUD persistence        | Decorative text warp          |
| Selection, clipboard    | Ink stroke spatial index   |

### Dual-Path Architecture (Reads vs Writes)

Reads and writes take different paths:

- **Sync reads** go through `IObjectBoundsReader`, which queries the drawing-canvas scene graph directly. This is essential for hit-testing, selection rectangles, and rendering — all of which need synchronous pixel bounds.
- **Async writes** go through `IObjectMutator` (implemented by `SpreadsheetObjectMutator`), which delegates to Rust compute-core via `ComputeBridge`. This keeps Rust as the single source of truth for persistent object state.

### SpreadsheetObjectManager as Direct Delegator

`SpreadsheetObjectManager` delegates directly to `SpreadsheetObjectMutator` (writes), `ComputeBridgeObjectStore` (persistence), and `core/grouping` (group operations). There is no intermediate generic manager class — the facade composes the pieces it needs without an extra layer of indirection.

### ComputeBridge-backed Store

`ComputeBridgeObjectStore` implements `IObjectStore<FloatingObject>` by delegating to Rust/Yrs via `ComputeBridge`. The public API uses `containerId`; the internal mapping to `sheetId` is an implementation detail.

### Trivial Managers

`textbox-manager.ts` and `picture-manager.ts` have no independent domain logic — they are pure factory/utility functions for creating and duplicating objects with sensible defaults. They live in `managers/` to keep the root clean.

## Dependencies

Imports **from**: `context/` (event bus), `contracts/` (`IObjectStore`, `CanvasObject`, `FloatingObject` types), `bridges/` (ComputeBridge — store only).

Does **not** import from: `api/`, `domain/`, `services/`, `keyboard/`, `document/`.

## Consumers

- **`api/`** — Exposes object operations through the public kernel API
- **`domain/`** — Chart, drawing, equation, and diagram bridges use SpreadsheetObjectManager for CRUD
- **`services/clipboard/`** — Uses core clipboard serialization for object copy/paste
- **Apps** — `apps/spreadsheet/` reads object state via kernel API, renders via canvas layer
