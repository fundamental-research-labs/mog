# Domain — Kernel Orchestration Layer

Thin delegation layer between the kernel's public API and Rust compute-core.
Every module follows the same pattern: pure functions taking `DocumentContext`,
delegating all real work to `ComputeBridge`.

```
  api/            bridges/          impl/
    |                |                |
    v                v                v
  ┌──────────────────────────────────────┐
  │            domain/                   │
  │                                      │
  │   Pure functions (DocumentContext)    │
  │   Reads:  await ctx.computeBridge.X()│
  │   Writes: void  ctx.computeBridge.X()│
  │   Events: MutationResultHandler      │
  │   State:  none — all via CB          │
  └──────────────┬───────────────────────┘
                 │ IPC
                 v
           Rust compute-core
```

## Modules

| Module            | Purpose                                          |
|-------------------|--------------------------------------------------|
| `cells/`          | Cell reads, writes, identity, iteration, hyperlinks, import |
| `tables/`         | Table CRUD, range resolution, hit-testing, auto-expansion, calculated columns |
| `sheets/`         | Sheet structure, dimensions, metadata             |
| `formulas/`       | Named ranges, structured ref updating             |
| `grouping/`       | Row/column grouping, expand/collapse, outline levels, subtotals |
| `slicers/`        | Slicer CRUD, cache, selection, timeline, table-binding |
| `sorting/`        | Filters, sorting                                  |
| `formatting/`     | Merges                                            |
| `schemas/`        | Column schema validation                          |
| `sparklines/`     | Sparkline metadata                                |
| `comments/`       | Cell comments                                     |
| `form-controls/`  | Form control manager                              |
| `workbook/`       | Global settings, scenarios, goal-seek             |

### Standalone files

| File                  | Purpose                                      |
|-----------------------|----------------------------------------------|
| `bindings.ts`         | Data binding definitions and operations       |
| `charts.ts`           | Chart CRUD (single large file)                |
| `grid-index.ts`       | Grid spatial index queries                    |
| `projection.ts`       | Row/column coordinate projection              |
| `row-col-identity.ts` | Row/column identity mapping                   |
| `undo.ts`             | Undo/redo delegation to compute-core          |

## Pattern

Every function in this directory follows the same shape:

```typescript
// Reads — async, awaits CB result
export async function getTable(ctx: DocumentContext, tableId: string) {
  return await ctx.computeBridge.getTable(tableId);
}

// Writes — fire-and-forget, Rust handles events via MutationResultHandler
export function insertRows(ctx: DocumentContext, sheetId: string, ...) {
  void ctx.computeBridge.structureChange(sheetId, { InsertRows: { ... } });
}
```

No state. No business logic. No manual event emission.

## Consumers

- **`api/`** — re-exports domain functions as the public kernel API
- **Bridges** — chart-bridge, pivot-bridge, slicer-bridge, schema-bridge
- **Impl files** — workbook-impl, worksheet-impl
