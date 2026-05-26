//! Recursive canonicalizer for the per-sheet yrs state of a
//! [`YrsComputeEngine`]. Produces a stable, comparable tree so two engines
//! built from equivalent input (e.g. `from_snapshot` vs `from_xlsx_bytes`)
//! can be asserted equal modulo yrs internals, CellId allocation, and a
//! narrow set of well-understood hydration-path differences documented
//! below.
//!
//! ## Scope
//!
//! Per GridIndex migration Step D.5, the canonicalizer is scoped to the following
//! per-sheet top-level keys:
//!
//! * `cells` — YMap of cell_hex → { `v`, `f`, `ft`, `fr`, `fda`, `fv` }.
//! * `rowOrder` / `colOrder` — YArray of row/col id hexes (positional
//!   markers only — actual hex values are freshly allocated).
//! * `gridIndex/posToId` and `gridIndex/idToPos`.
//! * `properties.name` (other sheet-properties scalars were retired in
//!   GridIndex migration; the xlsx path may still write `rows`/`cols`/
//!   `originalSheetId` — those are dropped here).
//!
//! Everything else on the sheet map (merges, hyperlinks, cell formats,
//! grouping, rowIndex/colIndex, properties, etc.) is intentionally out of
//! scope for hydration parity. Those sub-maps round-trip through
//! different representations on the two paths today and are asserted by
//! their own dedicated round-trip tests (`xlsx_merge_roundtrip`,
//! `xlsx_hyperlink_roundtrip`, `xlsx_raw_value_roundtrip`, etc.). See
//! [`ALLOWED_SHEET_KEYS`] for the exhaustive allowlist and the comment
//! on `properties` there for the detailed rationale.
//!
//! ## Recursion
//!
//! Inside every allowed sub-map the canonicalizer descends recursively
//! into nested `YMap` / `YArray` without depth limits. A single `Any::Map`
//! nested inside a YMap is walked the same way as a `YMap`.
//!
//! ## Stability transforms
//!
//! Four transforms make the canonical tree invariant across hydration
//! paths:
//!
//! 1. **CellId hex normalization**. The two paths allocate different
//!    `CellId` UUIDs for the same logical cell (snapshot keeps the
//!    caller-provided UUID; xlsx hydration allocates fresh UUIDs). We
//!    build a `cell_hex → (row, col)` index from `gridIndex/posToId`.
//!    Every cell_hex that appears as a map key or as a string value is
//!    rewritten to `"pos(row,col)"`.
//! 2. **Row/Col id hex normalization**. `rowOrder` / `colOrder` hold
//!    freshly allocated row/col ID hexes. We replace each array entry
//!    with its positional index (`"row#<idx>"` / `"col#<idx>"`) and
//!    truncate both arrays to the *occupied prefix* (one past the
//!    highest row/col index referenced by `posToId`). This normalizes
//!    the "snapshot keeps the requested rows × cols; xlsx only keeps
//!    what XLSX emitted" divergence.
//! 3. **Pos-key rewrite**. `"rowHex:colHex"` composite keys inside
//!    `gridIndex/posToId` and composite values inside
//!    `gridIndex/idToPos` are rewritten to `"pos(row,col)"`.
//! 4. **Formula `=` prefix**. The xlsx path strips the leading `=` from
//!    formula strings; the snapshot path preserves it. Inside a `cells`
//!    sub-tree the `f` and `ft` values are stripped of a single leading
//!    `=` before canonicalization.
//!
//! ## Cell filtering
//!
//! The xlsx path occasionally materializes marker cells (for merge
//! top-left/bottom-right placeholders) that do not appear in
//! `posToId`. Within the `cells` sub-tree, entries whose cell_hex has
//! no corresponding `posToId` entry are dropped — they are path-
//! specific implementation artefacts, not user-visible content.
//!
//! ## Ephemeral-field stripping
//!
//! yrs client-id / Lamport metadata lives on the `Doc` itself, not in
//! user-visible `YMap` content. As a defensive measure we drop any key
//! named `clientId` encountered during traversal.
//!
//! ## f64 stability
//!
//! Numbers are stringified with `{:?}` — the Rust debug formatter
//! prints lossless round-trip representations of `f64`, giving a
//! byte-stable canonical form.

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::storage::engine::YrsComputeEngine;
use compute_document::hex::id_to_hex;
use yrs::{Any, Array, Map, Out, ReadTxn, Transact};

// ---------------------------------------------------------------------------
// CanonValue — the comparable tree
// ---------------------------------------------------------------------------

/// A stable, comparable representation of a yrs value sub-tree.
///
/// Maps are `BTreeMap` so iteration order is key-sorted and deterministic.
/// Numbers are stored as their `{:?}` string form for byte-stable equality.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonValue {
    Null,
    Bool(bool),
    /// `format!("{:?}", f)` for `f64` stability.
    Number(String),
    /// Signed integer (yrs `Any::BigInt`).
    BigInt(i64),
    String(String),
    /// Binary buffer — hex-encoded for stable diffing.
    Buffer(String),
    Map(BTreeMap<String, CanonValue>),
    Array(Vec<CanonValue>),
}

// ---------------------------------------------------------------------------
// Per-sheet normalization context
// ---------------------------------------------------------------------------

/// Per-sheet normalization indices built from `gridIndex/posToId` and the
/// `rowOrder` / `colOrder` arrays. Used to rewrite unstable hex strings
/// into position-based synthetic identifiers.
struct Norm {
    /// cell_hex → `"pos(row,col)"`.
    cell_by_hex: BTreeMap<String, String>,
    /// row_hex → row index (into `rowOrder`).
    row_by_hex: BTreeMap<String, u32>,
    /// col_hex → col index (into `colOrder`).
    col_by_hex: BTreeMap<String, u32>,
    /// Occupied-prefix length for `rowOrder` (1 + max referenced row).
    /// 0 if no cells are populated.
    row_occupied_len: u32,
    /// Occupied-prefix length for `colOrder` (1 + max referenced col).
    col_occupied_len: u32,
}

impl Norm {
    /// Translate a `"rowHex:colHex"` key to `"pos(row,col)"` if both ids
    /// resolve; return `None` otherwise.
    fn rewrite_pos_key(&self, pos_key: &str) -> Option<String> {
        let (row_hex, col_hex) = pos_key.split_once(':')?;
        let row = *self.row_by_hex.get(row_hex)?;
        let col = *self.col_by_hex.get(col_hex)?;
        Some(format!("pos({},{})", row, col))
    }

    /// Rewrite a string value that might be a cell_hex or a `"rowHex:colHex"`
    /// composite key. Leaves unrecognised strings untouched.
    fn rewrite_string(&self, s: &str) -> String {
        if let Some(rewritten) = self.cell_by_hex.get(s) {
            return rewritten.clone();
        }
        if s.contains(':')
            && let Some(rewritten) = self.rewrite_pos_key(s)
        {
            return rewritten;
        }
        s.to_string()
    }
}

// ---------------------------------------------------------------------------
// Allowlist of top-level per-sheet keys that participate in parity.
// Everything else is intentionally out of scope — see module docstring.
// ---------------------------------------------------------------------------

const ALLOWED_SHEET_KEYS: &[&str] = &[
    "cells",
    // NOTE: `cellProperties` (the per-cell attribute bag, formerly
    // squatting on the name `properties` pre-R56.C) is intentionally
    // excluded. The xlsx hydration path stores per-cell "original
    // value" JSON strings (e.g.
    // `{"formulaResultType":1,"originalValue":"1"}`) carried from the
    // raw XLSX; the snapshot path leaves the bag empty because
    // `CellData` has no equivalent input field. That's a hydration-path
    // divergence, not a structural-parity problem, so it lives outside
    // the parity scope. Round-trip of displayed values is covered by
    // `xlsx_raw_value_roundtrip.rs`.
    "rowOrder",
    "colOrder",
    "gridIndex",
    "properties",
];

/// Sheet-properties fields that are compared for parity. Everything
/// else in `properties` (e.g. xlsx's `originalSheetId`, retired
/// `rows`/`cols` scalars) is dropped.
const ALLOWED_PROPERTIES_KEYS: &[&str] = &["name"];

/// Keys inside a single cell's YMap that matter for parity.
const ALLOWED_CELL_KEYS: &[&str] = &["v", "f", "ft", "fr", "fda", "fv"];

/// Sub-keys of `gridIndex` that matter for parity.
const ALLOWED_GRID_INDEX_KEYS: &[&str] = &["posToId", "idToPos"];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Canonicalize the entire workbook into a map of `sheet_name → canonical
/// tree`. Sheets are keyed by their human-readable name because that is
/// what round-trips through XLSX (sheet IDs are freshly allocated by
/// `from_xlsx_bytes`).
pub fn canonicalize(engine: &YrsComputeEngine) -> BTreeMap<String, CanonValue> {
    let storage = engine.storage();
    let doc = storage.doc();
    let sheets_map = storage.sheets();
    let txn = doc.transact();

    let mut out: BTreeMap<String, CanonValue> = BTreeMap::new();
    for sheet_id in storage.sheet_order() {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let sheet_map = match sheets_map.get(&txn, sheet_hex.as_str()) {
            Some(Out::YMap(m)) => m,
            other => panic!("sheet map missing for {}: {:?}", sheet_hex.as_str(), other),
        };

        let norm = build_norm(&txn, &sheet_map);

        // Sheet name is the outer key; fall back to the sheet hex so a
        // missing `properties.name` doesn't silently collapse two sheets.
        let name = match sheet_map.get(&txn, "properties") {
            Some(Out::YMap(properties)) => match properties.get(&txn, "name") {
                Some(Out::Any(Any::String(s))) => s.to_string(),
                _ => sheet_hex.as_str().to_string(),
            },
            _ => sheet_hex.as_str().to_string(),
        };

        let tree = canon_sheet(&txn, &sheet_map, &norm);
        out.insert(name, tree);
    }
    out
}

// ---------------------------------------------------------------------------
// Normalization index construction
// ---------------------------------------------------------------------------

fn build_norm<T: ReadTxn>(txn: &T, sheet_map: &yrs::MapRef) -> Norm {
    let row_by_hex: BTreeMap<String, u32> = match sheet_map.get(txn, "rowOrder") {
        Some(Out::YArray(arr)) => (0..arr.len(txn))
            .filter_map(|i| match arr.get(txn, i) {
                Some(Out::Any(Any::String(s))) => Some((s.to_string(), i)),
                _ => None,
            })
            .collect(),
        _ => BTreeMap::new(),
    };
    let col_by_hex: BTreeMap<String, u32> = match sheet_map.get(txn, "colOrder") {
        Some(Out::YArray(arr)) => (0..arr.len(txn))
            .filter_map(|i| match arr.get(txn, i) {
                Some(Out::Any(Any::String(s))) => Some((s.to_string(), i)),
                _ => None,
            })
            .collect(),
        _ => BTreeMap::new(),
    };

    let mut cell_by_hex: BTreeMap<String, String> = BTreeMap::new();
    let mut max_row: i32 = -1;
    let mut max_col: i32 = -1;
    if let Some(Out::YMap(gi)) = sheet_map.get(txn, "gridIndex")
        && let Some(Out::YMap(pos_to_id)) = gi.get(txn, "posToId")
    {
        for (pos_key, cell_any) in pos_to_id.iter(txn) {
            let Out::Any(Any::String(cell_hex)) = cell_any else {
                continue;
            };
            let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
                continue;
            };
            let (Some(&row), Some(&col)) = (row_by_hex.get(row_hex), col_by_hex.get(col_hex))
            else {
                continue;
            };
            cell_by_hex.insert(cell_hex.to_string(), format!("pos({},{})", row, col));
            if row as i32 > max_row {
                max_row = row as i32;
            }
            if col as i32 > max_col {
                max_col = col as i32;
            }
        }
    }

    let row_occupied_len = if max_row < 0 { 0 } else { (max_row + 1) as u32 };
    let col_occupied_len = if max_col < 0 { 0 } else { (max_col + 1) as u32 };

    Norm {
        cell_by_hex,
        row_by_hex,
        col_by_hex,
        row_occupied_len,
        col_occupied_len,
    }
}

// ---------------------------------------------------------------------------
// Sheet-level canonicalization — allowlist dispatch
// ---------------------------------------------------------------------------

fn canon_sheet<T: ReadTxn>(txn: &T, sheet_map: &yrs::MapRef, norm: &Norm) -> CanonValue {
    let mut out: BTreeMap<String, CanonValue> = BTreeMap::new();
    for key in ALLOWED_SHEET_KEYS {
        let Some(value) = sheet_map.get(txn, key) else {
            continue;
        };
        let canon = match *key {
            "cells" => canon_cells(txn, &value, norm),
            "rowOrder" => canon_row_order(txn, &value, norm),
            "colOrder" => canon_col_order(txn, &value, norm),
            "gridIndex" => canon_grid_index(txn, &value, norm),
            "properties" => canon_properties(txn, &value),
            _ => continue,
        };
        out.insert((*key).to_string(), canon);
    }
    CanonValue::Map(out)
}

fn canon_cells<T: ReadTxn>(txn: &T, v: &Out, norm: &Norm) -> CanonValue {
    let Out::YMap(m) = v else {
        return CanonValue::Null;
    };
    let mut out: BTreeMap<String, CanonValue> = BTreeMap::new();
    for (cell_hex, cell_out) in m.iter(txn) {
        // Drop cell entries that have no position mapping — those are
        // path-specific artefacts (e.g. xlsx merge placeholders).
        let cell_hex: &str = cell_hex;
        let Some(pos_key) = norm.cell_by_hex.get(cell_hex) else {
            continue;
        };
        let canon_cell = match cell_out {
            Out::YMap(cm) => {
                let mut fields: BTreeMap<String, CanonValue> = BTreeMap::new();
                for field in ALLOWED_CELL_KEYS {
                    let Some(fv) = cm.get(txn, field) else {
                        continue;
                    };
                    let cv = canon_out(txn, fv, norm);
                    let cv = if matches!(*field, "f" | "ft") {
                        strip_formula_equals(cv)
                    } else {
                        cv
                    };
                    fields.insert((*field).to_string(), cv);
                }
                CanonValue::Map(fields)
            }
            other => canon_out(txn, other, norm),
        };
        out.insert(pos_key.clone(), canon_cell);
    }
    CanonValue::Map(out)
}

/// Strip a single leading `=` from a formula string value. Applies to
/// `CanonValue::String` only — other variants pass through. The xlsx
/// hydration path stores formulas without the leading `=`, the snapshot
/// path preserves it; this normalizes the two.
fn strip_formula_equals(v: CanonValue) -> CanonValue {
    match v {
        CanonValue::String(s) => CanonValue::String(s.strip_prefix('=').unwrap_or(&s).to_string()),
        other => other,
    }
}

fn canon_row_order<T: ReadTxn>(txn: &T, v: &Out, norm: &Norm) -> CanonValue {
    let Out::YArray(arr) = v else {
        return CanonValue::Null;
    };
    let len = arr.len(txn);
    let take = std::cmp::min(norm.row_occupied_len, len);
    let mut items: Vec<CanonValue> = Vec::with_capacity(take as usize);
    for i in 0..take {
        items.push(CanonValue::String(format!("row#{}", i)));
    }
    let _ = arr; // silence unused if occupied prefix is 0
    CanonValue::Array(items)
}

fn canon_col_order<T: ReadTxn>(txn: &T, v: &Out, norm: &Norm) -> CanonValue {
    let Out::YArray(arr) = v else {
        return CanonValue::Null;
    };
    let len = arr.len(txn);
    let take = std::cmp::min(norm.col_occupied_len, len);
    let mut items: Vec<CanonValue> = Vec::with_capacity(take as usize);
    for i in 0..take {
        items.push(CanonValue::String(format!("col#{}", i)));
    }
    let _ = arr;
    CanonValue::Array(items)
}

fn canon_grid_index<T: ReadTxn>(txn: &T, v: &Out, norm: &Norm) -> CanonValue {
    let Out::YMap(m) = v else {
        return CanonValue::Null;
    };
    let mut out: BTreeMap<String, CanonValue> = BTreeMap::new();
    for sub in ALLOWED_GRID_INDEX_KEYS {
        let Some(sub_out) = m.get(txn, sub) else {
            continue;
        };
        let Out::YMap(sub_map) = sub_out else {
            continue;
        };
        let mut entries: BTreeMap<String, CanonValue> = BTreeMap::new();
        for (k, v) in sub_map.iter(txn) {
            let k = k.to_string();
            match *sub {
                "posToId" => {
                    // key = "rowHex:colHex", value = cell_hex
                    let Some(pos_key) = norm.rewrite_pos_key(&k) else {
                        continue;
                    };
                    entries.insert(pos_key, canon_out(txn, v, norm));
                }
                "idToPos" => {
                    // key = cell_hex, value = "rowHex:colHex"
                    let Some(pos_key) = norm.cell_by_hex.get(&k) else {
                        continue;
                    };
                    entries.insert(pos_key.clone(), canon_out(txn, v, norm));
                }
                _ => {
                    entries.insert(k, canon_out(txn, v, norm));
                }
            }
        }
        out.insert((*sub).to_string(), CanonValue::Map(entries));
    }
    CanonValue::Map(out)
}

fn canon_properties<T: ReadTxn>(txn: &T, v: &Out) -> CanonValue {
    let Out::YMap(m) = v else {
        return CanonValue::Null;
    };
    let mut out: BTreeMap<String, CanonValue> = BTreeMap::new();
    for key in ALLOWED_PROPERTIES_KEYS {
        let Some(val) = m.get(txn, key) else {
            continue;
        };
        // Sheet properties are scalar-only today; `canon_any` via a
        // throwaway Norm is fine but we only ever see Any values here.
        // Use a no-op norm.
        let norm = Norm {
            cell_by_hex: BTreeMap::new(),
            row_by_hex: BTreeMap::new(),
            col_by_hex: BTreeMap::new(),
            row_occupied_len: 0,
            col_occupied_len: 0,
        };
        out.insert((*key).to_string(), canon_out(txn, val, &norm));
    }
    CanonValue::Map(out)
}

// ---------------------------------------------------------------------------
// Recursive value canonicalization (used inside cells / properties)
// ---------------------------------------------------------------------------

fn canon_map_full<T: ReadTxn>(txn: &T, map: &yrs::MapRef, norm: &Norm) -> CanonValue {
    let mut out: BTreeMap<String, CanonValue> = BTreeMap::new();
    for (key, value) in map.iter(txn) {
        let key = key.to_string();
        if key == "clientId" {
            continue;
        }
        let canon_key = norm.cell_by_hex.get(&key).cloned().unwrap_or(key);
        out.insert(canon_key, canon_out(txn, value, norm));
    }
    CanonValue::Map(out)
}

fn canon_array_full<T: ReadTxn>(txn: &T, arr: &yrs::ArrayRef, norm: &Norm) -> CanonValue {
    let len = arr.len(txn);
    let mut elems: Vec<CanonValue> = Vec::with_capacity(len as usize);
    for i in 0..len {
        let Some(v) = arr.get(txn, i) else { continue };
        elems.push(canon_out(txn, v, norm));
    }
    CanonValue::Array(elems)
}

fn canon_out<T: ReadTxn>(txn: &T, out: Out, norm: &Norm) -> CanonValue {
    match out {
        Out::Any(any) => canon_any(&any, norm),
        Out::YMap(m) => canon_map_full(txn, &m, norm),
        Out::YArray(a) => canon_array_full(txn, &a, norm),
        // Text / XML / SubDoc / WeakLink shapes aren't used by compute-core.
        // Catch-all keeps us compatible across yrs feature flags (e.g. the
        // `weak` feature adds a `YWeakLink` variant) and surfaces schema
        // changes loudly if any start appearing.
        other => CanonValue::String(format!(
            "<unsupported-out:{:?}>",
            std::mem::discriminant(&other)
        )),
    }
}

fn canon_any(any: &Any, norm: &Norm) -> CanonValue {
    match any {
        Any::Null => CanonValue::Null,
        Any::Undefined => CanonValue::Null,
        Any::Bool(b) => CanonValue::Bool(*b),
        Any::Number(n) => CanonValue::Number(format!("{:?}", n)),
        Any::BigInt(i) => CanonValue::BigInt(*i),
        Any::String(s) => CanonValue::String(norm.rewrite_string(s.as_ref())),
        Any::Buffer(b) => CanonValue::Buffer(buffer_hex(b)),
        Any::Array(items) => CanonValue::Array(items.iter().map(|a| canon_any(a, norm)).collect()),
        Any::Map(m) => {
            let mut out: BTreeMap<String, CanonValue> = BTreeMap::new();
            for (k, v) in m.iter() {
                if k == "clientId" {
                    continue;
                }
                let canon_key = norm
                    .cell_by_hex
                    .get(k)
                    .cloned()
                    .unwrap_or_else(|| k.clone());
                out.insert(canon_key, canon_any(v, norm));
            }
            CanonValue::Map(out)
        }
    }
}

fn buffer_hex(bytes: &Arc<[u8]>) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes.iter() {
        s.push_str(&format!("{:02x}", b));
    }
    s
}
