#![allow(unused_imports, unused_variables)]
use super::*;

// =====================================================================
// Tests
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
    use crate::storage::engine::YrsComputeEngine;
    use crate::storage::engine::mutation::CellInput;
    use cell_types::SheetPos;
    use value_types::{CellValue, FiniteF64};
    use yrs::Any;

    mod lifecycle;
    mod persistence_catalog;
    mod rename_column;

    fn simple_snapshot() -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
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

    fn table_id_by_name(engine: &YrsComputeEngine, table_name: &str) -> String {
        engine
            .get_table_by_name(table_name)
            .unwrap_or_else(|| panic!("table {table_name} must exist"))
            .id
    }

    fn set_people_data(engine: &mut YrsComputeEngine, sid: SheetId) {
        engine
            .batch_set_cells_by_position(
                vec![
                    (
                        sid,
                        0,
                        0,
                        CellInput::Parse {
                            text: "Name".into(),
                        },
                    ),
                    (
                        sid,
                        1,
                        0,
                        CellInput::Parse {
                            text: "Alice".into(),
                        },
                    ),
                    (sid, 0, 1, CellInput::Parse { text: "Age".into() }),
                    (sid, 1, 1, CellInput::Parse { text: "30".into() }),
                ],
                false,
            )
            .expect("set people data");
    }

    fn cell_value(
        engine: &YrsComputeEngine,
        sid: SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellValue> {
        engine
            .mirror()
            .get_cell_value_at(&sid, SheetPos::new(row, col))
            .cloned()
    }

    /// pass 1 regression (Edit A behavioural pin): removing a
    /// non-existent table must not panic. After the fix, the call
    /// lazily creates an empty `tables` sub-map (which itself is an
    /// undoable txn entry) and the table-name removal is a no-op.
    #[test]
    fn remove_table_from_yrs_on_missing_table_does_not_panic() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        // Deliberately call into the service helper at a place where
        // the table doesn't exist. delete_table on a missing name is
        // an Err at the service layer; we drive the persist site
        // directly via a private helper test.
        //
        // Use the private filter-aware helper directly. The cleanest
        // public call shape is `delete_table` for a name that exists,
        // but here we want the missing-table path. The bridge call
        // returns Err for a missing name, so we invoke the persistence
        // site directly to exercise the lazy-create branch.
        {
            // Reach into stores via crate-private access; the test
            // module lives inside the crate.
            remove_table_from_yrs_with_filter(&mut engine.stores, "DoesNotExist", None, None);
        }

        // (a) no panic: reaching this line is the proof.
        // (b) mirror still has zero tables.
        assert!(
            engine.get_all_tables_in_sheet(&sid).is_empty(),
            "mirror should still be empty after removing a non-existent table"
        );

        // (c) yrs `tables` sub-map exists and is empty.
        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let tables_map = match workbook.get(&txn, compute_document::schema::KEY_TABLES) {
            Some(Out::YMap(m)) => m,
            _ => panic!("tables sub-map must exist after lazy-create"),
        };
        assert_eq!(
            tables_map.len(&txn),
            0,
            "tables sub-map must be empty (we only created the container, never inserted a table)"
        );
    }

    // ================================================================
    // Catalog-only table persistence
    // ================================================================

    fn workbook_table_range_binding_entries(engine: &YrsComputeEngine) -> Vec<(String, String)> {
        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let Some(Out::YMap(bindings_map)) =
            workbook.get(&txn, compute_document::schema::KEY_RANGE_BINDINGS)
        else {
            return Vec::new();
        };
        bindings_map
            .iter(&txn)
            .filter_map(|(key, value)| {
                if !key.starts_with("table:") {
                    return None;
                }
                let Out::Any(Any::String(json)) = value else {
                    return None;
                };
                Some((key.to_string(), json.to_string()))
            })
            .collect()
    }

    #[test]
    fn create_table_writes_catalog_only() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
        assert!(
            workbook_table_range_binding_entries(&engine).is_empty(),
            "table catalog writes must not create workbook rangeBindings entries"
        );
    }

    #[test]
    fn rename_table_keeps_stable_catalog_identity_without_range_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
        assert!(
            workbook_table_range_binding_entries(&engine).is_empty(),
            "rename must not create table rangeBindings entries"
        );
    }

    #[test]
    fn table_mutations_update_catalog_without_range_bindings() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
        assert!(
            workbook_table_range_binding_entries(&engine).is_empty(),
            "table mutations must persist through workbook.tables only"
        );
    }

    #[test]
    fn sync_tables_uses_catalog_only() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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

        // Verify the table is in the mirror
        assert_eq!(engine.get_all_tables_in_sheet(&sid).len(), 1);

        // Simulate undo + redo to trigger sync_tables_from_yrs
        engine.undo().expect("undo");
        assert!(
            engine.get_all_tables_in_sheet(&sid).is_empty(),
            "table must be gone after undo"
        );

        engine.redo().expect("redo");
        let tables = engine.get_all_tables_in_sheet(&sid);
        assert_eq!(tables.len(), 1, "table must be back after redo");
        assert_eq!(tables[0].name, "Table1");
        assert_eq!(tables[0].columns.len(), 2);
        assert_eq!(tables[0].columns[0].name, "Col1");
        assert!(
            workbook_table_range_binding_entries(&engine).is_empty(),
            "undo/redo sync must not recreate table rangeBindings entries"
        );
    }

    #[test]
    fn sync_tables_does_not_create_workbook_range_binding_entries() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
        sync_tables_from_yrs(&mut engine.stores, &mut engine.mirror);

        let table = engine.get_table_by_name("Table1").expect("catalog table");
        assert_eq!(table.id, catalog_table_id);
        assert!(
            workbook_table_range_binding_entries(&engine).is_empty(),
            "table sync must not consult or create workbook rangeBindings entries"
        );
    }

    #[test]
    fn convert_to_range_removes_catalog_entry() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
            "convert_to_range must remove the table from the mirror"
        );
        assert!(
            workbook_table_range_binding_entries(&engine).is_empty(),
            "convert_to_range must not leave table rangeBindings entries"
        );
        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        if let Some(Out::YMap(tables_map)) =
            workbook.get(&txn, compute_document::schema::KEY_TABLES)
        {
            assert!(
                tables_map
                    .get(&txn, table_id_before_convert.as_str())
                    .is_none(),
                "convert_to_range must remove the id-keyed catalog entry"
            );
        }
    }

    #[test]
    fn delete_table_removes_catalog_entry_without_range_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
            "delete_table must remove the table from the mirror"
        );
        assert!(
            workbook_table_range_binding_entries(&engine).is_empty(),
            "delete_table must not leave table rangeBindings entries"
        );
        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        if let Some(Out::YMap(tables_map)) =
            workbook.get(&txn, compute_document::schema::KEY_TABLES)
        {
            assert!(
                tables_map.get(&txn, table_id.as_str()).is_none(),
                "delete_table must remove the id-keyed catalog entry"
            );
        }
    }

    #[test]
    fn convert_to_range_removes_owned_filter() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
    fn custom_table_style_mutation_persists_to_yrs_and_export() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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

        let exported = engine.build_parse_output_from_yrs();
        assert!(
            exported
                .custom_table_styles
                .iter()
                .any(|style| style.name == "CustomExportStyle")
        );
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let workbook = engine.stores.storage.workbook_map();
        let styles_map = match workbook.get(&txn, compute_document::schema::KEY_CUSTOM_TABLE_STYLES)
        {
            Some(yrs::Out::YMap(map)) => map,
            _ => panic!("custom table styles map should exist"),
        };
        assert!(styles_map.get(&txn, "CustomExportStyle").is_some());
    }
}
