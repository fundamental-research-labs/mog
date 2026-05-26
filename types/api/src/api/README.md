# API Types Layer

## Philosophy

Every type in `types.ts` must justify its existence by being one of:

### 1. A re-export of generated or core types

When the type from `core/core.ts` or a generated file (e.g., `compute-types.gen.ts`) is exactly what consumers need, contracts re-exports it as the stable import point. No hand-rewriting.

Examples: `CellAddress`, `CellFormat`, `CellRange`, `CellValue`, `SheetInfo`, `PrintSettings`.

### 2. A genuinely different shape (DTO / projection)

A creation DTO, read projection, or API simplification where the shape is *intentionally* different from the domain or wire type. The difference serves a real ergonomic purpose.

Examples:
- `SlicerConfig` -- 4 creation fields vs the 12+ persisted fields on `Slicer`.
- `TableInfo` -- A1 strings (`"A1:D10"`) instead of internal `CellId`-based ranges.
- `ChartConfig` -- creation shape with optional anchoring; `Chart extends ChartConfig` adds `id`, `sheetId`, timestamps.
- `RawCellData` -- enriched read projection (formula, borders, merge info) beyond the minimal `CellData`.

### What should never exist

A **hollow copy**: same shape as the generated type but with fewer fields, `Record<string, unknown>` instead of real types, or `string` instead of enums. That is not an abstraction -- it is information loss that forces `as any` casts downstream.

---

## Type Flow

```
Rust (compute-core)
  -> codegen (compute-types.gen.ts, compute-client.gen.ts)
    -> contracts (re-export OR canonical DTO definition)
      -> kernel (implements the API using these types)
        -> apps (consume via @mog/spreadsheet-contracts/api)
```

Contracts is the **stable boundary**. Kernel and apps never import generated files directly -- they go through contracts.

---

## When to Add a New Type

1. **Does the type already exist in generated code or `core/`?**
   - Yes, and the shape is correct -> Re-export it from `types.ts`. Done.
   - Yes, but consumers need a different shape -> Go to step 2.
   - No -> Go to step 2.

2. **Is the new type a creation DTO, read projection, or API simplification?**
   - Yes -> Define it in `types.ts` with a clear doc comment explaining *why* it differs from the domain type.
   - No -> It probably belongs in `core/`, `data/`, or the generated layer, not here.

3. **Does it duplicate an existing type with fewer fields?**
   - Yes -> Do not add it. Use the existing type and make fields optional if needed.

---

## Anti-Patterns

| Anti-pattern | Why it is wrong | Do this instead |
|---|---|---|
| `axis?: { xAxis?: Record<string, unknown> }` | Loses all type information; consumers guess at keys | Define a typed `AxisConfig` interface or re-export the generated one |
| `series?: Array<Record<string, unknown>>` | Same problem -- opaque bag of data | Type the series entries properly |
| `type: string` where an enum exists in Rust | Consumers cannot exhaustively match; typos are silent | Re-export or mirror the generated enum |
| Hollow copy with `Partial<GeneratedType>` | Creates a second source of truth that drifts | Re-export the generated type directly |
| Catch-all `[key: string]: unknown` on an interface | Defeats the purpose of having a type | Remove the index signature; add explicit optional fields |

---

## File Layout

- `types.ts` -- All shared types (re-exports at top, custom DTOs below).
- `errors.ts` -- Error classes for the unified API.
- `workbook.ts` / `worksheet.ts` -- Interface definitions for the Workbook/Worksheet APIs.
- `workbook/` / `worksheet/` -- Sub-API interfaces (charts, filters, tables, etc.).
- `index.ts` -- Barrel that re-exports everything. Import path: `@mog/spreadsheet-contracts/api`.
