# Domain Types

Pure Rust data structures for every domain concept in the spreadsheet engine (comments, charts, conditional formatting, filters, tables, pivots, etc.).

## Purpose

These structs are the **canonical data definitions** — they specify what the data looks like (fields, types, defaults) with no persistence or serialization logic beyond `serde`. They are used everywhere: XLSX parser, compute-core, Yrs CRDT layer, and bridge codegen.

## Conventions

- All structs derive `Debug, Clone, PartialEq, Serialize, Deserialize`
- Use `#[serde(rename_all = "camelCase")]` for JSON interop
- Optional fields use `#[serde(default, skip_serializing_if = "Option::is_none")]`
- Each file covers one domain (e.g. `comment.rs` has `Comment`, `PersonInfo`, `RichTextRun`)
- `mod.rs` re-exports everything via `pub use <module>::*`

## Relationship to `yrs_schema/`

These types know nothing about Yrs or CRDTs. The sibling `yrs_schema/` module handles mapping these structs to/from Y.Map documents for real-time collaboration. This separation keeps domain types pure and reusable across all layers.
