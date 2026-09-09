#![allow(unused_imports, unused_variables)]
use super::*;

// =====================================================================
// Tests
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
    use crate::storage::engine::ComputeEngine;
    use crate::storage::engine::mutation::CellInput;
    use cell_types::SheetPos;
    use value_types::{CellValue, FiniteF64};

    mod lifecycle;
    mod persistence_catalog;
    mod reference_updates;
    mod rename_column;

    fn simple_snapshot() -> WorkbookSnapshot {
        WorkbookSnapshot {
            axis_run_high_water_mark: None,
            identity_high_water_mark: None,
            canonical_tables: Vec::new(),
            sheets: vec![SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        }
    }

    fn sheet_id() -> SheetId {
        SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    }

    fn table_id_by_name(engine: &ComputeEngine, table_name: &str) -> String {
        engine
            .get_table_by_name(table_name)
            .unwrap_or_else(|| panic!("table {table_name} must exist"))
            .id
    }

    fn cell_value(engine: &ComputeEngine, sid: SheetId, row: u32, col: u32) -> Option<CellValue> {
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(row, col))
            .cloned()
    }

    #[test]
    fn delete_missing_table_preserves_empty_catalog() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        engine.delete_table("DoesNotExist").unwrap();
        assert!(engine.cell_store.all_tables().is_empty());
    }

    fn reload_native_snapshot(engine: &mut ComputeEngine) {
        let snapshot = crate::storage::engine::construction::build_workbook_snapshot(
            &engine.stores,
            &engine.cell_store,
        );
        assert!(
            snapshot.tables.is_empty(),
            "native snapshots emit one full table catalog"
        );
        let encoded = serde_json::to_vec(&snapshot).unwrap();
        let decoded = serde_json::from_slice(&encoded).unwrap();
        *engine = ComputeEngine::from_snapshot(decoded).unwrap().0;
    }

    // ================================================================
    // Catalog-only table persistence
    // ================================================================

    #[test]
    fn create_table_writes_catalog_only() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "Sales".into(),
                0,
                0,
                5,
                2,
                vec!["Name".into(), "Amount".into(), "Date".into()],
                true,
            )
            .expect("create_table");

        let table = engine.get_table_by_name("Sales").expect("table must exist");
        assert!(table.id.starts_with("tbl-"));
        assert_eq!(table.columns.len(), 3);
        assert!(
            table
                .columns
                .iter()
                .all(|column| column.id.starts_with("col-"))
        );
        assert_eq!(table.columns[0].name, "Name");
        assert!(table.has_header_row);
        assert!(!table.has_totals_row);
    }

    #[test]
    fn rename_table_keeps_stable_catalog_identity() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "OldName".into(),
                0,
                0,
                2,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        let table_id = table_id_by_name(&engine, "OldName");
        engine
            .rename_table("OldName", "NewName")
            .expect("rename_table");

        assert_eq!(engine.get_table_by_name("NewName").unwrap().id, table_id);
    }

    #[test]
    fn table_mutations_update_native_catalog() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "Table1".into(),
                0,
                0,
                3,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        engine
            .resize_table("Table1", 0, 0, 3, 2)
            .expect("resize_table");
        engine.toggle_totals_row("Table1").expect("toggle_totals");
        engine
            .rename_table_column("Table1", 0, "Alpha")
            .expect("rename_column");
        engine
            .set_table_bool_option("Table1", "bandedColumns", true)
            .expect("set banded columns");
        engine
            .set_table_bool_option("Table1", "bandedRows", false)
            .expect("set banded rows");
        engine
            .set_table_auto_expand("Table1", false)
            .expect("set auto expand policy");
        engine
            .set_table_auto_calculated_columns("Table1", false)
            .expect("set calculated columns policy");

        let table = engine
            .get_table_by_name("Table1")
            .expect("table must exist");
        assert_eq!(table.columns.len(), 3);
        assert_eq!(table.columns[0].name, "Alpha");
        assert!(table.has_totals_row);
        assert!(!table.banded_rows);
        assert!(table.banded_columns);
        assert!(!table.auto_expand);
        assert!(!table.auto_calculated_columns);
    }

    #[test]
    fn native_snapshot_preserves_table_columns() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "Table1".into(),
                0,
                0,
                3,
                1,
                vec!["Col1".into(), "Col2".into()],
                true,
            )
            .expect("create_table");

        // Verify the table is in the cell store
        assert_eq!(engine.get_all_tables_in_sheet(&sid).len(), 1);

        reload_native_snapshot(&mut engine);
        let tables = engine.get_all_tables_in_sheet(&sid);
        assert_eq!(
            tables.len(),
            1,
            "table must remain after native snapshot reload"
        );
        assert_eq!(tables[0].name, "Table1");
        assert_eq!(tables[0].columns.len(), 2);
        assert_eq!(tables[0].columns[0].name, "Col1");
    }

    #[test]
    fn native_snapshot_preserves_table_identity() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "Table1".into(),
                0,
                0,
                3,
                1,
                vec!["Col1".into(), "Col2".into()],
                true,
            )
            .expect("create_table");

        let catalog_table_id = engine.get_table_by_name("Table1").unwrap().id.clone();
        reload_native_snapshot(&mut engine);

        let table = engine.get_table_by_name("Table1").expect("catalog table");
        assert_eq!(table.id, catalog_table_id);
    }

    #[test]
    fn convert_to_range_removes_catalog_entry() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "Table1".into(),
                0,
                0,
                3,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        let table_id_before_convert = table_id_by_name(&engine, "Table1");
        engine
            .convert_table_to_range("Table1")
            .expect("convert_to_range");

        assert!(
            engine.get_table_by_name("Table1").is_none(),
            "convert_to_range must remove the table from the cell_store"
        );
        assert!(
            engine
                .cell_store
                .all_tables()
                .iter()
                .all(|table| table.id != table_id_before_convert)
        );
    }

    #[test]
    fn delete_table_removes_catalog_entry_without_range_binding() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "Table1".into(),
                0,
                0,
                2,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        let table_id = table_id_by_name(&engine, "Table1");
        engine.delete_table("Table1").expect("delete_table");

        assert!(
            engine.get_table_by_name("Table1").is_none(),
            "delete_table must remove the table from the cell_store"
        );
        assert!(
            engine
                .cell_store
                .all_tables()
                .iter()
                .all(|table| table.id != table_id)
        );
    }

    #[test]
    fn convert_to_range_removes_owned_filter() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "Table1".into(),
                0,
                0,
                3,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        let table_id = table_id_by_name(&engine, "Table1");
        assert!(
            engine
                .get_filters_in_sheet(&sid)
                .iter()
                .any(|filter| filter.table_id.as_deref() == Some(table_id.as_str())),
            "table creation must install an owned table filter"
        );

        engine
            .convert_table_to_range("Table1")
            .expect("convert_to_range");

        assert!(
            engine
                .get_filters_in_sheet(&sid)
                .iter()
                .all(|filter| filter.table_id.as_deref() != Some(table_id.as_str())),
            "convert_to_range must remove the table-owned filter"
        );
    }

    #[test]
    fn convert_to_range_materializes_visible_table_style() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .batch_set_cells_by_position(
                vec![
                    (
                        sid,
                        0,
                        0,
                        CellInput::Parse {
                            text: "Region".into(),
                        },
                    ),
                    (
                        sid,
                        0,
                        1,
                        CellInput::Parse {
                            text: "Amount".into(),
                        },
                    ),
                    (
                        sid,
                        1,
                        0,
                        CellInput::Parse {
                            text: "West".into(),
                        },
                    ),
                    (sid, 1, 1, CellInput::Parse { text: "10".into() }),
                    (
                        sid,
                        2,
                        0,
                        CellInput::Parse {
                            text: "East".into(),
                        },
                    ),
                    (sid, 2, 1, CellInput::Parse { text: "20".into() }),
                ],
                false,
            )
            .expect("seed table data");

        engine
            .create_table(
                &sid,
                "Table1".into(),
                0,
                0,
                2,
                1,
                vec!["Region".into(), "Amount".into()],
                true,
            )
            .expect("create_table");

        let header_before = engine.get_resolved_format(&sid, 0, 0);
        let banded_before = engine.get_resolved_format(&sid, 2, 0);
        assert!(
            header_before.background_color.is_some(),
            "default table style should format the header row"
        );
        assert!(
            banded_before.background_color.is_some(),
            "default table style should format banded data rows"
        );

        engine
            .convert_table_to_range("Table1")
            .expect("convert_to_range");

        assert!(
            engine.get_table_by_name("Table1").is_none(),
            "convert_to_range must remove the table"
        );
        assert!(
            engine.resolve_table_format_at_cell(&sid, 0, 0).is_none(),
            "post-convert style must not come from a table layer"
        );

        let header_after = engine.get_resolved_format(&sid, 0, 0);
        let banded_after = engine.get_resolved_format(&sid, 2, 0);
        assert_eq!(
            header_after.background_color,
            header_before.background_color
        );
        assert_eq!(header_after.font_color, header_before.font_color);
        assert_eq!(header_after.bold, header_before.bold);
        assert_eq!(
            banded_after.background_color,
            banded_before.background_color
        );
    }

    #[test]
    fn custom_table_style_mutation_updates_native_metadata_and_export() {
        let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let style = compute_table::custom_styles::CustomTableStyleConfig {
            id: "custom-1".to_string(),
            name: "CustomExportStyle".to_string(),
            created_at: 1.0,
            updated_at: 1.0,
            header_row: Default::default(),
            total_row: Default::default(),
            first_column: Default::default(),
            last_column: Default::default(),
            row_stripes: Default::default(),
            column_stripes: Default::default(),
            whole_table: Default::default(),
        };

        engine
            .create_custom_table_style(style)
            .expect("create custom table style");

        let exported = engine.build_parse_output();
        assert!(
            exported
                .custom_table_styles
                .iter()
                .any(|style| style.name == "CustomExportStyle")
        );
        assert!(
            engine
                .stores
                .storage
                .metadata
                .custom_table_styles
                .contains_key("CustomExportStyle")
        );
        let bytes = engine.export_to_xlsx_bytes().unwrap();
        let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
        assert!(
            reloaded
                .stores
                .storage
                .metadata
                .custom_table_styles
                .contains_key("CustomExportStyle")
        );
        engine
            .delete_custom_table_style("CustomExportStyle")
            .unwrap();
        assert!(
            !engine
                .stores
                .storage
                .metadata
                .custom_table_styles
                .contains_key("CustomExportStyle")
        );
    }
}
