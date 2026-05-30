# Mog: A Spreadsheet Engine Built for Correctness

Mog is an open-source spreadsheet engine, app runtime, and SDK stack with a Rust compute/storage core and TypeScript kernel, rendering, and SDK layers. The same Rust bridge surfaces target web (WASM), desktop (Tauri), and server/headless use (N-API through `@mog-sdk/node`).

This report covers what the public repository implements today, how the implementation is structured, and where the current evidence is. It does not publish roadmap claims or fixed benchmark numbers.

---

## Formula Engine

The formula engine lives in `compute-core` and its extracted crates. The `compute-functions` crate documents a library of **512+ Excel-compatible pure functions** across math, statistical, financial, text, logical, lookup/reference, date/time, engineering, database, information, web, and related modules. The parser is built on [winnow](https://github.com/winnow-rs/winnow) and covers A1/R1C1 references, nested expressions, structured references, cross-sheet and external-workbook references, array literals, and LAMBDA call syntax.

**How we verify correctness.** The repository contains focused formula accuracy tests such as `compute/core/tests/formula_accuracy_*.rs`, structured-reference and lookup suites, numeric repeatability tests, and optional corpus lanes (`corpus-tests`) for real workbook coverage. These tests use the current Rust engine as the execution path rather than a separate compatibility shim.

**Numerical precision.** Numeric cell values use `FiniteF64`, a wrapper over `f64` that rejects NaN and infinity at construction time. Aggregation code uses Kahan compensated summation and Welford-style variance/standard-deviation accumulation where those algorithms apply. The `dd-precision` feature in `value-types` adds a double-double error term for higher-precision intermediate arithmetic when that lane is enabled.

**What we do not execute.** Embedded VBA/macros, active-content parts, and XLL-style add-ins are not interpreted as workbook code. External workbook references and external-link metadata are parsed or preserved where supported, and local-sheet external references can be rewritten during import, but live external data refresh is a host/integration concern rather than Excel automation inside the formula engine.

---

## Performance Architecture

The public repository includes benchmark and performance-gate infrastructure, but this report does not claim stable wall-clock timings. Current performance-sensitive implementation details are:

| Area | Current implementation |
|------|------------------------|
| Viewport data | Binary `compute-wire` blobs read from TypeScript with `DataView` |
| Cell records | 32-byte dense, row-major viewport records |
| Mutation records | 40-byte patches: row/column prefix plus the 32-byte cell record |
| Strings | Packed UTF-8 string pools referenced by offset and length |
| Formats | Deduplicated binary format palette with delta support |
| Recalc | Native builds can use `rayon`; WASM builds use the single-threaded path |

The binary data plane is documented in `docs/architecture/compute-bridge.md` and implemented in `compute/core/crates/compute-wire`. TypeScript consumption lives under `kernel/src/bridges/wire`, including `BinaryViewportBuffer`, `BinaryMutationReader`, and the viewport coordinator.

XLSX parsing is Rust-native and has native, parallel, lazy, and WASM-facing paths in `file-io/xlsx/parser` and `file-io/xlsx-api`. The repo also contains XLSX performance budgets and tooling under `file-io/xlsx/parser/testing/budgets` and `file-io/xlsx/tooling`.

---

## XLSX Compatibility

Round-trip fidelity - open an Excel file, model it, write it back, and re-open it - is covered by both parser-level and engine-level tests. The main data path is:

```text
.xlsx -> xlsx-parser / xlsx-api -> ParseOutput -> Yrs-backed engine state -> XLSX writer -> .xlsx
```

Coverage in the current repository includes tests for cell values, formulas, styles, comments, hyperlinks, conditional formatting, data validations, tables, print settings, page breaks, sparklines, protection, themes, sheet metadata, row/column structural changes, merges, sorts, auto filters, and parse-output round trips. Relevant paths include `file-io/xlsx/parser/tests`, `compute/core/tests/roundtrip_parse_output`, and the `compute/core/tests/xlsx_*_roundtrip.rs` suites.

Some OOXML parts are authoritative workbook state, while others are Excel caches. For example, Mog intentionally does not export `xl/calcChain.xml`; Excel can rebuild that calculation cache. Imported active content is not executed, and feature-specific OOXML details such as complex chart variants, external links, and workbook connections should be checked against their dedicated parser/writer tests before treating them as full Excel behavioral parity.

---

## Cross-Platform Runtime

The compute workspace centers on the `compute-core` root crate plus extracted crates under `compute/core/crates`. Bindings are generated from `#[bridge::api]` and related annotations, then consumed by target-specific bridge crates.

| Target | Binding | Use Case |
|--------|---------|----------|
| `wasm32-unknown-unknown` | WASM | Browser runtime and worker-backed compute |
| Native desktop | Tauri IPC | Desktop app |
| Native server | N-API | Node.js SDK and headless automation |

The transport factory in `infra/transport` auto-detects N-API, Tauri, then WASM unless an explicit runtime is supplied. The TypeScript side consumes a common async `BridgeTransport` interface, with middleware for platform-specific details such as time injection and packed binary return normalization.

The bridge stack also includes TypeScript type generation through `bridge-ts`, which emits generated bridge clients and wire interfaces under `kernel/src/bridges/compute`.

---

## SDK

`@mog-sdk/node` is the headless Node SDK. It publishes optional native binary packages for seven platform triples: macOS arm64/x64, Linux x64/arm64 glibc/musl, and Windows x64.

```typescript
import { createWorkbook } from '@mog-sdk/node';

const wb = await createWorkbook('financial-model.xlsx');
const ws = wb.activeSheet;

await ws.setCell('B2', 150000);
const revenue = await ws.getValue('B10');

await wb.save('updated-model.xlsx');
await wb.dispose();
```

The SDK package root exposes `createWorkbook`, document factory types, workbook and worksheet contracts, utility functions, and API introspection helpers. The generated SDK API spec covers workbook and worksheet sub-APIs for sheets, names, history, security, formatting, structure, charts, tables, filters, conditional formatting, comments, validations, pivots, print, view state, and related worksheet features.

For LLM-facing workflows, worksheet methods such as `describe()`, `describeRange()`, and `summarize()` produce compact textual presentations of cell and range contents. Separately, `api.describe()` exposes programmatic API introspection from the generated SDK spec.

---

## Collaboration

Persistent workbook state is stored in a Yrs CRDT document. The core design decision is the identity model: cells, rows, and columns have stable identities (`CellId`, `RowId`, `ColId`), and position is derived from identity-to-position state.

Users still type and see A1 formulas. Internally, formulas can carry a template plus identity references; persisted A1 text is used for compatibility, display, search, and export. Structural operations update identity-position state and regenerate derived A1 views where needed, while identity references remain the source of truth.

Collaboration evidence in the repo includes the `compute-collab` Yrs sync protocol tests, `compute-document` identity tests, `compute/core/tests/range_collab_convergence.rs`, and `compute/core/tests/collab_structural_formula_sync.rs`.

---

## Testing

The current repository has verification surfaces across Rust and TypeScript. This report does not claim a single aggregate pass rate.

| Area | Evidence paths |
|------|----------------|
| Formula accuracy | `compute/core/tests/formula_accuracy_*.rs`, `compute/core/tests/formula_contracts.rs` |
| Numeric behavior | `compute/core/tests/numeric_repeatability`, `compute/core/crates/compute-stats/tests` |
| XLSX import/export | `file-io/xlsx/parser/tests`, `compute/core/tests/xlsx_*_roundtrip.rs`, `compute/core/tests/roundtrip_parse_output` |
| Binary wire | `compute/core/crates/compute-wire`, `kernel/src/bridges/wire/__tests__` |
| SDK surface | `runtime/sdk/src/generated/api-spec.json`, `tools/api-snapshots` |
| Collaboration | `compute/core/crates/compute-collab/tests`, `compute/core/crates/compute-document/src/identity/tests`, `compute/core/tests/range_collab_convergence.rs` |

Common verification gates are documented at the repo root and in development docs. For this report, the important point is that the evidence is source-path specific rather than a static test-count table.

---

## Known Limitations

We'd rather you know these upfront than discover them in production.

- **VBA/macros and active content**: Imported workbook scripts are not executed. Active-content parts may be detected, preserved, disabled, or quarantined depending on the import/export path.
- **External data refresh**: External workbook references, workbook links, and connection metadata are modeled in several places, but live refresh requires an integration/resolver and is not the same as Excel automation.
- **OOXML feature depth**: Broad parser/writer coverage exists, but complex chart variants, active content, external links, workbook connections, and other specialized OOXML parts need feature-specific verification before claiming full behavioral parity.
- **Calculation chain**: `xl/calcChain.xml` is not exported because it is an Excel cache, not authoritative workbook state.
- **Volatile/time functions**: Transports include clock-injection support for WASM/N-API, but deterministic comparison of volatile functions requires a fixed clock.
- **Published benchmark numbers**: Benchmark infrastructure exists, but fixed latency/memory/frame-rate numbers are not claimed in this document.

---

## Project Scale

| Metric | Current evidence |
|--------|------------------|
| Compute workspace shape | `compute-core` root crate plus 30 extracted crates under `compute/core/crates` |
| Function library | `compute-functions` documents 512+ pure Excel-compatible functions |
| SDK platform binaries | 7 optional `@mog-sdk/*` native platform packages |
| Bridge targets | WASM, Tauri, N-API, plus bridge infrastructure for TypeScript generation |
| Binary viewport format | 36-byte header, 32-byte cell records, 40-byte mutation patches |
| Public SDK API metadata | Generated spec in `runtime/sdk/src/generated/api-spec.json` |

Mog is actively developed. Treat source code, generated API metadata, and focused verification paths as authoritative for current capabilities.
