# Mog: A Spreadsheet Engine Built for Correctness

Mog is an open-source spreadsheet engine with a Rust compute core and TypeScript rendering layer. It runs the same engine on web (WASM), desktop (Tauri), and server (N-API), and ships as `@mog-sdk/node` for headless use.

This report covers what the engine does today, how we verify it, and where it falls short. No roadmap, no vision — just what exists and what we can prove.

---

## Formula Engine

The formula engine is the core of any spreadsheet. If the formulas are wrong, nothing else matters.

Mog implements **454 Excel-compatible functions** across 13 categories in Rust: math, statistical, financial, text, logical, lookup/reference, date/time, engineering, database, information, and more. The parser (built on [winnow](https://github.com/winnow-rs/winnow)) handles the full Excel formula grammar — nested functions, structured references, cross-sheet references, array literals, and LAMBDA expressions.

**How we verify correctness.** We test against real-world Excel files — financial models, reporting templates, analytical workbooks — not synthetic test cases. The engine opens each file, recalculates every formula from scratch, and compares results against Excel's cached values.

For numeric results, we track accuracy at ULP (Units in Last Place) granularity — the finest meaningful unit of floating-point comparison. Every mismatch is classified by root cause: wrong numeric result, wrong type, engine error, or cascade from an upstream failure. This separates real bugs from inherited errors.

**Numerical precision.** Numbers are stored as `FiniteF64` — a newtype over IEEE 754 `f64` that statically excludes NaN and infinity at the type level. Summation uses Kahan compensated accumulation to minimize floating-point drift in large ranges. Where our results diverge from Excel's, the cause is typically Excel's use of 80-bit x87 extended precision for intermediate calculations — a platform-specific behavior that cannot be replicated with strict IEEE 754 f64 arithmetic. These cases are individually documented with root cause analysis and explicit accept/reject decisions.

**What we don't support.** VBA macros, XLL add-in functions, and external data connections are inherently unknowable to any standalone engine. Array formulas and volatile functions (NOW, RAND) are evaluated but excluded from accuracy metrics since their cached values are non-deterministic.

---

## Performance

| Metric | Measured |
|--------|----------|
| Edit-to-render latency | 0.04 ms |
| Recalc 10,000 formulas | 7.8 ms |
| Memory, 500K cells | 221 MB |
| Render frame rate | 60 fps |

These numbers come from the engine running on commodity hardware (Apple M-series). Edit latency measures the time from `setCellValue` to the render buffer being complete — not to screen, but to the point where the canvas can paint.

**Why it's fast.** The rendering pipeline uses a binary wire protocol instead of JSON. Each cell occupies exactly 32 bytes in a dense, row-major buffer. TypeScript reads cells via `DataView` directly from the binary blob — zero object allocation, zero JSON parsing in the hot path. Display strings are packed in a contiguous UTF-8 pool referenced by offset and length. Cell formats are deduplicated into an append-only palette (typically 5–20 unique formats across thousands of cells), and each cell carries a 2-byte palette index rather than a full format object.

Mutations (cell edits, recalc results) produce binary patches in the same 32-byte-per-cell format. The rendering layer splices patches directly into the viewport buffer — no intermediate JavaScript objects, no GC pressure.

**XLSX import performance.** Parsing is handled by a Rust-native XLSX parser compiled to WASM. Large workbooks (millions of cells) open in under 16 seconds including full recalculation. Files under 1 MB parse in under 100ms.

---

## XLSX Compatibility

Round-trip fidelity — open an Excel file, modify it, save it, reopen in Excel — is the real compatibility test. Mog's pipeline:

```
.xlsx → Rust parser (WASM) → ParsedWorkbook → Yrs CRDT document → serialize → .xlsx
```

We verify round-trip fidelity by performing semantic diffs at the XML part level. Differences are classified by severity: cosmetic (attribute order, whitespace), semantic (value changes), and structural (missing parts).

**What round-trips correctly:** cell values, formulas, number formats, fonts, fills, borders, alignment, conditional formatting rules, table definitions, named ranges, sheet structure, merged cells, column widths, row heights, freeze panes.

**What doesn't yet:** some chart subtypes, pivot table cache records, VBA projects, external links, threaded comments (classic comments are supported).

---

## Cross-Platform Runtime

A single Rust crate (`compute-core`, 21 sub-crates) contains all computation logic. It is compiled to three targets from the same source:

| Target | Binding | Use Case |
|--------|---------|----------|
| `wasm32-unknown-unknown` | WASM | Browser — runs in a Web Worker |
| Native (via Tauri) | Tauri IPC | Desktop app |
| Native (via N-API) | `@mog-sdk/node` | Server, CLI, AI agents |

The bindings are generated by a custom proc-macro framework. Annotate a Rust `impl` block with `#[bridge::api]`, and the framework emits platform-specific glue for all three targets plus TypeScript type definitions. No hand-maintained bindings, no type drift between Rust and TypeScript.

The transport layer auto-detects the platform at startup and selects the appropriate backend. All callers — browser, desktop, server — use the same async API.

---

## SDK

`@mog-sdk/node` is the headless SDK, published with prebuilt native binaries for 7 platforms (macOS arm64/x64, Linux x64/arm64 glibc/musl, Windows x64).

```typescript
import { createWorkbook } from '@mog-sdk/node';

const wb = await createWorkbook('financial-model.xlsx');
const ws = wb.getActiveSheet();

await ws.setCell('B2', 150000);
const revenue = await ws.getValue('B10');   // recalculated

await wb.toXlsx('updated-model.xlsx');
wb.dispose();
```

The API surface includes 60+ sub-APIs across Workbook and Worksheet: formatting, structure (insert/delete rows/cols), charts, tables, filters, conditional formatting, comments, named ranges, and more. Operations are async (Rust compute happens in a native thread) and errors throw directly.

For LLM integration, `describe()` and `summarize()` return structured, natural-language descriptions of sheet contents — designed for AI agents that need to understand a workbook without reading every cell.

---

## Collaboration

Persistent state lives in a [Yrs](https://github.com/y-crdt/y-crdt) CRDT document (the Rust port of Yjs). The key design decision that makes collaboration correct is the **Cell Identity Model**: cells are keyed by stable UUIDs, not by position. When two users simultaneously insert columns, the position updates compose correctly under CRDT because formulas reference cell IDs, not A1 strings. No formula rewriting is needed on structural changes.

We test collaboration with **216 scenarios** across 6 categories (convergence, edge cases, formula sync, locking, network partitions, structural operations). Current pass rate: **100%**.

---

## Testing

| Suite | Scenarios | Pass Rate |
|-------|-----------|-----------|
| Collaboration | 216 | 100% |
| API correctness | 572 | 99.3% |
| UI end-to-end | 451 | 100% |
| Rust unit tests | 12,264 | — |

The API suite exercises the full `Workbook`/`Worksheet` API surface — cells, formatting, charts, tables, filters, batch operations, export, and edge cases. The UI suite drives a real browser instance through editing, formatting, keyboard navigation, multi-sheet operations, scrolling, selection, and stress tests.

---

## Known Limitations

We'd rather you know these upfront than discover them in production.

- **VBA/macros**: Not supported. Files with VBA open fine but macros don't execute.
- **Some chart types**: Basic chart types (bar, line, area, pie, scatter) are supported. Treemap, sunburst, waterfall, and some combo variants are in progress.
- **Pivot table caching**: Pivot tables render from source data but don't round-trip the pivot cache XML, which may cause Excel to prompt for refresh on reopen.
- **External references**: Cross-workbook links (`[Book2.xlsx]Sheet1!A1`) are parsed but not resolved.
- **Print layout**: Page breaks and print areas are stored but print preview is not yet implemented.
- **Conditional formatting icons/data bars**: Rules are stored and evaluated; rendering of icon sets and data bars is partial.

---

## Project Scale

| Metric | Count |
|--------|-------|
| Rust compute crates | 21 |
| TypeScript packages | 47 |
| Excel-compatible functions | 454 |
| Rust unit tests | 12,264 |
| Collaboration test scenarios | 216 |
| API test scenarios | 572 |
| UI test assertions | 451 |
| SDK platform binaries | 7 |

The engine is actively developed. Formula accuracy, XLSX fidelity, and performance benchmarks are re-evaluated on every release, ensuring no regressions.
