# Yrs Schema

CRDT persistence/collaboration adapter layer. Maps domain types (from `domain/`) to and from Yrs Y.Map documents for real-time collaboration.

## Purpose

Each module defines how a domain struct is stored in Yrs, providing:

- **Key constants** — field names used in Y.Map (e.g. `KEY_CELL_REF = "cellRef"`)
- **`to_yrs_prelim()`** — convert domain struct to `Vec<(&str, Any)>` for initial Yrs hydration
- **`from_yrs_map()`** — read a Y.Map back into the domain struct
- **`update_field()`** — update a single field on a live Y.Map

Follows the `cell_serde.rs` gold standard pattern from compute-core.

## Tier System

Modules are organized by structural complexity:

| Tier | Pattern | Modules |
|------|---------|---------|
| **Tier 1** | Flat Y.Map (every field is a native Yrs `Any` key) | cell_format, comment, merge, hyperlink, named_range, print, protection, outline, sparkline |
| **Tier 2** | Y.Map + Y.Array for ordered sub-collections | conditional, validation, filter, table |
| **Tier 3** | Structured envelope + JSON definition blob | chart, pivot, floating_object, form_control, diagram, connector, ole_object |

## Shared Helpers (`helpers.rs`)

Type-safe read functions (`read_string`, `read_number`, `read_bool`, `read_u64`) and write helpers that handle the `yrs::Out::Any` → native type conversion.

## Relationship to `domain/`

This module depends on `domain/` for the struct definitions but never the reverse. Domain types remain pure and reusable; this layer handles only the Yrs mapping concern.
