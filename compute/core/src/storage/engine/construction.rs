//! Shared construction helpers for `YrsComputeEngine`.
//!
//! Deduplicates the grid-index, merge-index, layout-index, observer, undo-manager,
//! locale, and theme-palette creation that was previously copy-pasted across
//! `from_snapshot`, `from_xlsx_bytes`, `import_from_xlsx_bytes`, and
//! `import_from_xlsx_bytes_no_recalc`.

use std::collections::HashMap;
use std::sync::Arc;

use rustc_hash::FxHashMap;
use yrs::{Any, Array, Map, Out, Transact};

use cell_types::{AxisIdentityStore, CellId, ColId, IdAllocator, RowId, SheetId};
use compute_layout_index::LayoutIndex;
use value_types::ComputeError;

use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::range_manager::RangeSpatialIndex;
use crate::scheduler::ComputeCore;
use crate::snapshot::{RecalcResult, SheetSnapshot, WorkbookSnapshot};
use crate::storage::YrsStorage;
use crate::storage::sheet::{dimensions, grouping, merges};
use crate::storage::workbook::{
    named_ranges as workbook_named_ranges, settings as workbook_settings,
};
use domain_types::{self, ImportedCellProjectionRole};
use formula_types::{NamedRangeDef, Scope, WorkbookLookup};

use super::queries::{MergeRangeRef, MergeSpatialItem};
use super::settings::EngineSettings;
use super::stores::EngineStores;
use super::viewport::service::ViewportService;
use super::{MutationCoordinator, YrsComputeEngine};
use compute_document::hex::hex_to_id;
use compute_document::observe::DocumentObserver;
use compute_document::undo::UndoRedoManager;

mod assembly;
mod csv;
mod deferred;
mod indexes;
mod named_ranges;
mod range_styles;
mod runtime;
mod sheet_import;
mod snapshots;
mod types;
mod xlsx;

pub(super) use assembly::{
    assemble_engine, assemble_engine_with_alloc, from_snapshot, from_yrs_state,
    rebuild_engine_from_snapshot, snapshot_id_high_water_mark,
};
pub(super) use csv::{from_csv_bytes, import_from_csv_bytes};
pub(super) use deferred::{
    commit_deferred_hydration, import_from_xlsx_bytes_deferred, stage_deferred_hydration,
};
pub(super) use indexes::{
    build_grid_indexes_from_allocations_range, build_grid_indexes_from_yrs,
    build_layout_index_for_sheet, build_layout_indexes,
    build_layout_indexes_from_parse_output_range, build_merge_indexes,
    build_merge_indexes_from_parse_output_range,
};
pub(super) use named_ranges::{
    YrsIdentityFormulaLookup, defined_names_to_named_range_defs, normalize_named_range_refs,
    normalized_defined_name_text_lost_opaque_ref,
};
pub(super) use range_styles::{
    build_imported_range_style_plan, coalesce_imported_style_positions, range_style_formats_enabled,
};
pub(super) use runtime::{
    create_observer_and_undo, derive_settings, hydrate_mirror_format_ranges,
    load_custom_cell_styles, load_theme_palette, sync_enable_calculation_flags,
};
pub(super) use sheet_import::import_sheets_from_xlsx;
pub use snapshots::build_workbook_snapshot_from_yrs;
pub(super) use snapshots::{
    build_sheet_snapshot, build_sheet_snapshot_from_yrs, build_workbook_snapshot,
    read_tables_from_yrs,
};
pub(super) use types::{DeferredHydrationCompletion, DeferredHydrationData, XlsxHydrateResult};
pub(super) use xlsx::{from_xlsx_bytes, import_from_xlsx_bytes, parse_and_hydrate_xlsx};

#[cfg(test)]
mod tests {
    use super::{build_imported_range_style_plan, normalized_defined_name_text_lost_opaque_ref};
    use crate::storage::infra::hydration::{DefaultIdAllocator, allocate_sheet_ids};
    use cell_types::{PayloadEncoding, RangeAnchor, RangeId, RangeKind};
    use domain_types::{CellData, SheetData};
    use snapshot_types::RangeData;
    use value_types::{CellValue, FiniteF64};

    fn identity_template(template: &str) -> formula_types::IdentityFormula {
        formula_types::IdentityFormula {
            template: template.to_string(),
            refs: Vec::new(),
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }
    }

    #[test]
    fn detects_opaque_defined_name_reference_lost_during_normalization() {
        let identity = identity_template("PRINTLOC");

        assert!(normalized_defined_name_text_lost_opaque_ref(
            "'FX Build'!PRINTLOC",
            &identity
        ));
    }

    #[test]
    fn unchanged_no_ref_defined_name_template_does_not_need_raw_preservation() {
        let identity = identity_template("0.01");

        assert!(!normalized_defined_name_text_lost_opaque_ref(
            "0.01", &identity
        ));
    }

    #[test]
    fn imported_range_style_plan_preserves_sparse_row_holes() {
        let sheet = SheetData {
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 4,
            cells: vec![
                CellData {
                    row: 0,
                    col: 3,
                    value: CellValue::Number(FiniteF64::must(1.0)),
                    style_id: Some(18),
                    ..Default::default()
                },
                CellData {
                    row: 1,
                    col: 3,
                    value: CellValue::Number(FiniteF64::must(2.0)),
                    style_id: Some(18),
                    ..Default::default()
                },
                CellData {
                    row: 3,
                    col: 3,
                    value: CellValue::Number(FiniteF64::must(3.0)),
                    style_id: Some(18),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let mut allocator = DefaultIdAllocator::new();
        let alloc = allocate_sheet_ids(&sheet, &mut allocator);
        let range = RangeData {
            range_id: RangeId::from_raw(123),
            kind: RangeKind::Data,
            anchor: RangeAnchor::Elastic {
                start_row: alloc.row_ids[0],
                end_row: alloc.row_ids[3],
                start_col: alloc.col_ids[3],
                end_col: alloc.col_ids[3],
            },
            encoding: PayloadEncoding::MixedCbor,
            payload: Vec::new(),
            row_axis: None,
            col_axis: None,
            row_ids: vec![alloc.row_ids[0], alloc.row_ids[1], alloc.row_ids[3]],
            col_ids: vec![alloc.col_ids[3]],
        };

        let (_positions, styles) =
            build_imported_range_style_plan(&sheet, &alloc, &[range], &mut allocator);

        let rects: Vec<_> = styles
            .iter()
            .map(|style| {
                (
                    style.start_row,
                    style.start_col,
                    style.end_row,
                    style.end_col,
                    style.style_id,
                )
            })
            .collect();
        assert_eq!(rects, vec![(0, 3, 1, 3, 18), (3, 3, 3, 3, 18)]);
    }
}
