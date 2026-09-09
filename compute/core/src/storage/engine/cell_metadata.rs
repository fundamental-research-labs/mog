//! Read-only adapter from formula metadata queries to the canonical live
//! formatting cascade. Cloned Doc/MapRef handles share the engine document;
//! no mutation methods escape through the provider interface. Each query
//! releases its read transactions before evaluation continues.
use crate::mirror::{
    CellMirror,
    cell_metadata::{CellMetadataProvider, CellReferenceMetadata, FormulaResultMode},
};
use crate::storage::{YrsStorage, properties, sheet::dimensions};
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use domain_types::RichSharedString;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use yrs::{Any, Map, Out, Transact};

struct StorageCellMetadata {
    storage: YrsStorage,
    revision: Arc<AtomicU64>,
    layout_metrics: domain_types::units::LayoutMetrics,
    _subscription: yrs::Subscription,
}

impl std::fmt::Debug for StorageCellMetadata {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StorageCellMetadata")
            .finish_non_exhaustive()
    }
}

pub(crate) fn provider(
    storage: &YrsStorage,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Arc<dyn CellMetadataProvider> {
    let revision = Arc::new(AtomicU64::new(0));
    let updates = Arc::clone(&revision);
    let subscription = storage
        .doc()
        .observe_update_v1(move |_, _| {
            updates.fetch_add(1, Ordering::Relaxed);
        })
        .expect("metadata observer installed outside transactions");
    Arc::new(StorageCellMetadata {
        revision,
        layout_metrics,
        _subscription: subscription,
        storage: YrsStorage {
            doc: storage.doc().clone(),
            workbook: storage.workbook_map().clone(),
            sheets: storage.sheets().clone(),
        },
    })
}

impl CellMetadataProvider for StorageCellMetadata {
    fn formula_result_mode(&self, sheet: &SheetId, cell: &CellId) -> Option<FormulaResultMode> {
        let txn = self.storage.doc().transact();
        let cells = crate::storage::infra::grid_helpers::get_cells_map(
            &txn,
            self.storage.sheets(),
            &id_to_hex(sheet.as_u128()),
        )?;
        let Out::YMap(map) = cells.get(&txn, &id_to_hex(cell.as_u128()))? else {
            return None;
        };
        let Out::Any(Any::String(value)) =
            map.get(&txn, compute_document::schema::KEY_FORMULA_RESULT_MODE)?
        else {
            return None;
        };
        serde_json::from_str(&value).ok()
    }
    fn array_formula_ref(&self, sheet: &SheetId, cell: &CellId) -> Option<String> {
        let txn = self.storage.doc().transact();
        let cells = crate::storage::infra::grid_helpers::get_cells_map(
            &txn,
            self.storage.sheets(),
            &id_to_hex(sheet.as_u128()),
        )?;
        let Out::YMap(map) = cells.get(&txn, &id_to_hex(cell.as_u128()))? else {
            return None;
        };
        compute_document::cell_serde::read_array_ref_from_yrs(&map, &txn)
    }

    fn revision(&self) -> u64 {
        self.revision.load(Ordering::Relaxed)
    }
    fn row_hidden(&self, sheet: &SheetId, row: u32) -> Option<bool> {
        Some(
            dimensions::get_row_visibility_ownership(
                self.storage.doc(),
                self.storage.sheets(),
                sheet,
                row,
                None,
            )
            .effective_hidden,
        )
    }
    fn is_row_filtered(&self, mirror: &CellMirror, sheet: &SheetId, row: u32) -> bool {
        dimensions::is_row_hidden_by_any_filter_id(
            self.storage.doc(),
            self.storage.sheets(),
            sheet,
            mirror.row_id_lookup(sheet, row),
        )
    }
    fn rich_shared_string(
        &self,
        mirror: &CellMirror,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<RichSharedString> {
        let mirror_cell = mirror.resolve_cell_id(sheet, SheetPos::new(row, col));
        let storage_cell = self.storage.read_cell_id_at_pos(sheet, row, col);
        let txn = self.storage.doc().transact();
        let cells = crate::storage::infra::grid_helpers::get_cells_map(
            &txn,
            self.storage.sheets(),
            &id_to_hex(sheet.as_u128()),
        )?;

        for cell in [mirror_cell, storage_cell].into_iter().flatten() {
            let Some(Out::YMap(cell_map)) = cells.get(&txn, &id_to_hex(cell.as_u128())) else {
                continue;
            };
            if let Some(rich_string) =
                compute_document::cell_serde::read_rich_string_from_yrs(&cell_map, &txn)
            {
                return Some(rich_string);
            }
        }
        None
    }
    fn query(
        &self,
        mirror: &CellMirror,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellReferenceMetadata> {
        let sheet_mirror = mirror.get_sheet(sheet)?;
        let storage = &self.storage;
        let base = properties::get_workbook_base_format(storage);
        let row_format = mirror
            .row_id_lookup(sheet, row)
            .and_then(|id| properties::get_row_format_by_id(storage, sheet, id));
        let col_format = mirror
            .col_id_lookup(sheet, col)
            .and_then(|id| properties::get_col_format_by_id(storage, sheet, id));
        let props = mirror
            .resolve_cell_id(sheet, SheetPos::new(row, col))
            .or_else(|| storage.read_cell_id_at_pos(sheet, row, col))
            .and_then(|id| {
                properties::get_properties(
                    storage.doc(),
                    storage.workbook_map(),
                    storage.sheets(),
                    sheet,
                    &id_to_hex(id.as_u128()),
                )
            });
        let cell_format = properties::materialize_cell_layer_format(props.as_ref());
        let structured =
            super::services::resolve_structured_format_at_cell(mirror, sheet, row, col);
        let format = properties::get_effective_format_from_preloaded_layers(
            &base,
            col_format.as_ref(),
            row_format.as_ref(),
            row,
            col,
            structured.as_ref(),
            Some(&cell_format),
            Some(sheet_mirror),
            false,
        );
        let explicit_width = mirror.col_id_lookup(sheet, col).and_then(|id| {
            dimensions::get_col_width_by_id(storage.doc(), storage.sheets(), sheet, id)
        });
        let column_width =
            if dimensions::is_column_hidden(storage.doc(), storage.sheets(), sheet, col)
                || !crate::storage::sheet::grouping::is_column_visible_by_groups(
                    storage.doc(),
                    storage.sheets(),
                    sheet,
                    col,
                )
            {
                0.0
            } else {
                explicit_width
                    .unwrap_or_else(|| {
                        dimensions::get_sheet_default_col_width(
                            storage.doc(),
                            storage.sheets(),
                            sheet,
                        )
                    })
                    .0
            };
        Some(CellReferenceMetadata {
            format,
            column_width: display_character_width(
                column_width,
                self.layout_metrics.column_width_mdw,
            ),
            column_width_is_default: explicit_width.is_none(),
        })
    }
}

/// OOXML stores character width including five pixels of cell padding. CELL
/// reports the display character count. Use the engine's explicit layout
/// metric contract, including the browser-supplied platform MDW, rather than
/// guessing a font or treating the serialized width as the visible count.
/// https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.column
fn display_character_width(serialized_width: f64, mdw: f64) -> f64 {
    if serialized_width <= 0.0 {
        return 0.0;
    }
    let pixels = (((256.0 * serialized_width + (128.0 / mdw).trunc()) / 256.0) * mdw).trunc();
    (((pixels - 5.0) / mdw * 100.0 + 0.5).trunc() / 100.0).max(0.0)
}

#[cfg(test)]
mod width_tests {
    use super::display_character_width;
    #[test]
    fn cell_width_excludes_ooxml_padding_and_uses_supplied_metric() {
        // ISO/IEC29500's worked example: 8 characters at MDW7 => raw8.7109375.
        assert_eq!(display_character_width(8.7109375, 7.0), 8.0);
        assert_eq!(display_character_width(8.625, 8.0), 8.0);
        assert_eq!(display_character_width(8.7109375, 14.0), 8.36);
        assert_eq!(display_character_width(0.0, 7.0), 0.0);
    }
}
