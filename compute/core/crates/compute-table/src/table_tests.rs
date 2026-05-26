use super::*;

/// Helper: create a simple table with header row, no totals, starting at (0,0).
fn make_test_table() -> Table {
    create_table(
        "TestTable",
        "sheet1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 2,
        },
        &["Name", "Age", "City"],
        None,
    )
    .expect("valid range")
}

// ---- Table Creation ----

#[test]
fn create_table_basic() {
    let t = make_test_table();
    assert_eq!(t.name, "TestTable");
    assert_eq!(t.sheet_id, "sheet1");
    assert_eq!(t.columns.len(), 3);
    assert_eq!(t.columns[0].name, "Name");
    assert_eq!(t.columns[0].id, "TestTable-col-0");
    assert_eq!(t.columns[0].index, 0);
    assert_eq!(t.columns[1].name, "Age");
    assert_eq!(t.columns[1].id, "TestTable-col-1");
    assert_eq!(t.columns[2].name, "City");
    assert_eq!(t.columns[2].id, "TestTable-col-2");
    assert!(t.has_header_row);
    assert!(!t.has_totals_row);
    assert_eq!(t.style, "TableStyleMedium2");
    assert!(t.banded_rows);
    assert!(!t.banded_columns);
    assert!(t.show_filter_buttons);
}

#[test]
fn create_table_with_options() {
    let t = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 1,
        },
        &["A", "B"],
        Some(CreateTableOptions {
            has_header_row: Some(false),
            has_totals_row: Some(true),
            style_id: Some("TableStyleLight1".to_string()),
            ..Default::default()
        }),
    )
    .unwrap();
    assert!(!t.has_header_row);
    assert!(t.has_totals_row);
    assert_eq!(t.style, "TableStyleLight1");
}

#[test]
fn create_table_pads_column_names() {
    let t = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 3,
        },
        &["A", "B"], // only 2 names for 4 columns
        None,
    )
    .unwrap();
    assert_eq!(t.columns.len(), 4);
    assert_eq!(t.columns[2].name, "Column3");
    assert_eq!(t.columns[3].name, "Column4");
}

// ---- Table Name Validation ----

#[test]
fn validate_table_name_valid() {
    assert!(validate_table_name("MyTable").is_ok());
    assert!(validate_table_name("_private").is_ok());
    assert!(validate_table_name("Table1").is_ok());
    assert!(validate_table_name("a").is_ok());
}

#[test]
fn validate_table_name_empty() {
    assert!(validate_table_name("").is_err());
    assert!(validate_table_name("   ").is_err());
}

#[test]
fn validate_table_name_starts_with_digit() {
    assert!(validate_table_name("1Table").is_err());
}

#[test]
fn validate_table_name_contains_space() {
    assert!(validate_table_name("My Table").is_err());
}

#[test]
fn validate_table_name_special_chars() {
    assert!(validate_table_name("My-Table").is_err());
    assert!(validate_table_name("My.Table").is_err());
}

#[test]
fn validate_table_name_cell_reference() {
    assert!(validate_table_name("A1").is_err());
    assert!(validate_table_name("XFD1048576").is_err());
    assert!(validate_table_name("BB99").is_err());
    assert!(validate_table_name("a1").is_err());
}

#[test]
fn validate_table_name_not_cell_reference() {
    // Column beyond XFD (16384) should be valid
    assert!(validate_table_name("XFE1").is_ok());
    // Row beyond 1048576 should be valid
    assert!(validate_table_name("A1048577").is_ok());
    // Too many letters to be a column
    assert!(validate_table_name("ABCD1").is_ok());
}

// ---- Add Column ----

#[test]
fn add_column_at_end() {
    let t = make_test_table();
    let t2 = add_column(&t, "Score", None);
    assert_eq!(t2.columns.len(), 4);
    assert_eq!(t2.columns[3].name, "Score");
    assert_eq!(t2.columns[3].index, 3);
    assert_eq!(t2.range.end_col, t.range.end_col + 1);
}

#[test]
fn add_column_at_beginning() {
    let t = make_test_table();
    let t2 = add_column(&t, "ID", Some(0));
    assert_eq!(t2.columns.len(), 4);
    assert_eq!(t2.columns[0].name, "ID");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "Name");
    assert_eq!(t2.columns[1].index, 1);
}

#[test]
fn add_column_dedup_incrementing_counter() {
    // BUG FIX TEST: Name dedup must use incrementing counter
    let t = make_test_table(); // has "Name", "Age", "City"
    let t2 = add_column(&t, "Name", None); // should become "Name2"
    assert_eq!(t2.columns[3].name, "Name2");

    let t3 = add_column(&t2, "Name", None); // should become "Name3", NOT "Name22"
    assert_eq!(t3.columns[4].name, "Name3");

    let t4 = add_column(&t3, "Name", None); // should become "Name4", NOT "Name222"
    assert_eq!(t4.columns[5].name, "Name4");
}

#[test]
fn add_column_dedup_case_insensitive() {
    let t = make_test_table(); // has "Name"
    let t2 = add_column(&t, "name", None); // "name" collides with "Name"
    assert_eq!(t2.columns[3].name, "name2");
}

#[test]
fn add_column_position_clamped() {
    let t = make_test_table(); // 3 columns
    let t2 = add_column(&t, "X", Some(999));
    assert_eq!(t2.columns.last().unwrap().name, "X");
}

// ---- Remove Column ----

#[test]
fn remove_column_basic() {
    let t = make_test_table();
    let col_id = t.columns[1].id.clone();
    let t2 = remove_column(&t, &col_id);
    assert_eq!(t2.columns.len(), 2);
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "City");
    assert_eq!(t2.columns[1].index, 1);
    assert_eq!(t2.range.end_col, t.range.end_col - 1);
}

#[test]
fn remove_column_not_found() {
    let t = make_test_table();
    let t2 = remove_column(&t, "nonexistent");
    assert_eq!(t2.columns.len(), t.columns.len());
}

#[test]
fn remove_column_last_column_prevented() {
    let t = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 0,
        },
        &["Only"],
        None,
    )
    .unwrap();
    let t2 = remove_column(&t, &t.columns[0].id);
    assert_eq!(t2.columns.len(), 1); // unchanged
}

// ---- Rename Column ----

#[test]
fn rename_column_basic() {
    let t = make_test_table();
    let t2 = rename_column(&t, &t.columns[0].id, "FullName").unwrap();
    assert_eq!(t2.columns[0].name, "FullName");
}

#[test]
fn rename_column_duplicate_name_errors() {
    let t = make_test_table(); // "Name", "Age", "City"
    let result = rename_column(&t, &t.columns[0].id, "Age");
    assert!(result.is_err());
}

#[test]
fn rename_column_duplicate_case_insensitive() {
    let t = make_test_table(); // "Name", "Age", "City"
    let result = rename_column(&t, &t.columns[0].id, "AGE");
    assert!(result.is_err());
}

#[test]
fn rename_column_not_found() {
    let t = make_test_table();
    let t2 = rename_column(&t, "nonexistent", "Whatever").unwrap();
    assert_eq!(t2.columns, t.columns); // unchanged
}

// ---- Resize Table ----

#[test]
fn resize_table_expand_columns() {
    let t = make_test_table(); // 3 columns
    let t2 = resize_table(
        &t,
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 4,
        },
    )
    .unwrap();
    assert_eq!(t2.columns.len(), 5);
    assert_eq!(t2.columns[3].name, "Column4");
    assert_eq!(t2.columns[4].name, "Column5");
    // Indices re-numbered
    for (i, col) in t2.columns.iter().enumerate() {
        assert_eq!(col.index, i as u32);
    }
}

#[test]
fn resize_table_shrink_columns() {
    let t = make_test_table(); // 3 columns
    let t2 = resize_table(
        &t,
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 1,
        },
    )
    .unwrap();
    assert_eq!(t2.columns.len(), 2);
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[1].name, "Age");
}

#[test]
fn resize_table_same_columns() {
    let t = make_test_table();
    let t2 = resize_table(&t, t.range).unwrap();
    assert_eq!(t2.columns.len(), t.columns.len());
}

// ---- Table Options ----

#[test]
fn set_table_option_banded_rows() {
    let t = make_test_table();
    assert!(t.banded_rows);
    let t2 = set_table_option(&t, TableBoolOption::BandedRows, false);
    assert!(!t2.banded_rows);
}

#[test]
fn set_table_option_emphasize_first_column() {
    let t = make_test_table();
    assert!(!t.emphasize_first_column);
    let t2 = set_table_option(&t, TableBoolOption::EmphasizeFirstColumn, true);
    assert!(t2.emphasize_first_column);
}

#[test]
fn set_table_style_changes_style() {
    let t = make_test_table();
    let t2 = set_table_style(&t, "TableStyleLight1");
    assert_eq!(t2.style, "TableStyleLight1");
}

// ---- Range Queries ----

#[test]
fn get_header_range_with_header() {
    let t = make_test_table(); // header row, range 0-10
    let r = get_header_range(&t).unwrap();
    assert_eq!(r.start_row, 0);
    assert_eq!(r.end_row, 0);
    assert_eq!(r.start_col, 0);
    assert_eq!(r.end_col, 2);
}

#[test]
fn get_header_range_no_header() {
    let t = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 1,
        },
        &["A", "B"],
        Some(CreateTableOptions {
            has_header_row: Some(false),
            ..Default::default()
        }),
    )
    .unwrap();
    assert!(get_header_range(&t).is_none());
}

#[test]
fn get_data_range_basic() {
    let t = make_test_table(); // header at row 0, no totals, range 0-10
    let r = get_data_range(&t).unwrap();
    assert_eq!(r.start_row, 1); // after header
    assert_eq!(r.end_row, 10);
    assert_eq!(r.start_col, 0);
    assert_eq!(r.end_col, 2);
}

#[test]
fn get_data_range_with_totals() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    // Range row 0-10: header at 0, totals at 10, data 1-9
    let r = get_data_range(&t).unwrap();
    assert_eq!(r.start_row, 1);
    assert_eq!(r.end_row, 9);
}

#[test]
fn get_data_range_header_plus_totals_only_returns_none() {
    // BUG FIX TEST: table with header + totals but no data rows should return None
    let t = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 1,
        },
        &["A", "B"],
        Some(CreateTableOptions {
            has_header_row: Some(true),
            has_totals_row: Some(true),
            ..Default::default()
        }),
    )
    .unwrap();
    // header at row 0, totals at row 1, data would be row 1..0 which is inverted
    assert!(get_data_range(&t).is_none());
}

#[test]
fn get_data_range_no_header_no_totals() {
    let t = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 5,
            start_col: 2,
            end_row: 15,
            end_col: 4,
        },
        &["A", "B", "C"],
        Some(CreateTableOptions {
            has_header_row: Some(false),
            has_totals_row: Some(false),
            ..Default::default()
        }),
    )
    .unwrap();
    let r = get_data_range(&t).unwrap();
    assert_eq!(r.start_row, 5);
    assert_eq!(r.end_row, 15);
}

#[test]
fn get_totals_range_with_totals() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    let r = get_totals_range(&t).unwrap();
    assert_eq!(r.start_row, 10);
    assert_eq!(r.end_row, 10);
}

#[test]
fn get_totals_range_no_totals() {
    let t = make_test_table();
    assert!(get_totals_range(&t).is_none());
}

#[test]
fn get_column_range_basic() {
    let t = make_test_table();
    let r = get_column_range(&t, "TestTable-col-1").unwrap();
    assert_eq!(r.start_row, 0);
    assert_eq!(r.end_row, 10);
    assert_eq!(r.start_col, 1);
    assert_eq!(r.end_col, 1);
}

#[test]
fn get_column_range_not_found() {
    let t = make_test_table();
    assert!(get_column_range(&t, "nonexistent").is_none());
}

#[test]
fn get_column_data_range_basic() {
    let t = make_test_table();
    let r = get_column_data_range(&t, "TestTable-col-1").unwrap();
    assert_eq!(r.start_row, 1); // after header
    assert_eq!(r.end_row, 10);
    assert_eq!(r.start_col, 1);
    assert_eq!(r.end_col, 1);
}

#[test]
fn get_column_data_range_not_found() {
    let t = make_test_table();
    assert!(get_column_data_range(&t, "nonexistent").is_none());
}

// ---- Hit Testing ----

#[test]
fn is_position_in_table_inside() {
    let t = make_test_table(); // range (0,0)-(10,2)
    assert!(is_position_in_table(&t, 0, 0));
    assert!(is_position_in_table(&t, 5, 1));
    assert!(is_position_in_table(&t, 10, 2));
}

#[test]
fn is_position_in_table_outside() {
    let t = make_test_table();
    assert!(!is_position_in_table(&t, 11, 0));
    assert!(!is_position_in_table(&t, 0, 3));
}

#[test]
fn get_column_at_position_valid() {
    let t = make_test_table(); // range starts at col 0
    let col = get_column_at_position(&t, 1).unwrap();
    assert_eq!(col.name, "Age");
}

#[test]
fn get_column_at_position_outside() {
    let t = make_test_table();
    assert!(get_column_at_position(&t, 5).is_none());
}

// ---- Toggle Totals Row ----

#[test]
fn toggle_totals_row_on() {
    let t = make_test_table(); // no totals
    let t2 = toggle_totals_row(&t);
    assert!(t2.has_totals_row);
    assert_eq!(t2.range.end_row, t.range.end_row + 1);
}

#[test]
fn toggle_totals_row_off() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    let t2 = toggle_totals_row(&t);
    assert!(!t2.has_totals_row);
    assert_eq!(t2.range.end_row, t.range.end_row - 1);
}

#[test]
fn toggle_totals_row_off_end_row_zero_no_underflow() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    t.range.end_row = 0;
    let t2 = toggle_totals_row(&t);
    assert!(!t2.has_totals_row);
    assert_eq!(t2.range.end_row, 0); // saturates at 0, no underflow
}

// ---- Totals Function ----

#[test]
fn set_totals_function_basic() {
    let t = make_test_table();
    let t2 = set_totals_function(&t, "TestTable-col-1", TotalsFunction::Sum);
    assert_eq!(t2.columns[1].totals_function, Some(TotalsFunction::Sum));
    // Other columns unchanged
    assert_eq!(t2.columns[0].totals_function, None);
}

// ---- Subtotal Formula Generation ----

#[test]
fn get_subtotal_formula_sum() {
    let f = get_subtotal_formula(&TotalsFunction::Sum, "Sales").unwrap();
    assert_eq!(f, "=SUBTOTAL(109,[Sales])");
}

#[test]
fn get_subtotal_formula_average() {
    let f = get_subtotal_formula(&TotalsFunction::Average, "Score").unwrap();
    assert_eq!(f, "=SUBTOTAL(101,[Score])");
}

#[test]
fn get_subtotal_formula_count() {
    let f = get_subtotal_formula(&TotalsFunction::Count, "C").unwrap();
    assert_eq!(f, "=SUBTOTAL(102,[C])");
}

#[test]
fn get_subtotal_formula_none_returns_none() {
    assert!(get_subtotal_formula(&TotalsFunction::None, "C").is_none());
}

#[test]
fn get_subtotal_formula_custom_returns_none() {
    assert!(get_subtotal_formula(&TotalsFunction::Custom, "C").is_none());
}

// ---- Column Name Escaping ----

#[test]
fn escape_column_name_no_special_chars() {
    assert_eq!(escape_column_name("Sales"), "Sales");
}

#[test]
fn escape_column_name_with_single_quote() {
    assert_eq!(escape_column_name("John's"), "'John''s'");
}

#[test]
fn escape_column_name_with_brackets() {
    assert_eq!(escape_column_name("Data[1]"), "'Data[[1]]'");
}

#[test]
fn escape_column_name_with_hash() {
    assert_eq!(escape_column_name("Col#1"), "'Col#1'");
}

#[test]
fn escape_column_name_with_at() {
    assert_eq!(escape_column_name("@mention"), "'@mention'");
}

// ---- Immutability: original table is not modified ----

#[test]
fn operations_do_not_mutate_original() {
    let t = make_test_table();
    let _t2 = add_column(&t, "New", None);
    assert_eq!(t.columns.len(), 3); // original unchanged

    let _t3 = remove_column(&t, "TestTable-col-0");
    assert_eq!(t.columns.len(), 3); // original unchanged

    let _t4 = toggle_totals_row(&t);
    assert!(!t.has_totals_row); // original unchanged
}

// ---- Validate Range ----

#[test]
fn validate_range_valid() {
    assert!(validate_range(&TableRange {
        start_row: 0,
        start_col: 0,
        end_row: 10,
        end_col: 5,
    })
    .is_ok());
}

#[test]
fn validate_range_invalid_rows() {
    assert!(validate_range(&TableRange {
        start_row: 10,
        start_col: 0,
        end_row: 5,
        end_col: 5,
    })
    .is_err());
}

#[test]
fn validate_range_invalid_cols() {
    assert!(validate_range(&TableRange {
        start_row: 0,
        start_col: 10,
        end_row: 10,
        end_col: 5,
    })
    .is_err());
}

#[test]
fn create_table_with_invalid_range() {
    // Inverted rows
    let result = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 10,
            start_col: 0,
            end_row: 5,
            end_col: 2,
        },
        &["A", "B", "C"],
        None,
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("start_row"));

    // Inverted columns
    let result = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 5,
            end_row: 10,
            end_col: 2,
        },
        &["A", "B", "C"],
        None,
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("start_col"));
}

#[test]
fn resize_table_with_invalid_range() {
    let t = make_test_table();

    // Inverted rows
    let result = resize_table(
        &t,
        TableRange {
            start_row: 10,
            start_col: 0,
            end_row: 5,
            end_col: 2,
        },
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("start_row"));

    // Inverted columns
    let result = resize_table(
        &t,
        TableRange {
            start_row: 0,
            start_col: 5,
            end_row: 10,
            end_col: 2,
        },
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("start_col"));
}

// ---- Subtotal function number mapping ----

#[test]
fn subtotal_function_number_all_mappings() {
    assert_eq!(subtotal_function_number(&TotalsFunction::Average), Some(101));
    assert_eq!(subtotal_function_number(&TotalsFunction::Count), Some(102));
    assert_eq!(subtotal_function_number(&TotalsFunction::CountNums), Some(103));
    assert_eq!(subtotal_function_number(&TotalsFunction::Max), Some(104));
    assert_eq!(subtotal_function_number(&TotalsFunction::Min), Some(105));
    assert_eq!(subtotal_function_number(&TotalsFunction::StdDev), Some(107));
    assert_eq!(subtotal_function_number(&TotalsFunction::Sum), Some(109));
    assert_eq!(subtotal_function_number(&TotalsFunction::Var), Some(110));
    assert_eq!(subtotal_function_number(&TotalsFunction::Custom), None);
    assert_eq!(subtotal_function_number(&TotalsFunction::None), None);
}

// ---- Edge Cases ----

#[test]
fn create_table_with_inverted_rows() {
    let result = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 10,
            start_col: 0,
            end_row: 5,
            end_col: 2,
        },
        &["A", "B", "C"],
        None,
    );
    assert!(result.is_err());
    let err_msg = result.unwrap_err();
    assert!(err_msg.contains("start_row"));
    assert!(err_msg.contains("end_row"));
}

#[test]
fn create_table_with_inverted_cols() {
    let result = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 10,
            end_row: 5,
            end_col: 2,
        },
        &["A", "B", "C"],
        None,
    );
    assert!(result.is_err());
    let err_msg = result.unwrap_err();
    assert!(err_msg.contains("start_col"));
    assert!(err_msg.contains("end_col"));
}

#[test]
fn toggle_totals_row_with_end_row_zero() {
    // Verify toggle_totals_row handles end_row = 0
    // Create a table with end_row = 0 and totals row enabled
    let mut t = make_test_table();
    t.has_totals_row = true;
    t.range.end_row = 0;
    let t2 = toggle_totals_row(&t);
    assert!(!t2.has_totals_row);
    assert_eq!(t2.range.end_row, 0); // saturates at 0, no underflow
}

#[test]
fn add_column_on_first_column() {
    let t = make_test_table(); // "Name", "Age", "City"
    let t2 = add_column(&t, "ID", Some(0));
    assert_eq!(t2.columns.len(), 4);
    // New column should be first
    assert_eq!(t2.columns[0].name, "ID");
    assert_eq!(t2.columns[0].index, 0);
    // Other columns shift
    assert_eq!(t2.columns[1].name, "Name");
    assert_eq!(t2.columns[1].index, 1);
    assert_eq!(t2.columns[2].name, "Age");
    assert_eq!(t2.columns[2].index, 2);
    assert_eq!(t2.columns[3].name, "City");
    assert_eq!(t2.columns[3].index, 3);
    // Range should expand
    assert_eq!(t2.range.end_col, t.range.end_col + 1);
}

#[test]
fn add_column_on_last_column() {
    let t = make_test_table(); // 3 columns
    let last_idx = t.columns.len();
    let t2 = add_column(&t, "Score", Some(last_idx));
    assert_eq!(t2.columns.len(), 4);
    // New column should be last
    assert_eq!(t2.columns[3].name, "Score");
    assert_eq!(t2.columns[3].index, 3);
    // Other columns unchanged
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[1].name, "Age");
    assert_eq!(t2.columns[2].name, "City");
    assert_eq!(t2.range.end_col, t.range.end_col + 1);
}

#[test]
fn remove_column_first() {
    let t = make_test_table(); // "Name", "Age", "City"
    let first_col_id = t.columns[0].id.clone();
    let t2 = remove_column(&t, &first_col_id);
    assert_eq!(t2.columns.len(), 2);
    // First column removed, remaining should re-index
    assert_eq!(t2.columns[0].name, "Age");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "City");
    assert_eq!(t2.columns[1].index, 1);
    // Range should contract
    assert_eq!(t2.range.end_col, t.range.end_col - 1);
}

#[test]
fn remove_column_last() {
    let t = make_test_table(); // "Name", "Age", "City"
    let last_col_id = t.columns[2].id.clone();
    let t2 = remove_column(&t, &last_col_id);
    assert_eq!(t2.columns.len(), 2);
    // Last column removed, remaining should be correct
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "Age");
    assert_eq!(t2.columns[1].index, 1);
    // Range should contract
    assert_eq!(t2.range.end_col, t.range.end_col - 1);
}

#[test]
fn table_with_nonzero_start_col() {
    // Create table starting at column 5
    let t = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 5,
            end_row: 10,
            end_col: 7,
        },
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    assert_eq!(t.columns.len(), 3);
    assert_eq!(t.range.start_col, 5);
    assert_eq!(t.range.end_col, 7);

    // Test add column
    let t2 = add_column(&t, "D", None);
    assert_eq!(t2.columns.len(), 4);
    assert_eq!(t2.range.end_col, 8);

    // Test remove column
    let col_id = t2.columns[1].id.clone();
    let t3 = remove_column(&t2, &col_id);
    assert_eq!(t3.columns.len(), 3);
    assert_eq!(t3.range.end_col, 7);
    // Verify indices re-numbered correctly
    for (i, col) in t3.columns.iter().enumerate() {
        assert_eq!(col.index, i as u32);
    }

    // Test set_table_option
    let t4 = set_table_option(&t3, TableBoolOption::BandedColumns, true);
    assert!(t4.banded_columns);
    assert_eq!(t4.columns.len(), 3);
}

#[test]
fn resize_table_multi_cycle() {
    let t = make_test_table(); // 3 columns

    // Resize larger: 3 -> 5 columns
    let t2 = resize_table(
        &t,
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 4,
        },
    )
    .unwrap();
    assert_eq!(t2.columns.len(), 5);
    let ids_after_expand: Vec<String> = t2.columns.iter().map(|c| c.id.clone()).collect();
    // Original column IDs should be preserved
    assert_eq!(ids_after_expand[0], "TestTable-col-0");
    assert_eq!(ids_after_expand[1], "TestTable-col-1");
    assert_eq!(ids_after_expand[2], "TestTable-col-2");

    // Resize smaller: 5 -> 2 columns
    let t3 = resize_table(
        &t2,
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 1,
        },
    )
    .unwrap();
    assert_eq!(t3.columns.len(), 2);
    assert_eq!(t3.columns[0].id, "TestTable-col-0");
    assert_eq!(t3.columns[1].id, "TestTable-col-1");

    // Resize larger again: 2 -> 4 columns
    let t4 = resize_table(
        &t3,
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 3,
        },
    )
    .unwrap();
    assert_eq!(t4.columns.len(), 4);
    // Original IDs still stable
    assert_eq!(t4.columns[0].id, "TestTable-col-0");
    assert_eq!(t4.columns[1].id, "TestTable-col-1");
    // New columns should have non-colliding IDs
    // (max suffix strategy ensures no collisions across cycles)
    let new_ids: Vec<String> = t4.columns.iter().map(|c| c.id.clone()).collect();
    // All IDs should be unique
    let unique_ids: std::collections::HashSet<_> = new_ids.iter().collect();
    assert_eq!(unique_ids.len(), 4);
}

// ---- get_column_by_name ----

#[test]
fn get_column_by_name_found() {
    let t = make_test_table();
    let col = get_column_by_name(&t, "Age").unwrap();
    assert_eq!(col.name, "Age");
    assert_eq!(col.index, 1);
}

#[test]
fn get_column_by_name_case_insensitive() {
    let t = make_test_table();
    let col = get_column_by_name(&t, "age").unwrap();
    assert_eq!(col.name, "Age");
    let col2 = get_column_by_name(&t, "AGE").unwrap();
    assert_eq!(col2.name, "Age");
}

#[test]
fn get_column_by_name_not_found() {
    let t = make_test_table();
    assert!(get_column_by_name(&t, "Missing").is_none());
}

// ---- get_column_by_id ----

#[test]
fn get_column_by_id_found() {
    let t = make_test_table();
    let col = get_column_by_id(&t, "TestTable-col-1").unwrap();
    assert_eq!(col.name, "Age");
}

#[test]
fn get_column_by_id_not_found() {
    let t = make_test_table();
    assert!(get_column_by_id(&t, "nonexistent").is_none());
}

// ---- is_in_header_row ----

#[test]
fn is_in_header_row_true() {
    let t = make_test_table(); // header at row 0
    assert!(is_in_header_row(&t, 0));
}

#[test]
fn is_in_header_row_false_data_row() {
    let t = make_test_table();
    assert!(!is_in_header_row(&t, 1));
    assert!(!is_in_header_row(&t, 5));
}

#[test]
fn is_in_header_row_false_no_header() {
    let t = create_table(
        "T1",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 1,
        },
        &["A", "B"],
        Some(CreateTableOptions {
            has_header_row: Some(false),
            ..Default::default()
        }),
    )
    .unwrap();
    assert!(!is_in_header_row(&t, 0));
}

// ---- is_in_totals_row ----

#[test]
fn is_in_totals_row_true() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    // end_row is 10
    assert!(is_in_totals_row(&t, 10));
}

#[test]
fn is_in_totals_row_false_no_totals() {
    let t = make_test_table();
    assert!(!is_in_totals_row(&t, 10));
}

#[test]
fn is_in_totals_row_false_wrong_row() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    assert!(!is_in_totals_row(&t, 5));
}

// ---- is_in_data_range ----

#[test]
fn is_in_data_range_true() {
    let t = make_test_table(); // header at 0, data 1-10, cols 0-2
    assert!(is_in_data_range(&t, 1, 0));
    assert!(is_in_data_range(&t, 5, 1));
    assert!(is_in_data_range(&t, 10, 2));
}

#[test]
fn is_in_data_range_false_header() {
    let t = make_test_table();
    assert!(!is_in_data_range(&t, 0, 0)); // header row
}

#[test]
fn is_in_data_range_false_totals() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    // data is now 1-9, totals at 10
    assert!(!is_in_data_range(&t, 10, 0));
}

#[test]
fn is_in_data_range_false_outside() {
    let t = make_test_table();
    assert!(!is_in_data_range(&t, 5, 3)); // col 3 is outside
    assert!(!is_in_data_range(&t, 11, 0)); // row 11 is outside
}

// ---- generate_table_name ----

#[test]
fn generate_table_name_empty() {
    let name = generate_table_name(&[]);
    assert_eq!(name, "Table1");
}

#[test]
fn generate_table_name_skips_existing() {
    let name = generate_table_name(&["Table1", "Table2"]);
    assert_eq!(name, "Table3");
}

#[test]
fn generate_table_name_case_insensitive() {
    let name = generate_table_name(&["table1", "TABLE2"]);
    assert_eq!(name, "Table3");
}

#[test]
fn generate_table_name_fills_gap() {
    let name = generate_table_name(&["Table1", "Table3"]);
    assert_eq!(name, "Table2");
}

// ---- tables_overlap ----

#[test]
fn tables_overlap_true() {
    let a = create_table(
        "A",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 3,
        },
        &["A", "B", "C", "D"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange {
            start_row: 3,
            start_col: 2,
            end_row: 8,
            end_col: 5,
        },
        &["E", "F", "G", "H"],
        None,
    )
    .unwrap();
    assert!(tables_overlap(&a, &b));
    assert!(tables_overlap(&b, &a)); // symmetric
}

#[test]
fn tables_overlap_false_no_col_overlap() {
    let a = create_table(
        "A",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 2,
        },
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 3,
            end_row: 5,
            end_col: 5,
        },
        &["D", "E", "F"],
        None,
    )
    .unwrap();
    assert!(!tables_overlap(&a, &b));
}

#[test]
fn tables_overlap_false_no_row_overlap() {
    let a = create_table(
        "A",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 2,
        },
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange {
            start_row: 6,
            start_col: 0,
            end_row: 10,
            end_col: 2,
        },
        &["D", "E", "F"],
        None,
    )
    .unwrap();
    assert!(!tables_overlap(&a, &b));
}

#[test]
fn tables_overlap_adjacent_not_overlapping() {
    // Tables sharing an edge (row 5/row 5) but not actually overlapping
    // since end_row == start_row is touching, which IS overlap
    let a = create_table(
        "A",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 2,
        },
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange {
            start_row: 5,
            start_col: 0,
            end_row: 10,
            end_col: 2,
        },
        &["D", "E", "F"],
        None,
    )
    .unwrap();
    // They share row 5, so this IS an overlap
    assert!(tables_overlap(&a, &b));
}

// ---- create_table with separate id ----

#[test]
fn create_table_with_separate_id() {
    let t = create_table(
        "MyTable",
        "s1",
        TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 1,
        },
        &["A", "B"],
        Some(CreateTableOptions {
            id: Some("custom-id-123".to_string()),
            ..Default::default()
        }),
    )
    .unwrap();
    assert_eq!(t.id, "custom-id-123");
    assert_eq!(t.name, "MyTable");
    assert_eq!(t.columns[0].id, "custom-id-123-col-0");
    assert_eq!(t.columns[1].id, "custom-id-123-col-1");
}

#[test]
fn create_table_id_defaults_to_name() {
    let t = make_test_table();
    assert_eq!(t.id, "TestTable");
    assert_eq!(t.name, "TestTable");
}

// ---- toggle_totals_row overflow guard ----

#[test]
fn toggle_totals_row_on_max_row_no_overflow() {
    let mut t = make_test_table();
    t.range.end_row = u32::MAX;
    let t2 = toggle_totals_row(&t);
    assert!(t2.has_totals_row);
    assert_eq!(t2.range.end_row, u32::MAX); // saturates, no overflow
}
