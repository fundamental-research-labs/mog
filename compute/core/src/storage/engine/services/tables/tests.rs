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

    /// pass 1 regression: creating a table via the production
    /// `from_snapshot` engine path must push an entry onto the
    /// undo stack and a subsequent `undo()` must remove it.
    ///
    /// Pre-fix symptom: `persist_table_to_yrs` silently returns
    /// when `KEY_TABLES` sub-map doesn't exist; the txn drops with
    /// no changes, the undo manager has nothing to push, and
    /// `can_undo()` stays false.
    #[test]
    fn create_table_pushes_undo_entry() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        assert!(
            !engine.can_undo(),
            "fresh engine must have empty undo stack"
        );

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

        assert!(
            engine.can_undo(),
            "create_table must push an undo entry — pre-fix this fails because \
             persist_table_to_yrs silently returned"
        );

        engine.undo().expect("undo");
        assert!(
            engine.get_all_tables_in_sheet(&sid).is_empty(),
            "undo must remove the table"
        );
    }

    #[test]
    fn create_table_persists_table_filter_in_rust() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        let (_, result) = engine
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

        let sheet_filters = engine.get_filters_in_sheet(&sid);
        let table_filter = sheet_filters
            .iter()
            .find(|filter| filter.table_id.as_deref() == Some("Table1"))
            .expect("table filter");
        assert_eq!(table_filter.filter_kind, filters::FilterKind::TableFilter);

        let change = result
            .filter_changes
            .iter()
            .find(|change| change.filter_id == table_filter.id)
            .expect("table filter creation receipt");
        assert_eq!(change.filter_kind.as_deref(), Some("tableFilter"));
        assert_eq!(change.action.as_deref(), Some("created"));

        engine.delete_table("Table1").expect("delete_table");
        assert!(
            engine.get_filters_in_sheet(&sid).is_empty(),
            "deleting a table must remove its owned table filter"
        );
    }

    #[test]
    fn create_table_lifecycle_with_style_undo_redo_is_atomic() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        set_people_data(&mut engine, sid);
        let before_depth = engine.get_undo_state().undo_depth;

        let (_patches, result) = engine
            .create_table_lifecycle(
                &sid,
                Some("StyledPeople".into()),
                0,
                0,
                1,
                1,
                vec![],
                true,
                Some("TableStyleMedium4".into()),
            )
            .expect("create lifecycle");

        assert_eq!(engine.get_undo_state().undo_depth, before_depth + 1);
        assert!(
            result.table_changes.iter().any(|change| {
                change.name == "StyledPeople"
                    && change.sheet_id == sid.to_uuid_string()
                    && change.kind == ChangeKind::Set
            }),
            "table creation must report a table change so viewport formatting refreshes before repaint"
        );
        let table = engine
            .get_table_by_name("StyledPeople")
            .expect("styled table");
        assert_eq!(table.style, "TableStyleMedium4");
        assert!(
            engine
                .get_filters_in_sheet(&sid)
                .iter()
                .any(|filter| filter.table_id.as_deref() == Some("StyledPeople")),
            "table filter should be created with the table"
        );

        engine.undo().expect("undo lifecycle");
        assert_eq!(engine.get_undo_state().undo_depth, before_depth);
        assert!(engine.get_table_by_name("StyledPeople").is_none());
        assert!(
            engine
                .get_filters_in_sheet(&sid)
                .iter()
                .all(|filter| filter.table_id.as_deref() != Some("StyledPeople")),
            "one undo should remove the table-owned filter"
        );

        engine.redo().expect("redo lifecycle");
        let redone = engine
            .get_table_by_name("StyledPeople")
            .expect("redone table");
        assert_eq!(redone.style, "TableStyleMedium4");
        assert!(
            engine
                .get_filters_in_sheet(&sid)
                .iter()
                .any(|filter| filter.table_id.as_deref() == Some("StyledPeople")),
            "redo should restore the table-owned filter"
        );
    }

    #[test]
    fn create_table_lifecycle_without_headers_undo_redo_is_atomic() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        set_people_data(&mut engine, sid);
        let before_depth = engine.get_undo_state().undo_depth;

        engine
            .create_table_lifecycle(
                &sid,
                Some("GeneratedHeaders".into()),
                0,
                0,
                1,
                1,
                vec![],
                false,
                None,
            )
            .expect("create no-header lifecycle");

        assert_eq!(engine.get_undo_state().undo_depth, before_depth + 1);
        assert_eq!(
            cell_value(&engine, sid, 0, 0),
            Some(CellValue::Text("Column1".into()))
        );
        assert_eq!(
            cell_value(&engine, sid, 1, 0),
            Some(CellValue::Text("Name".into()))
        );
        assert!(engine.get_table_by_name("GeneratedHeaders").is_some());

        engine.undo().expect("undo no-header lifecycle");
        assert_eq!(engine.get_undo_state().undo_depth, before_depth);
        assert!(engine.get_table_by_name("GeneratedHeaders").is_none());
        assert_eq!(
            cell_value(&engine, sid, 0, 0),
            Some(CellValue::Text("Name".into()))
        );
        assert_eq!(
            cell_value(&engine, sid, 1, 0),
            Some(CellValue::Text("Alice".into()))
        );
        assert_eq!(
            cell_value(&engine, sid, 1, 1),
            Some(CellValue::Number(FiniteF64::must(30.0)))
        );

        engine.redo().expect("redo no-header lifecycle");
        assert_eq!(
            cell_value(&engine, sid, 0, 0),
            Some(CellValue::Text("Column1".into()))
        );
        assert_eq!(
            cell_value(&engine, sid, 1, 0),
            Some(CellValue::Text("Name".into()))
        );
        assert!(engine.get_table_by_name("GeneratedHeaders").is_some());
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
        // Use the private helper: route through `remove_table_from_yrs`
        // by exposing it via the same module. The cleanest call shape
        // from the test is via `delete_table` for a name that exists,
        // but here we want the *missing-table* path. The bridge call
        // returns Err for missing name; we instead invoke the persist
        // site directly so we exercise the lazy-create branch.
        {
            // Reach into stores via crate-private access; the test
            // module lives inside the crate.
            remove_table_from_yrs(&mut engine.stores, "DoesNotExist");
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
    // Phase 5E tests — Range-backed table bindings
    // ================================================================

    /// Creating a table writes a TableBinding to rangeBindings.
    #[test]
    fn create_table_writes_range_binding() {
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

        // Verify rangeBindings entry exists
        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:Sales");
        assert!(
            json.is_some(),
            "rangeBindings[table:Sales] must exist after create_table"
        );

        // Verify the binding deserializes correctly
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json.unwrap()).expect("deserialize TableBinding");
        assert_eq!(binding.name, "Sales");
        assert_eq!(binding.columns.len(), 3);
        assert_eq!(binding.columns[0].name, "Name");
        assert_eq!(binding.columns[1].name, "Amount");
        assert_eq!(binding.columns[2].name, "Date");
        assert!(binding.has_header_row);
        assert!(!binding.has_totals_row);
    }

    /// Deleting a table removes its rangeBindings entry.
    #[test]
    fn delete_table_removes_range_binding() {
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

        engine.delete_table("Table1").expect("delete_table");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:Table1");
        assert!(
            json.is_none(),
            "rangeBindings[table:Table1] must be removed after delete_table"
        );
    }

    /// Renaming a table updates the rangeBindings entry (old key removed, new key added).
    #[test]
    fn rename_table_updates_range_binding() {
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

        engine
            .rename_table("OldName", "NewName")
            .expect("rename_table");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();

        assert!(
            compute_document::range::read_range_binding_wb(&workbook, &txn, "table:OldName")
                .is_none(),
            "old binding key must be removed"
        );
        let new_json =
            compute_document::range::read_range_binding_wb(&workbook, &txn, "table:NewName");
        assert!(new_json.is_some(), "new binding key must exist");

        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&new_json.unwrap()).unwrap();
        assert_eq!(binding.name, "NewName");
    }

    /// Resizing a table updates the rangeBindings (columns may change).
    #[test]
    fn resize_table_updates_range_binding() {
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

        // Expand columns
        engine
            .resize_table("Table1", 0, 0, 3, 2)
            .expect("resize_table");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:Table1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert_eq!(
            binding.columns.len(),
            3,
            "expanding to 3 columns must add a column definition"
        );
    }

    /// Toggling totals row updates the rangeBindings.
    #[test]
    fn toggle_totals_updates_range_binding() {
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

        engine.toggle_totals_row("Table1").expect("toggle_totals");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:Table1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert!(
            binding.has_totals_row,
            "totals row must be true after toggle"
        );
    }

    /// Renaming a column updates the rangeBindings.
    #[test]
    fn rename_column_updates_range_binding() {
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
            .rename_table_column("Table1", 0, "Alpha")
            .expect("rename_column");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:Table1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert_eq!(
            binding.columns[0].name, "Alpha",
            "column name must be updated in binding"
        );
    }

    /// Three-tier read: sync_tables_from_yrs uses rangeBindings (Tier 1) when available.
    #[test]
    fn sync_tables_uses_range_binding_tier1() {
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
    }

    /// TableBinding roundtrip: from_table -> to_table preserves all fields.
    #[test]
    fn table_binding_roundtrip() {
        use domain_types::domain::table::{TableBinding, TotalsFunction};

        let original = CanonicalTable {
            id: "42".to_string(),
            name: "Inventory".to_string(),
            display_name: "InventoryDisplay".to_string(),
            sheet_id: "sheet-1".to_string(),
            range: cell_types::SheetRange::new(2, 1, 10, 4),
            columns: vec![
                TableColumn {
                    id: "1".into(),
                    name: "Item".into(),
                    index: 0,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
                TableColumn {
                    id: "2".into(),
                    name: "Qty".into(),
                    index: 1,
                    totals_function: Some(TotalsFunction::Sum),
                    totals_label: Some("Total".into()),
                    calculated_formula: None,
                },
                TableColumn {
                    id: "3".into(),
                    name: "Price".into(),
                    index: 2,
                    totals_function: Some(TotalsFunction::Average),
                    totals_label: None,
                    calculated_formula: Some("=[Qty]*[Price]".into()),
                },
                TableColumn {
                    id: "4".into(),
                    name: "Total".into(),
                    index: 3,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
            ],
            has_header_row: true,
            has_totals_row: true,
            style: "TableStyleDark5".to_string(),
            banded_rows: false,
            banded_columns: true,
            emphasize_first_column: true,
            emphasize_last_column: false,
            show_filter_buttons: false,
            auto_expand: false,
            auto_calculated_columns: false,
        };

        let binding = TableBinding::from_table(&original);
        let reconstructed = binding.to_table(&original.id, &original.sheet_id, original.range);

        assert_eq!(reconstructed.name, original.name);
        assert_eq!(reconstructed.display_name, original.display_name);
        assert_eq!(reconstructed.sheet_id, original.sheet_id);
        assert_eq!(reconstructed.range, original.range);
        assert_eq!(reconstructed.has_header_row, original.has_header_row);
        assert_eq!(reconstructed.has_totals_row, original.has_totals_row);
        assert_eq!(reconstructed.style, original.style);
        assert_eq!(reconstructed.banded_rows, original.banded_rows);
        assert_eq!(reconstructed.banded_columns, original.banded_columns);
        assert_eq!(
            reconstructed.emphasize_first_column,
            original.emphasize_first_column
        );
        assert_eq!(
            reconstructed.emphasize_last_column,
            original.emphasize_last_column
        );
        assert_eq!(
            reconstructed.show_filter_buttons,
            original.show_filter_buttons
        );
        assert_eq!(reconstructed.auto_expand, original.auto_expand);
        assert_eq!(
            reconstructed.auto_calculated_columns,
            original.auto_calculated_columns
        );
        assert_eq!(reconstructed.columns.len(), original.columns.len());
        for (i, (orig, recon)) in original
            .columns
            .iter()
            .zip(reconstructed.columns.iter())
            .enumerate()
        {
            assert_eq!(recon.name, orig.name, "column {} name mismatch", i);
            assert_eq!(recon.index, orig.index, "column {} index mismatch", i);
            assert_eq!(
                recon.totals_function, orig.totals_function,
                "column {} totals_function mismatch",
                i
            );
            assert_eq!(
                recon.totals_label, orig.totals_label,
                "column {} totals_label mismatch",
                i
            );
            assert_eq!(
                recon.calculated_formula, orig.calculated_formula,
                "column {} calculated_formula mismatch",
                i
            );
        }
    }

    /// TableBinding JSON roundtrip via serde.
    #[test]
    fn table_binding_json_roundtrip() {
        use domain_types::domain::table::TableBinding;

        let table = CanonicalTable {
            id: "1".to_string(),
            name: "Table1".to_string(),
            display_name: "Table1".to_string(),
            sheet_id: "s1".to_string(),
            range: cell_types::SheetRange::new(0, 0, 5, 2),
            columns: vec![
                TableColumn {
                    id: "1".into(),
                    name: "A".into(),
                    index: 0,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
                TableColumn {
                    id: "2".into(),
                    name: "B".into(),
                    index: 1,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
            ],
            has_header_row: true,
            has_totals_row: false,
            style: "TableStyleMedium2".to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: false,
            show_filter_buttons: true,
            auto_expand: false,
            auto_calculated_columns: false,
        };

        let json = domain_types::yrs_schema::table::table_to_binding_json(&table)
            .expect("serialize to JSON");
        let reconstructed =
            domain_types::yrs_schema::table::from_binding_to_table(&json, "1", "s1", table.range)
                .expect("reconstruct from JSON");

        assert_eq!(reconstructed.name, table.name);
        assert_eq!(reconstructed.columns.len(), table.columns.len());
        assert_eq!(reconstructed.columns[0].name, "A");
        assert_eq!(reconstructed.columns[1].name, "B");
        assert!(!reconstructed.auto_expand);
        assert!(!reconstructed.auto_calculated_columns);
    }

    /// table_range_id and table_name_from_range_id are inverse operations.
    #[test]
    fn range_id_round_trip() {
        let name = "MyTable";
        let rid = table_range_id(name);
        assert_eq!(rid, "table:MyTable");
        assert_eq!(table_name_from_range_id(&rid), Some("MyTable"));
        assert_eq!(table_name_from_range_id("other:stuff"), None);
    }

    /// Mirror maintains table_range_ids index.
    #[test]
    fn mirror_table_range_id_index() {
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

        // Check index via mirror
        assert_eq!(
            engine.mirror().table_range_id("Table1"),
            Some("table:Table1"),
        );
        // Case-insensitive
        assert_eq!(
            engine.mirror().table_range_id("table1"),
            Some("table:Table1"),
        );

        // Delete should clean up index
        engine.delete_table("Table1").expect("delete_table");
        assert_eq!(engine.mirror().table_range_id("Table1"), None);
    }

    /// Single-row table (header only, no data rows) binding roundtrip.
    #[test]
    fn single_row_table_binding() {
        use domain_types::domain::table::TableBinding;

        let table = CanonicalTable {
            id: "1".to_string(),
            name: "Tiny".to_string(),
            display_name: "Tiny".to_string(),
            sheet_id: "s1".to_string(),
            range: cell_types::SheetRange::new(0, 0, 0, 0),
            columns: vec![TableColumn {
                id: "1".into(),
                name: "Only".into(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            }],
            has_header_row: true,
            has_totals_row: false,
            style: "TableStyleMedium2".to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: false,
            show_filter_buttons: true,
            auto_expand: true,
            auto_calculated_columns: true,
        };

        let binding = TableBinding::from_table(&table);
        let reconstructed = binding.to_table(&table.id, &table.sheet_id, table.range);
        assert_eq!(reconstructed.columns.len(), 1);
        assert_eq!(reconstructed.columns[0].name, "Only");
        assert_eq!(reconstructed.range, cell_types::SheetRange::new(0, 0, 0, 0));
    }

    /// Single-column table binding roundtrip.
    #[test]
    fn single_column_table_binding() {
        use domain_types::domain::table::TableBinding;

        let table = CanonicalTable {
            id: "1".to_string(),
            name: "SingleCol".to_string(),
            display_name: "SingleCol".to_string(),
            sheet_id: "s1".to_string(),
            range: cell_types::SheetRange::new(0, 0, 10, 0),
            columns: vec![TableColumn {
                id: "1".into(),
                name: "Data".into(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            }],
            has_header_row: true,
            has_totals_row: false,
            style: "TableStyleMedium2".to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: false,
            show_filter_buttons: true,
            auto_expand: true,
            auto_calculated_columns: true,
        };

        let binding = TableBinding::from_table(&table);
        assert_eq!(binding.columns.len(), 1);
        let json = serde_json::to_string(&binding).unwrap();
        let deserialized: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.columns[0].name, "Data");
    }

    /// Convert table to range also cleans up binding.
    #[test]
    fn convert_to_range_cleans_binding() {
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
            .convert_table_to_range("Table1")
            .expect("convert_to_range");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        assert!(
            compute_document::range::read_range_binding_wb(&workbook, &txn, "table:Table1")
                .is_none(),
            "binding must be cleaned up after convert_to_range"
        );
    }

    /// Style info persists through binding.
    #[test]
    fn style_info_persists_in_binding() {
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

        // Change style options
        engine
            .set_table_bool_option("Table1", "bandedColumns", true)
            .expect("set banded columns");
        engine
            .set_table_bool_option("Table1", "bandedRows", false)
            .expect("set banded rows");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:Table1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        let style = binding.style.expect("style must be present");
        assert!(!style.banded_rows, "banded_rows should be false");
        assert!(style.banded_columns, "banded_columns should be true");
    }

    #[test]
    fn table_policy_updates_persist_in_binding() {
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
            .set_table_auto_expand("Table1", false)
            .expect("set auto expand policy");
        engine
            .set_table_auto_calculated_columns("Table1", false)
            .expect("set calculated columns policy");

        let table = engine
            .get_table_by_name("Table1")
            .expect("table must exist");
        assert!(!table.auto_expand);
        assert!(!table.auto_calculated_columns);

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:Table1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert!(!binding.auto_expand);
        assert!(!binding.auto_calculated_columns);
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
