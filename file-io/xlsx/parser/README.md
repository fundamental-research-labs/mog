# xlsx-parser

High-performance XLSX parser in Rust.

## Features

- Streaming ZIP/XML parse into typed workbook structures
- Shared strings, styles, formulas, and sheet data
- Round-trip write path used by the compute engine

## XLSX Calculation Chain Policy

Mog never exports `xl/calcChain.xml`. The calculation chain is an Excel engine
cache, not authoritative workbook state. Import counts an existing calcChain
only for diagnostics; it is not represented in `ParseOutput`, native workbook state, or
package sidecars. Export emits formula cached results from modeled cell values
and preserves modeled workbook calculation settings; omitting calcChain does not
force `fullCalcOnLoad`, `calcCompleted`, or `forceFullCalc` changes.
An imported `calcPr.calcId` is retained only when `CalcIdProvenance` is explicitly
`ImportedCurrent`, still matches the imported value, and has both workbook and
formula-graph generation values populated. The ordinary parse→export path does
not populate those values and therefore emits the canonical `calcId="0"`; this prevents
a stale calculation-engine identifier from being presented as current and is
independent of whether cached formula values are themselves correct.

## Workbook Metadata and Unsupported XML Policy

Typed workbook state (`fileVersion`, `workbookPr`, `bookViews`, `fileSharing`,
`webPublishing`, and `calcPr`) is parsed into the workbook model and regenerated
from that current state. Direct workbook children without a typed owner are
captured by `WorkbookXmlFidelity`: relationship-free inert payloads may be
replayed from their imported bytes under the writer's canonical workbook child
order, while payloads with package relationships are omitted unless an owner
can remap and validate those relationships.

Direct `mc:AlternateContent` is fail-closed because selecting a branch without
an owner can change workbook semantics. This intentionally drops common
`x15ac:absPath` entries, which describe the source machine's save location.
Unknown direct children such as `xr:revisionPtr` are also omitted because they
carry coauthoring or session state that cannot be proven current after Mog
imports or edits. Root `mc:Ignorable` tokens remain attached to declared
extension namespaces; root `mc:ProcessContent` and `mc:MustUnderstand` are
captured for diagnostics but omitted because this writer cannot prove that all
listed extension markup is interpreted and current. All such omissions are
recorded in import diagnostics. A future typed owner may preserve these values
only after validating their current scope; generic raw replay is not a safe
round-trip contract.

## Architecture

Modules are organized as:

- **`domain/`** — OOXML feature parsers (cells, charts, styles, tables, …)
- **`pipeline/`** — parse orchestration (full, lazy, streaming)
- **`infra/`** — XML, ZIP, namespace, and error infrastructure
- **`output/`** — result types and serialization helpers
- **`write/`** — round-trip write path used by the compute engine
- **`zip/`** — ZIP archive reading

Callers use `parse_xlsx_to_output()` / `parse_xlsx_full_native()`.

## Building

```bash
cargo test -p xlsx-parser
```

## Verification

Run the parser tests above for typed import/export behavior. The
[test contracts](../test-contracts/README.md) describe corpus and fidelity gates.
For end-to-end CLI checks, see
[Mog verification](../../../docs/guides/verification.md).

The `xlsx-roundtrip` utility checks ZIP entry copying and comparison; it does
not verify spreadsheet semantics or formula results:

```sh
cargo run -p xlsx-parser --features cli --bin xlsx-roundtrip -- file.xlsx -v
```
