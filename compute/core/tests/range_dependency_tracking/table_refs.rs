use crate::matrix::CoverageReason;
use crate::summary::Summary;

pub(crate) fn table_ref_case_names() -> &'static [&'static str] {
    &[
        "table1_col_insert_row_head",
        "table1_col_insert_row_middle",
        "table1_col_insert_row_tail",
        "table1_col_delete_row_head",
        "table1_col_delete_row_middle",
        "table1_col_delete_row_tail",
        "table1_col_filter_added_column",
        "table1_col_total_row_toggle",
        "table1_col_rename_column",
        "table1_col_resize_range",
    ]
}

pub(crate) fn class_ii_table_refs_family_deferred() {
    let mut s = Summary::new("table_refs");
    for name in table_ref_case_names() {
        s.skip(CoverageReason::Round2Scope);
        let _ = name;
    }
    s.emit();
    // All ten cases are skipped; nothing to budget.
    assert_eq!(s.failed, 0);
    assert_eq!(s.passed, 0);
    assert_eq!(s.skipped, table_ref_case_names().len());
}
