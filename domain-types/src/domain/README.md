# Domain Types

Pure Rust data structures for every domain concept in the spreadsheet engine (comments, charts, conditional formatting, filters, tables, pivots, etc.).

## Purpose

These structs are the **canonical data definitions** — they specify what the data looks like (fields, types, defaults) with no persistence or serialization logic beyond `serde`. They are used everywhere: XLSX parser, native compute storage, evaluator, and bridge codegen.

## Conventions

- All structs derive `Debug, Clone, PartialEq, Serialize, Deserialize`
- Use `#[serde(rename_all = "camelCase")]` for JSON interop
- Optional fields use `#[serde(default, skip_serializing_if = "Option::is_none")]`
- Each file covers one domain (e.g. `comment.rs` has `Comment`, `PersonInfo`, `RichTextRun`)
- `mod.rs` re-exports everything via `pub use <module>::*`

## Native storage

The engine stores these typed values directly in native workbook and sheet metadata. Stable identity indexes handle cell and axis ownership; XML and JSON conversion stays at import, export, and wire boundaries.
