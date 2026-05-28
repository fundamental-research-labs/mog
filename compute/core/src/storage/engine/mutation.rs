//! Internal mutation descriptor — every public mutation flows through `apply_mutation()`.
//!
//! This module defines the `EngineMutation` enum that represents all possible
//! state-changing operations on the engine. The `apply_mutation()` method on
//! `YrsComputeEngine` is the single dispatch point that guarantees all five
//! stores (yrs Doc, mirror, grid_indexes, compute, undo_manager) stay in sync.

use crate::snapshot::MutationResult;
use cell_types::{CellId, SheetId};
use domain_types::domain::copy::CopyType;
use domain_types::domain::filter::{ColorPosition, SortOrder};
use value_types::CellValue;

/// SDK-boundary intent for a single cell write.
///
/// Carries what the *caller asked for* — not what the engine has classified
/// it as. Eliminates the `\x00`-prefix sentinel that used to smuggle "store
/// empty text" vs "clear the cell" through a primitive `String`.
///
/// Pipeline position: entry point on every FFI-crossing cell-write path.
/// Dispatched by `storage::cells::values::set_cell_value` → resolves into
/// `scheduler::input::CellWrite` (for the `Parse` arm) → leaf write helpers.
///
/// The three variants encode the three intents the SDK expresses today:
/// - `Clear`: remove the cell. `setCell(A1, '')` or `setCell(A1, null)`.
/// - `Literal { text }`: store the text verbatim. No coercion, no formula
///   parsing, no whitespace trimming. Empty `text` stores `Text("")`.
/// - `Parse { text }`: classify with Excel semantics (`=…` formula, `'…`
///   forced-text, scalar coercion, fallback text).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CellInput {
    /// Clear the cell. Equivalent to the legacy empty-string input.
    #[serde(rename = "clear")]
    Clear,
    /// Store this exact text — no type coercion, no formula interpretation,
    /// no whitespace trimming. Empty `text` stores `Text("")`, which is
    /// structurally distinct from `Clear`.
    #[serde(rename = "literal")]
    Literal { text: String },
    /// Parse the string with Excel semantics:
    ///   `=…`  → formula (parsed to `FormulaSource` by the classifier)
    ///   `'…`  → forced-text (strip apostrophe → literal semantics)
    ///   else  → number / bool / date / text via the classifier.
    #[serde(rename = "parse")]
    Parse { text: String },
}

impl CellInput {
    /// Build a `CellInput` from a `CellValue` for internal engine callers
    /// (copy/paste, autofill, sort, relocate, range sync, etc.).
    ///
    /// Already-typed values must not round-trip through `Parse` — that would
    /// re-classify a string like `"=A1"` as a formula. Non-empty Text maps
    /// to `Literal` to preserve what the caller has.
    pub fn from_cell_value(value: &CellValue) -> Self {
        match value {
            CellValue::Null => CellInput::Clear,
            CellValue::Text(s) if s.is_empty() => CellInput::Literal {
                text: String::new(),
            },
            CellValue::Text(s) => CellInput::Literal {
                text: s.to_string(),
            },
            CellValue::Number(n) => CellInput::Parse {
                text: format!("{}", n),
            },
            CellValue::Boolean(b) => CellInput::Parse {
                text: if *b {
                    "TRUE".to_string()
                } else {
                    "FALSE".to_string()
                },
            },
            CellValue::Error(error, _) => CellInput::Parse {
                text: error.as_str().to_string(),
            },
            CellValue::Array(_) => CellInput::Clear,
            CellValue::Control(c) => CellInput::Parse {
                text: if c.value {
                    "TRUE".to_string()
                } else {
                    "FALSE".to_string()
                },
            },
            CellValue::Image(image) => CellInput::Literal {
                text: image.fallback_text().to_string(),
            },
        }
    }

    /// Build a `CellInput` for a formula string (with or without a leading
    /// `=`). Internal callers that already know they have a formula use this.
    pub fn formula(body: &str) -> Self {
        let text = if body.starts_with('=') {
            body.to_string()
        } else {
            format!("={}", body)
        };
        CellInput::Parse { text }
    }
}

impl From<&str> for CellInput {
    /// `&str` → `CellInput` via `Parse`. Provided for test ergonomics and
    /// engine-internal callers that already know their input is a parseable
    /// string. Empty strings map to `Clear`. Non-empty strings map to `Parse`.
    ///
    /// External callers crossing the SDK boundary should build `CellInput`
    /// explicitly to preserve the Literal vs Parse distinction.
    fn from(s: &str) -> Self {
        if s.is_empty() {
            CellInput::Clear
        } else {
            CellInput::Parse {
                text: s.to_string(),
            }
        }
    }
}

impl From<&&str> for CellInput {
    fn from(s: &&str) -> Self {
        CellInput::from(*s)
    }
}

impl From<String> for CellInput {
    fn from(s: String) -> Self {
        if s.is_empty() {
            CellInput::Clear
        } else {
            CellInput::Parse { text: s }
        }
    }
}

impl From<&String> for CellInput {
    fn from(s: &String) -> Self {
        CellInput::from(s.as_str())
    }
}

impl From<&CellInput> for CellInput {
    fn from(c: &CellInput) -> Self {
        c.clone()
    }
}

/// What a single sort criterion compares on, plus the per-mode auxiliary
/// data (custom list, target color, etc.). Discriminated tagged union
/// over the wire — `kind` identifies the variant.
///
/// `rename_all_fields = "camelCase"` propagates the rename into each
/// variant's fields (e.g. `custom_list` → `customList`). On its own,
/// `rename_all` only renames the variant *names* used as the tag —
/// fields inside variants would stay snake_case, which would silently
/// drop `customList` from the JS-emitted JSON. The variant tag values
/// (`kind: "value"` / `"cellColor"` / `"fontColor"`) are pinned via
/// per-variant `#[serde(rename = "...")]`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum BridgeSortMode {
    /// Sort by computed cell value. Optionally consult a custom list to
    /// override natural-order on matched values; values not in the list
    /// sort *after* list members (Excel parity).
    #[serde(rename = "value")]
    Value {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        custom_list: Option<Vec<CellValue>>,
    },
    /// Sort by cell fill color. `target` is a hex string; `position`
    /// places matched rows at the top or bottom of the range.
    #[serde(rename = "cellColor")]
    CellColor {
        target: String,
        #[serde(default)]
        position: ColorPosition,
    },
    /// Sort by font color. Same shape as `CellColor`.
    #[serde(rename = "fontColor")]
    FontColor {
        target: String,
        #[serde(default)]
        position: ColorPosition,
    },
}

/// Wire type for sort criterion at the bridge boundary.
/// Uses column index (not CellId) — the engine resolves to CellId internally.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSortCriterion {
    pub column: u32,
    pub direction: SortOrder,
    pub case_sensitive: bool,
    pub mode: BridgeSortMode,
}

/// Wire type for sort options at the bridge boundary.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSortOptions {
    pub criteria: Vec<BridgeSortCriterion>,
    pub has_headers: bool,
    #[serde(default)]
    pub visible_rows_only: bool,
}

/// Internal mutation descriptor.
///
/// Every public mutation method on `YrsComputeEngine` constructs one of these
/// and passes it to `apply_mutation()`, which ensures all five stores are
/// updated consistently.
#[allow(dead_code)] // Variants are available for future callers to use
pub(crate) enum EngineMutation {
    /// Set a single cell value/formula.
    SetCell {
        sheet_id: SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: CellInput,
    },

    /// Set multiple cells at once. Single recalc pass.
    SetCells {
        edits: Vec<(SheetId, CellId, u32, u32, CellInput)>,
        skip_cycle_check: bool,
    },

    /// Clear one or more cells — removes values, formulas, and dependencies.
    ClearCells { cell_ids: Vec<CellId> },

    /// Set multiple cells by position. CellIds are resolved internally.
    /// For non-empty inputs, creates CellId if cell doesn't exist.
    /// For empty inputs (Clear), skips cells that don't exist (nothing to clear).
    SetCellsByPosition {
        edits: Vec<(SheetId, u32, u32, CellInput)>,
        skip_cycle_check: bool,
    },

    /// Clear all cells in a rectangular range by position.
    /// Only clears cells that exist (CellIds found via find_cell_id_at).
    ClearRangeByPosition {
        sheet_id: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    },

    /// Create a persistent What-If Data Table region.
    CreateDataTable {
        input: crate::data_table::CreateDataTableInput,
    },

    /// Apply a What-If Scenario through a Rust-owned baseline + cell mutation.
    ApplyScenario { scenario_id: String },

    /// Restore a previously captured session baseline for Scenario Manager.
    RestoreScenario { baseline_id: String },

    /// Create a new empty sheet.
    /// When `name` is empty, the engine generates a unique "SheetN" name.
    CreateSheet { name: String },

    /// Create the implicit default sheet on a freshly-started blank workbook.
    ///
    /// Identical in effect to `CreateSheet`, except the underlying Yrs
    /// transaction is tagged with `ORIGIN_BOOTSTRAP` so it never enters the
    /// undo stack. A fresh workbook must report `canUndo == false`.
    CreateDefaultSheet { name: String },

    /// Delete a sheet by SheetId.
    DeleteSheet { sheet_id: SheetId },

    /// Copy a sheet (deep clone of all sub-maps).
    CopySheet {
        source_sheet_id: SheetId,
        new_name: String,
    },

    /// Rename a sheet in all stores.
    RenameSheet { sheet_id: SheetId, name: String },

    /// Sort a range of cells. Updates yrs doc, grid_indexes, and compute.
    SortRange {
        sheet_id: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: BridgeSortOptions,
    },

    /// Clear cells in a range, preserving cell identity (marker cells).
    /// Values become null but CellIds remain in grid. Triggers recalc
    /// for formulas that depended on cleared cells.
    ClearRange {
        sheet_id: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    },

    /// Fully delete cells in a range and return their CellIds.
    /// Unlike ClearRange, this removes cells from all maps (Yrs, grid, mirror).
    /// Returns cleared CellIds via MutationResult.data.
    ClearRangeAndReturnIds {
        sheet_id: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    },

    /// Create a new named range (defined name). Returns DefinedName via data.
    CreateNamedRange {
        input: domain_types::DefinedNameInput,
    },

    /// Update an existing named range. Returns updated DefinedName via data.
    UpdateNamedRange {
        id: String,
        updates: domain_types::NamedRangeUpdate,
    },

    /// Import multiple named ranges (batch). Returns count via data.
    ImportNamedRanges {
        names: Vec<domain_types::DefinedName>,
    },

    /// Create subtotal rows and groups for a data range.
    /// Inserts rows + SUBTOTAL formulas, triggers recalc.
    CreateSubtotals {
        sheet_id: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: crate::storage::sheet::grouping::SubtotalOptions,
    },

    /// Autofill: compute fill updates from source range and apply to target range.
    AutoFill {
        sheet_id: SheetId,
        request: crate::engine_types::fill::BridgeAutoFillRequest,
    },

    /// Flash fill: infer text transformation from examples and fill remaining cells.
    FlashFill {
        sheet_id: SheetId,
        request: crate::engine_types::fill::BridgeFlashFillRequest,
    },

    /// Remove duplicate rows from a range.
    /// Compacts unique rows upward, clears leftover rows, triggers recalc.
    RemoveDuplicates {
        sheet_id: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        columns: Vec<u32>,
        has_headers: bool,
    },

    /// Relocate cells from source range to target position.
    /// Preserves CellIds, updates GridIndex for both sheets, triggers recalc.
    RelocateCells {
        source_sheet_id: SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_sheet_id: SheetId,
        target_row: u32,
        target_col: u32,
    },

    /// Copy cells from source range to target position.
    /// Unlike RelocateCells, this does not move — source range is preserved.
    /// Supports value-only, formula (with ref adjustment), format-only, or all.
    CopyRange {
        source_sheet_id: SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_sheet_id: SheetId,
        target_row: u32,
        target_col: u32,
        copy_type: CopyType,
        skip_blanks: bool,
        transpose: bool,
    },
}

impl EngineMutation {
    /// Whether this high-level mutation should be forced into one undo step.
    ///
    /// The undo manager normally separates every user-origin Yrs transaction.
    /// Bulk cell operations may legitimately emit multiple transactions while
    /// resolving identities, writing values, formats, and derived metadata; the
    /// product contract is still one Cmd+Z per public mutation.
    pub(crate) fn should_auto_group_undo(&self) -> bool {
        match self {
            EngineMutation::SetCells { edits, .. } => !edits.is_empty(),
            EngineMutation::SetCellsByPosition { edits, .. } => !edits.is_empty(),
            EngineMutation::ClearCells { cell_ids } => !cell_ids.is_empty(),
            EngineMutation::ClearRangeByPosition { .. }
            | EngineMutation::CreateDataTable { .. }
            | EngineMutation::ApplyScenario { .. }
            | EngineMutation::RestoreScenario { .. }
            | EngineMutation::SortRange { .. }
            | EngineMutation::ClearRange { .. }
            | EngineMutation::ClearRangeAndReturnIds { .. }
            | EngineMutation::CreateSubtotals { .. }
            | EngineMutation::AutoFill { .. }
            | EngineMutation::FlashFill { .. }
            | EngineMutation::RemoveDuplicates { .. }
            | EngineMutation::RelocateCells { .. }
            | EngineMutation::CopyRange { .. } => true,
            _ => false,
        }
    }
}

/// Result of applying a mutation. Some mutations produce recalc results,
/// others produce sheet IDs, some produce nothing notable.
pub(crate) enum MutationOutput {
    /// Mutation result with pending recalc (most cell mutations).
    /// Viewport patches are pulled separately via `flush_viewport_patches()`.
    Recalc(MutationResult),
    /// New sheet ID as hex string + mutation result (create_sheet, copy_sheet).
    SheetId(String, MutationResult),
    /// Mutation result only, no recalc or sheet ID (rename, delete, move, hidden).
    Plain(MutationResult),
}

#[cfg(test)]
mod sort_wire_tests {
    //! Wire-format roundtrip tests for sort criterion / mode types.
    //!
    //! These pin the JSON shape that the kernel layer emits — if the
    //! discriminator key, variant tag, or field name drifts the kernel
    //! and engine fall out of sync silently. The strings below are
    //! exactly what `kernel/src/api/worksheet/operations/sort-operations.ts`
    //! produces today.

    use super::*;
    use value_types::CellValue;

    #[test]
    fn serialize_value_with_custom_list() {
        let mode = BridgeSortMode::Value {
            custom_list: Some(vec![CellValue::Text(std::sync::Arc::from("Mon"))]),
        };
        let json = serde_json::to_string(&mode).unwrap();
        eprintln!("serialized: {json}");
        // Verify the field name in the wire is camelCase as expected.
        assert!(
            json.contains("customList"),
            "expected camelCase field; got: {json}"
        );
    }

    #[test]
    fn deserialize_value_with_custom_list() {
        let json = r#"{"criteria":[{"column":0,"direction":"asc","caseSensitive":false,"mode":{"kind":"value","customList":["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]}}],"hasHeaders":false}"#;
        let opts: BridgeSortOptions = serde_json::from_str(json).expect("deserialize");
        assert_eq!(opts.criteria.len(), 1);
        let c = &opts.criteria[0];
        assert_eq!(c.column, 0);
        assert_eq!(c.direction, SortOrder::Asc);
        assert!(!c.case_sensitive);
        match &c.mode {
            BridgeSortMode::Value { custom_list } => {
                let list = custom_list.as_ref().expect("custom_list present");
                assert_eq!(list.len(), 7);
                assert!(matches!(&list[0], CellValue::Text(s) if &**s == "Mon"));
                assert!(matches!(&list[6], CellValue::Text(s) if &**s == "Sun"));
            }
            other => panic!("expected Value mode, got {other:?}"),
        }
    }

    #[test]
    fn deserialize_cell_color_with_position() {
        let json = r##"{"criteria":[{"column":0,"direction":"asc","caseSensitive":false,"mode":{"kind":"cellColor","target":"#FFFF00","position":"top"}}],"hasHeaders":false}"##;
        let opts: BridgeSortOptions = serde_json::from_str(json).expect("deserialize");
        match &opts.criteria[0].mode {
            BridgeSortMode::CellColor { target, position } => {
                assert_eq!(target, "#FFFF00");
                assert_eq!(*position, ColorPosition::Top);
            }
            other => panic!("expected CellColor mode, got {other:?}"),
        }
    }

    #[test]
    fn deserialize_value_without_custom_list() {
        let json = r#"{"criteria":[{"column":0,"direction":"asc","caseSensitive":false,"mode":{"kind":"value"}}],"hasHeaders":false}"#;
        let opts: BridgeSortOptions = serde_json::from_str(json).expect("deserialize");
        match &opts.criteria[0].mode {
            BridgeSortMode::Value { custom_list } => {
                assert!(custom_list.is_none());
            }
            other => panic!("expected Value mode, got {other:?}"),
        }
    }

    #[test]
    fn missing_mode_field_errors_clearly() {
        let json = r#"{"criteria":[{"column":0,"direction":"asc","caseSensitive":false}],"hasHeaders":false}"#;
        let err = serde_json::from_str::<BridgeSortOptions>(json).unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("missing field") && msg.contains("mode"),
            "expected missing-mode error, got: {msg}",
        );
    }
}
