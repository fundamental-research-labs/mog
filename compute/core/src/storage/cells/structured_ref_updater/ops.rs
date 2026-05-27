use yrs::{Doc, MapRef};

use super::range::TableRangeInfo;
use super::rewrite::{
    replace_column_name_in_formula, replace_column_ref_with_ref_error,
    replace_structured_refs_with_a1, replace_table_name_in_formula,
    replace_table_ref_with_ref_error, template_contains_column_ref, template_contains_table_ref,
};
use super::storage_scan::update_matching_formula_cells;

/// Update formula templates after a table rename.
pub fn update_formulas_for_table_rename(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    old_table_name: &str,
    new_table_name: &str,
) -> u32 {
    if old_table_name.is_empty() || new_table_name.is_empty() || old_table_name == new_table_name {
        return 0;
    }

    update_matching_formula_cells(
        doc,
        workbook,
        sheets,
        |template| template_contains_table_ref(template, old_table_name),
        |template, formula| {
            (
                replace_table_name_in_formula(template, old_table_name, new_table_name),
                replace_table_name_in_formula(formula, old_table_name, new_table_name),
            )
        },
    )
}

/// Update formula templates after a column rename within a table.
pub fn update_formulas_for_column_rename(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    table_name: &str,
    old_column_name: &str,
    new_column_name: &str,
) -> u32 {
    if table_name.is_empty()
        || old_column_name.is_empty()
        || new_column_name.is_empty()
        || old_column_name == new_column_name
    {
        return 0;
    }

    update_matching_formula_cells(
        doc,
        workbook,
        sheets,
        |template| {
            template_contains_table_ref(template, table_name)
                && template_contains_column_ref(template, old_column_name)
        },
        |template, formula| {
            (
                replace_column_name_in_formula(
                    template,
                    table_name,
                    old_column_name,
                    new_column_name,
                ),
                replace_column_name_in_formula(
                    formula,
                    table_name,
                    old_column_name,
                    new_column_name,
                ),
            )
        },
    )
}

/// Propagate `#REF!` error for a deleted table.
pub fn propagate_ref_error_for_table_delete(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    deleted_table_name: &str,
) -> u32 {
    if deleted_table_name.is_empty() {
        return 0;
    }

    update_matching_formula_cells(
        doc,
        workbook,
        sheets,
        |template| template_contains_table_ref(template, deleted_table_name),
        |template, formula| {
            (
                replace_table_ref_with_ref_error(template, deleted_table_name),
                replace_table_ref_with_ref_error(formula, deleted_table_name),
            )
        },
    )
}

/// Propagate `#REF!` error for a deleted column within a table.
pub fn propagate_ref_error_for_column_delete(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    table_name: &str,
    deleted_column_name: &str,
) -> u32 {
    if table_name.is_empty() || deleted_column_name.is_empty() {
        return 0;
    }

    update_matching_formula_cells(
        doc,
        workbook,
        sheets,
        |template| {
            template_contains_table_ref(template, table_name)
                && template_contains_column_ref(template, deleted_column_name)
        },
        |template, formula| {
            (
                replace_column_ref_with_ref_error(template, table_name, deleted_column_name),
                replace_column_ref_with_ref_error(formula, table_name, deleted_column_name),
            )
        },
    )
}

/// Convert all structured references to a table into A1 references.
pub fn convert_structured_refs_to_a1(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    table_info: &TableRangeInfo,
) -> u32 {
    if table_info.name.is_empty() {
        return 0;
    }

    update_matching_formula_cells(
        doc,
        workbook,
        sheets,
        |template| template_contains_table_ref(template, &table_info.name),
        |template, formula| {
            (
                replace_structured_refs_with_a1(template, table_info),
                replace_structured_refs_with_a1(formula, table_info),
            )
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;
    use formula_types::IdentityFormula;
    use value_types::{CellValue, FiniteF64};

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn make_cell_id(n: u128) -> cell_types::CellId {
        cell_types::CellId::from_raw(n)
    }

    /// Set up a storage with a formula cell that contains a structured reference.
    fn setup_storage_with_structured_ref(
        template: &str,
        formula: &str,
    ) -> (YrsStorage, SheetId, cell_types::CellId) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, s1, "Sheet1", 100, 26)
            .unwrap();

        let cell_id = make_cell_id(100);
        let idf = IdentityFormula {
            template: template.to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };

        storage.set_cell(
            &mut mirror,
            &s1,
            cell_id,
            2,
            3,
            CellValue::Number(FiniteF64::must(42.0)),
            Some(formula.to_string()),
            Some(idf),
        );

        (storage, s1, cell_id)
    }

    // -------------------------------------------------------------------
    // Test 27: YrsStorage::update_formulas_for_table_rename — end-to-end
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_update_table_rename_end_to_end() {
        let (storage, s1, cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let count = update_formulas_for_table_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
            "Revenue",
        );
        assert_eq!(count, 1);

        let (_, formula, identity) = storage
            .read_cell_from_yrs(&s1, &cell_id)
            .expect("cell should exist");
        assert_eq!(formula, Some("=SUM(Revenue[Amount])".to_string()));
        let idf = identity.expect("identity formula should exist");
        assert_eq!(idf.template, "SUM(Revenue[Amount])");
    }

    // -------------------------------------------------------------------
    // Test 28: YrsStorage::update_formulas_for_table_rename — no match
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_update_table_rename_no_match() {
        let (storage, _s1, _cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let count = update_formulas_for_table_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "OtherTable",
            "NewName",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 29: YrsStorage::update_formulas_for_table_rename — same name
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_update_table_rename_same_name() {
        let (storage, _s1, _cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let count = update_formulas_for_table_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
            "Sales",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 30: YrsStorage::update_formulas_for_table_rename — empty names
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_update_table_rename_empty() {
        let (storage, _s1, _cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        assert_eq!(
            update_formulas_for_table_rename(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "",
                "Revenue"
            ),
            0
        );
        assert_eq!(
            update_formulas_for_table_rename(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "Sales",
                ""
            ),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 31: YrsStorage::update_formulas_for_column_rename — end-to-end
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_update_column_rename_end_to_end() {
        let (storage, s1, cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let count = update_formulas_for_column_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
            "Amount",
            "Revenue",
        );
        assert_eq!(count, 1);

        let (_, formula, identity) = storage
            .read_cell_from_yrs(&s1, &cell_id)
            .expect("cell should exist");
        assert_eq!(formula, Some("=SUM(Sales[Revenue])".to_string()));
        let idf = identity.expect("identity formula should exist");
        assert_eq!(idf.template, "SUM(Sales[Revenue])");
    }

    // -------------------------------------------------------------------
    // Test 32: YrsStorage::update_formulas_for_column_rename — no match
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_update_column_rename_no_match() {
        let (storage, _s1, _cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let count = update_formulas_for_column_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
            "Tax",
            "NewTax",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 33: YrsStorage::update_formulas_for_column_rename — same name
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_update_column_rename_same_name() {
        let (storage, _s1, _cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let count = update_formulas_for_column_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
            "Amount",
            "Amount",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 34: YrsStorage::update_formulas_for_column_rename — empty names
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_update_column_rename_empty() {
        let storage = YrsStorage::new();
        assert_eq!(
            update_formulas_for_column_rename(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "",
                "Amount",
                "Revenue"
            ),
            0
        );
        assert_eq!(
            update_formulas_for_column_rename(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "Sales",
                "",
                "Revenue"
            ),
            0
        );
        assert_eq!(
            update_formulas_for_column_rename(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "Sales",
                "Amount",
                ""
            ),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 35: YrsStorage::propagate_ref_error_for_table_delete — end-to-end
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_propagate_table_delete() {
        let (storage, s1, cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])+1", "SUM(Sales[Amount])+1");

        let count = propagate_ref_error_for_table_delete(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
        );
        assert_eq!(count, 1);

        let (_, formula, identity) = storage
            .read_cell_from_yrs(&s1, &cell_id)
            .expect("cell should exist");
        assert_eq!(formula, Some("=SUM(#REF!)+1".to_string()));
        let idf = identity.expect("identity formula should exist");
        assert_eq!(idf.template, "SUM(#REF!)+1");
    }

    // -------------------------------------------------------------------
    // Test 36: YrsStorage::propagate_ref_error_for_table_delete — no match
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_propagate_table_delete_no_match() {
        let (storage, _s1, _cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let count = propagate_ref_error_for_table_delete(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "OtherTable",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 37: YrsStorage::propagate_ref_error_for_column_delete — end-to-end
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_propagate_column_delete() {
        let (storage, s1, cell_id) = setup_storage_with_structured_ref(
            "Sales[Amount]+Sales[Tax]",
            "Sales[Amount]+Sales[Tax]",
        );

        let count = propagate_ref_error_for_column_delete(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
            "Amount",
        );
        assert_eq!(count, 1);

        let (_, formula, identity) = storage
            .read_cell_from_yrs(&s1, &cell_id)
            .expect("cell should exist");
        assert_eq!(formula, Some("=#REF!+Sales[Tax]".to_string()));
        let idf = identity.expect("identity formula should exist");
        assert_eq!(idf.template, "#REF!+Sales[Tax]");
    }

    // -------------------------------------------------------------------
    // Test 38: YrsStorage::propagate_ref_error_for_column_delete — no match
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_propagate_column_delete_no_match() {
        let (storage, _s1, _cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let count = propagate_ref_error_for_column_delete(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
            "Tax",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 39: YrsStorage::convert_structured_refs_to_a1 — end-to-end
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_convert_to_a1() {
        let (storage, s1, cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let table_info = TableRangeInfo {
            name: "Sales".to_string(),
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 2,
            columns: vec![
                ("Date".to_string(), 0),
                ("Amount".to_string(), 1),
                ("Tax".to_string(), 2),
            ],
            has_header_row: true,
            has_total_row: false,
        };

        let count = convert_structured_refs_to_a1(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &table_info,
        );
        assert_eq!(count, 1);

        let (_, formula, identity) = storage
            .read_cell_from_yrs(&s1, &cell_id)
            .expect("cell should exist");
        assert_eq!(formula, Some("=SUM($A$2:$C$11)".to_string()));
        let idf = identity.expect("identity formula should exist");
        assert_eq!(idf.template, "SUM($A$2:$C$11)");
    }

    // -------------------------------------------------------------------
    // Test 40: YrsStorage::convert_structured_refs_to_a1 — no match
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_convert_to_a1_no_match() {
        let (storage, _s1, _cell_id) =
            setup_storage_with_structured_ref("SUM(Sales[Amount])", "SUM(Sales[Amount])");

        let table_info = TableRangeInfo {
            name: "OtherTable".to_string(),
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 2,
            columns: vec![],
            has_header_row: true,
            has_total_row: false,
        };

        let count = convert_structured_refs_to_a1(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &table_info,
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 41: Multiple cells across multiple sheets
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_table_rename_multiple_cells_across_sheets() {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage
            .add_sheet(&mut mirror, s1, "Sheet1", 100, 26)
            .unwrap();
        storage
            .add_sheet(&mut mirror, s2, "Sheet2", 100, 26)
            .unwrap();
        storage
            .add_sheet(&mut mirror, s3, "Sheet3", 100, 26)
            .unwrap();

        // Cell in Sheet1 referencing Sales
        let c1 = make_cell_id(100);
        storage.set_cell(
            &mut mirror,
            &s1,
            c1,
            0,
            0,
            CellValue::Number(FiniteF64::must(1.0)),
            Some("SUM(Sales[Amount])".to_string()),
            Some(IdentityFormula {
                template: "SUM(Sales[Amount])".to_string(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
        );

        // Cell in Sheet3 referencing Sales twice
        let c2 = make_cell_id(200);
        storage.set_cell(
            &mut mirror,
            &s3,
            c2,
            0,
            0,
            CellValue::Number(FiniteF64::must(2.0)),
            Some("Sales[Amount]+Sales[Tax]".to_string()),
            Some(IdentityFormula {
                template: "Sales[Amount]+Sales[Tax]".to_string(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
        );

        // Cell in Sheet2 NOT referencing Sales (local formula)
        let c3 = make_cell_id(300);
        storage.set_cell(
            &mut mirror,
            &s2,
            c3,
            0,
            0,
            CellValue::Number(FiniteF64::must(3.0)),
            Some("SUM(A1:A5)".to_string()),
            Some(IdentityFormula {
                template: "SUM({0})".to_string(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
        );

        let count = update_formulas_for_table_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
            "Revenue",
        );
        assert_eq!(count, 2);

        // Verify c1 was updated
        let (_, f1, idf1) = storage.read_cell_from_yrs(&s1, &c1).unwrap();
        assert_eq!(f1, Some("=SUM(Revenue[Amount])".to_string()));
        assert_eq!(idf1.unwrap().template, "SUM(Revenue[Amount])");

        // Verify c2 was updated
        let (_, f2, idf2) = storage.read_cell_from_yrs(&s3, &c2).unwrap();
        assert_eq!(f2, Some("=Revenue[Amount]+Revenue[Tax]".to_string()));
        assert_eq!(idf2.unwrap().template, "Revenue[Amount]+Revenue[Tax]");

        // Verify c3 was NOT updated
        let (_, f3, idf3) = storage.read_cell_from_yrs(&s2, &c3).unwrap();
        assert_eq!(f3, Some("=SUM(A1:A5)".to_string()));
        assert_eq!(idf3.unwrap().template, "SUM({0})");
    }

    // -------------------------------------------------------------------
    // Test 42: Cell with no formula template is skipped
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_skips_cells_without_template() {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let s1 = make_sheet_id(1);
        storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();

        // Cell with value only (no formula/template)
        let c1 = make_cell_id(100);
        storage.set_cell(
            &mut mirror,
            &s1,
            c1,
            0,
            0,
            CellValue::Number(FiniteF64::must(42.0)),
            None,
            None,
        );

        // Cell with formula but no identity formula (legacy)
        let c2 = make_cell_id(200);
        storage.set_cell(
            &mut mirror,
            &s1,
            c2,
            1,
            0,
            CellValue::Number(FiniteF64::must(100.0)),
            Some("SUM(A1:A10)".to_string()),
            None,
        );

        let count = update_formulas_for_table_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sales",
            "Revenue",
        );
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 43: Empty workbook — no panic
    // -------------------------------------------------------------------

    #[test]
    fn test_yrs_empty_workbook() {
        let storage = YrsStorage::new();
        assert_eq!(
            update_formulas_for_table_rename(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "Sales",
                "Revenue"
            ),
            0
        );
        assert_eq!(
            update_formulas_for_column_rename(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "Sales",
                "Amount",
                "Revenue"
            ),
            0
        );
        assert_eq!(
            propagate_ref_error_for_table_delete(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "Sales"
            ),
            0
        );
        assert_eq!(
            propagate_ref_error_for_column_delete(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "Sales",
                "Amount"
            ),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 50: Convert to A1 with empty table name
    // -------------------------------------------------------------------

    #[test]
    fn test_convert_to_a1_empty_table_name() {
        let table_info = TableRangeInfo {
            name: "".to_string(),
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 2,
            columns: vec![],
            has_header_row: true,
            has_total_row: false,
        };

        let storage = YrsStorage::new();
        assert_eq!(
            convert_structured_refs_to_a1(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                &table_info
            ),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 53: Column delete with empty inputs
    // -------------------------------------------------------------------

    #[test]
    fn test_propagate_column_delete_empty() {
        let storage = YrsStorage::new();
        assert_eq!(
            propagate_ref_error_for_column_delete(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "",
                "Amount"
            ),
            0
        );
        assert_eq!(
            propagate_ref_error_for_column_delete(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                "Sales",
                ""
            ),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 54: Table delete with empty input
    // -------------------------------------------------------------------

    #[test]
    fn test_propagate_table_delete_empty() {
        let storage = YrsStorage::new();
        assert_eq!(
            propagate_ref_error_for_table_delete(
                storage.doc(),
                storage.workbook_map(),
                storage.sheets(),
                ""
            ),
            0
        );
    }
}
