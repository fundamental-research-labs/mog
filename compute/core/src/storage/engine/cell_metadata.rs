//! Immutable native metadata projection used by reference-aware evaluation.
//!
//! Engine mutation boundaries refresh this projection before evaluation. Only
//! the formatting, visibility and formula declaration metadata used here is
//! copied; cell values, history and unrelated workbook package data stay owned
//! by their canonical stores. Unchanged metadata retains its revision.
use crate::cells::{
    CellStore,
    cell_metadata::{CellMetadataProvider, CellReferenceMetadata, FormulaResultMode},
};
use crate::storage::{WorkbookStorage, properties, sheet::dimensions};
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use domain_types::RichSharedString;
use rustc_hash::FxHashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_REVISION: AtomicU64 = AtomicU64::new(1);

type FormulaDeclarations = FxHashMap<CellId, (Option<FormulaResultMode>, Option<String>)>;

#[derive(Debug)]
struct StorageCellMetadata {
    storage: WorkbookStorage,
    formulas: FormulaDeclarations,
    rich_strings: FxHashMap<CellId, RichSharedString>,
    revision: u64,
    source_revision: u64,
    layout_metrics: domain_types::units::LayoutMetrics,
}

fn has_formula_declaration(metadata: &crate::storage::CellMetadata) -> bool {
    metadata.formula_result_mode.is_some() || metadata.array_ref.is_some()
}

impl StorageCellMetadata {
    fn matches(
        &self,
        storage: &WorkbookStorage,
        layout_metrics: domain_types::units::LayoutMetrics,
    ) -> bool {
        self.source_revision == storage.metadata_revision()
            && self.layout_metrics.column_width_mdw == layout_metrics.column_width_mdw
    }
}

pub(crate) fn provider(
    storage: &WorkbookStorage,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Arc<dyn CellMetadataProvider> {
    let mut projection = WorkbookStorage::new();
    projection.metadata.style_palette = storage.metadata.style_palette.clone();
    projection.sheet_metadata = storage
        .sheet_metadata
        .iter()
        .map(|(id, metadata)| {
            let mut sheet = crate::storage::sheet::SheetMetadata {
                cell_properties: metadata.cell_properties.clone(),
                dimensions: metadata.dimensions.clone(),
                grouping: metadata.grouping.clone(),
                ..Default::default()
            };
            sheet.format.default_col_width = metadata.format.default_col_width;
            (*id, sheet)
        })
        .collect();
    let formulas = storage
        .cell_metadata
        .iter()
        .filter(|(_, metadata)| has_formula_declaration(metadata))
        .map(|(id, metadata)| {
            (
                *id,
                (metadata.formula_result_mode, metadata.array_ref.clone()),
            )
        })
        .collect();
    Arc::new(StorageCellMetadata {
        storage: projection,
        formulas,
        rich_strings: storage
            .cell_metadata
            .iter()
            .filter_map(|(id, metadata)| metadata.rich_string.clone().map(|rich| (*id, rich)))
            .collect(),
        revision: NEXT_REVISION.fetch_add(1, Ordering::Relaxed),
        source_revision: storage.metadata_revision(),
        layout_metrics,
    })
}

/// Refresh at mutation/evaluation boundaries, retaining the same provider and
/// revision when relevant metadata has not changed. Native mutation capture
/// advances the source revision even when history recording is inactive. The
/// revision comparison is O(1); a replacement copies only metadata.
pub(crate) fn refresh(
    storage: &WorkbookStorage,
    cell_store: &mut CellStore,
    layout_metrics: domain_types::units::LayoutMetrics,
) {
    let unchanged = cell_store
        .cell_metadata_provider
        .as_ref()
        .and_then(|provider| provider.as_any())
        .and_then(|provider| provider.downcast_ref::<StorageCellMetadata>())
        .is_some_and(|provider| provider.matches(storage, layout_metrics));
    if !unchanged {
        cell_store.install_cell_metadata_provider(provider(storage, layout_metrics));
    }
}

impl CellMetadataProvider for StorageCellMetadata {
    fn as_any(&self) -> Option<&dyn std::any::Any> {
        Some(self)
    }

    fn formula_result_mode(&self, _sheet: &SheetId, cell: &CellId) -> Option<FormulaResultMode> {
        self.formulas.get(cell)?.0
    }

    fn array_formula_ref(&self, _sheet: &SheetId, cell: &CellId) -> Option<String> {
        self.formulas.get(cell)?.1.clone()
    }

    fn revision(&self) -> u64 {
        self.revision
    }

    fn row_hidden(&self, cell_store: &CellStore, sheet: &SheetId, row: u32) -> Option<bool> {
        let metadata = self.storage.sheet_metadata.get(sheet)?;
        let manually_or_filter_hidden = cell_store
            .row_id_lookup(sheet, row)
            .is_some_and(|id| metadata.dimensions.row_hidden(&id));
        Some(
            manually_or_filter_hidden
                || !crate::storage::sheet::grouping::is_row_visible_by_groups(
                    &self.storage,
                    sheet,
                    row,
                ),
        )
    }

    fn is_row_filtered(&self, cell_store: &CellStore, sheet: &SheetId, row: u32) -> bool {
        dimensions::is_row_hidden_by_any_filter_id(
            &self.storage,
            sheet,
            cell_store.row_id_lookup(sheet, row),
        )
    }

    fn rich_shared_string(
        &self,
        cell_store: &CellStore,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<RichSharedString> {
        let cell = cell_store.resolve_cell_id(sheet, SheetPos::new(row, col))?;
        self.rich_strings.get(&cell).cloned()
    }

    fn query(
        &self,
        cell_store: &CellStore,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellReferenceMetadata> {
        let sheet_store = cell_store.get_sheet(sheet)?;
        let storage = &self.storage;
        let base = properties::get_workbook_base_format(storage);
        let row_format = cell_store
            .row_id_lookup(sheet, row)
            .and_then(|id| properties::get_row_format_by_id(storage, sheet, id));
        let col_format = cell_store
            .col_id_lookup(sheet, col)
            .and_then(|id| properties::get_col_format_by_id(storage, sheet, id));
        let props = cell_store
            .resolve_cell_id(sheet, SheetPos::new(row, col))
            .and_then(|id| properties::get_properties(storage, sheet, &id_to_hex(id.as_u128())));
        let cell_format = properties::materialize_cell_layer_format(props.as_ref());
        let structured =
            super::services::resolve_structured_format_at_cell(cell_store, sheet, row, col);
        let format = properties::get_effective_format_from_preloaded_layers(
            &base,
            col_format.as_ref(),
            row_format.as_ref(),
            row,
            col,
            structured.as_ref(),
            Some(&cell_format),
            Some(sheet_store),
            false,
        );
        let column_id = cell_store.col_id_lookup(sheet, col);
        let explicit_width =
            column_id.and_then(|id| dimensions::get_col_width_by_id(storage, sheet, id));
        let hidden = column_id.is_some_and(|id| {
            storage
                .sheet_metadata
                .get(sheet)
                .is_some_and(|metadata| metadata.dimensions.hidden_columns.contains(&id))
        }) || !crate::storage::sheet::grouping::is_column_visible_by_groups(
            storage, sheet, col,
        );
        let column_width = if hidden {
            0.0
        } else {
            explicit_width.map(|width| width.0).unwrap_or_else(|| {
                storage
                    .sheet_metadata
                    .get(sheet)
                    .map(|metadata| metadata.format.effective_default_col_width().0)
                    .unwrap_or(dimensions::DEFAULT_COL_WIDTH.0)
            })
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

#[cfg(test)]
mod native_metadata_tests {
    use super::*;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
    use crate::storage::engine::ComputeEngine;
    use domain_types::CellFormat;
    use value_types::CellValue;

    #[test]
    fn refresh_retains_revision_until_formula_metadata_changes() {
        let mut storage = WorkbookStorage::new();
        let mut cell_store = CellStore::new();
        let metrics = domain_types::units::LayoutMetrics::from_column_width_mdw(7.0).unwrap();
        refresh(&storage, &mut cell_store, metrics);
        let first = cell_store
            .cell_metadata_provider
            .as_ref()
            .unwrap()
            .revision();
        refresh(&storage, &mut cell_store, metrics);
        assert_eq!(
            cell_store
                .cell_metadata_provider
                .as_ref()
                .unwrap()
                .revision(),
            first
        );

        let cell = CellId::from_raw(1);
        storage.set_cell_metadata(
            cell,
            crate::storage::CellMetadata {
                formula_result_mode: Some(FormulaResultMode::Dynamic),
                array_ref: Some("A1:B2".into()),
                ..Default::default()
            },
        );
        refresh(&storage, &mut cell_store, metrics);
        let provider = cell_store.cell_metadata_provider.as_ref().unwrap();
        assert_ne!(provider.revision(), first);
        assert_eq!(
            provider.formula_result_mode(&SheetId::from_raw(1), &cell),
            Some(FormulaResultMode::Dynamic)
        );
        assert_eq!(
            provider
                .array_formula_ref(&SheetId::from_raw(1), &cell)
                .as_deref(),
            Some("A1:B2")
        );
    }

    #[test]
    fn rich_string_projection_refreshes_after_replacement_and_clear() {
        let mut storage = WorkbookStorage::new();
        let mut cell_store = CellStore::new();
        let sheet = SheetId::from_raw(1);
        let cell = CellId::from_raw(2);
        storage
            .add_sheet(&mut cell_store, sheet, "Sheet1", 10, 10)
            .unwrap();
        cell_store.apply_edit(
            &sheet,
            cell,
            SheetPos::new(0, 0),
            CellValue::from("text"),
            None,
        );
        let metrics = domain_types::units::LayoutMetrics::from_column_width_mdw(7.0).unwrap();
        for text in ["first", "second"] {
            storage.set_cell_metadata(
                cell,
                crate::storage::CellMetadata {
                    rich_string: Some(RichSharedString {
                        plain_text: text.into(),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            );
            refresh(&storage, &mut cell_store, metrics);
            assert_eq!(
                cell_store
                    .phonetic_shared_string(&sheet, 0, 0)
                    .unwrap()
                    .plain_text,
                text
            );
        }
        storage.clear_cell_metadata(cell);
        refresh(&storage, &mut cell_store, metrics);
        assert!(cell_store.phonetic_shared_string(&sheet, 0, 0).is_none());
    }

    #[test]
    fn cell_metadata_is_live_after_format_edit_and_history_replay() {
        let sheet = SheetId::from_raw(1);
        let cell = CellId::from_raw(2);
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet.to_uuid_string(),
                name: "Sheet1".into(),
                rows: 10,
                cols: 10,
                cells: vec![CellData {
                    cell_id: cell.to_uuid_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::from(12.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
                identities: vec![],
                row_axis: None,
                col_axis: None,
                ranges: vec![],
            }],
            ..Default::default()
        };
        let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
        engine.recalculate().unwrap();
        let revision = engine
            .cell_store
            .cell_metadata_provider
            .as_ref()
            .unwrap()
            .revision();
        engine
            .set_cell(
                &sheet,
                cell,
                0,
                0,
                crate::bridge_types::CellInput::Parse { text: "15".into() },
            )
            .unwrap();
        assert_eq!(
            engine
                .cell_store
                .cell_metadata_provider
                .as_ref()
                .unwrap()
                .revision(),
            revision,
            "plain edits must retain the native metadata projection"
        );
        engine.undo().unwrap();
        assert_eq!(
            engine
                .cell_store
                .cell_metadata_provider
                .as_ref()
                .unwrap()
                .revision(),
            revision,
            "value-only undo must retain sparse native replay"
        );
        let formula = "CELL(\"format\",A1)";
        engine
            .set_cell(
                &sheet,
                CellId::from_raw(3),
                0,
                1,
                crate::bridge_types::CellInput::Parse {
                    text: format!("={formula}"),
                },
            )
            .unwrap();
        engine.recalculate().unwrap();
        assert_eq!(
            engine.evaluate_expression(&sheet, formula).unwrap(),
            CellValue::from("G")
        );
        engine
            .set_cell_format(
                &sheet,
                &cell,
                &CellFormat {
                    number_format: Some("0.00".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            engine.evaluate_expression(&sheet, formula).unwrap(),
            CellValue::from("F2")
        );
        engine.recalculate().unwrap();
        assert_eq!(engine.get_cell_value(&sheet, 0, 1), CellValue::from("F2"));
        engine.undo().unwrap();
        assert_eq!(engine.get_cell_value(&sheet, 0, 1), CellValue::from("G"));
        assert_eq!(
            engine.evaluate_expression(&sheet, formula).unwrap(),
            CellValue::from("G")
        );
        engine.redo().unwrap();
        assert_eq!(engine.get_cell_value(&sheet, 0, 1), CellValue::from("F2"));
        assert_eq!(
            engine.evaluate_expression(&sheet, formula).unwrap(),
            CellValue::from("F2")
        );
    }

    #[test]
    fn table_style_changes_refresh_structured_metadata_and_dirty_calculation() {
        let sheet = SheetId::from_raw(1);
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet.to_uuid_string(),
                name: "Sheet1".into(),
                rows: 10,
                cols: 10,
                cells: vec![CellData {
                    cell_id: CellId::from_raw(2).to_uuid_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::Null,
                    formula: Some("=CELL(\"format\",A1)".into()),
                    identity_formula: None,
                    array_ref: None,
                }],
                identities: vec![],
                row_axis: None,
                col_axis: None,
                ranges: vec![],
            }],
            ..Default::default()
        };
        let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
        engine.recalculate().unwrap();
        let header_format = |engine: &ComputeEngine| {
            engine
                .cell_store
                .cell_metadata_provider
                .as_ref()
                .unwrap()
                .query(&engine.cell_store, &sheet, 0, 0)
                .unwrap()
                .format
        };
        let before = header_format(&engine);
        assert!(!engine.compute().is_dirty());
        engine.set_table_def(formula_types::TableDef {
            name: "Sales".into(),
            sheet,
            start_row: 0,
            start_col: 0,
            end_row: 2,
            end_col: 0,
            columns: vec!["Amount".into()],
            has_headers: true,
            has_totals: false,
        });
        assert!(engine.compute().is_dirty());
        let styled = header_format(&engine);
        assert_eq!(styled.bold, Some(true));
        assert_ne!(styled, before);
        engine.recalculate().unwrap();
        assert!(!engine.compute().is_dirty());
        assert_eq!(engine.get_cell_value(&sheet, 0, 2), CellValue::from("G"));

        engine
            .set_table_style("Sales", "TableStyleMedium4")
            .unwrap();
        assert!(engine.compute().is_dirty());
        assert_ne!(
            header_format(&engine).background_color,
            styled.background_color
        );
        engine.recalculate().unwrap();
        assert!(!engine.compute().is_dirty());

        engine.remove_table_def("Sales");
        assert!(engine.compute().is_dirty());
        assert_eq!(header_format(&engine), before);
        engine.recalculate().unwrap();
        assert!(!engine.compute().is_dirty());
        assert_eq!(engine.get_cell_value(&sheet, 0, 2), CellValue::from("G"));
        engine.recalculate().unwrap();
        assert!(!engine.compute().is_dirty());
    }
}
