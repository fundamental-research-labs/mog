use cell_types::{CellId, SheetId};
use rustc_hash::FxHashMap;

use crate::storage::engine::stores::EngineStores;
use crate::storage::properties::{self, CellProperties};

pub(super) fn batch_read_props_array_refs_and_formula_metadata(
    stores: &EngineStores,
    mirror: &crate::mirror::CellMirror,
    sheet_id: &SheetId,
) -> (
    FxHashMap<CellId, CellProperties>,
    FxHashMap<CellId, String>,
    FxHashMap<CellId, crate::storage::FormulaMetadata>,
    FxHashMap<CellId, domain_types::RichSharedString>,
) {
    let all_props = properties::get_all_properties(&stores.storage, sheet_id)
        .into_iter()
        .collect();

    // --- Array formula refs + formula metadata ---
    let mut array_refs = FxHashMap::default();
    let mut formula_metadata = FxHashMap::default();
    let mut rich_strings = FxHashMap::default();
    for (cell_id, metadata) in &stores.storage.cell_metadata {
        if mirror.sheet_for_cell(cell_id).as_ref() != Some(sheet_id) {
            continue;
        }
        let array_ref = metadata.array_ref.as_ref().map(|imported| {
            mirror.projection_registry.get(cell_id).map_or_else(
                || imported.clone(),
                |projection| {
                    let start = crate::storage::engine::export::pos_to_a1(
                        projection.origin_row,
                        projection.origin_col,
                    );
                    let end = crate::storage::engine::export::pos_to_a1(
                        projection.origin_row + projection.rows - 1,
                        projection.origin_col + projection.cols - 1,
                    );
                    if projection.rows == 1 && projection.cols == 1 && !imported.contains(':') {
                        start
                    } else {
                        format!("{start}:{end}")
                    }
                },
            )
        });
        if let Some(array_ref) = &array_ref {
            array_refs.insert(*cell_id, array_ref.clone());
        }
        if let Some(formula) = &metadata.formula {
            let mut formula = formula.clone();
            if formula.t == ooxml_types::worksheet::CellFormulaType::Array && array_ref.is_some() {
                formula.r#ref = array_ref;
            }
            formula_metadata.insert(*cell_id, formula);
        }
        if let Some(rich_string) = &metadata.rich_string {
            rich_strings.insert(*cell_id, rich_string.clone());
        }
    }

    (all_props, array_refs, formula_metadata, rich_strings)
}
