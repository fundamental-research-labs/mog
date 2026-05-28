use super::*;

pub(super) fn layout_with_form(form: LayoutForm) -> PivotTableLayout {
    PivotTableLayout {
        layout_form: Some(form),
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    }
}

pub(super) fn assert_no_compute_errors(result: &PivotTableResult, context: &str) {
    assert!(
        result.errors.is_none(),
        "{context} errors: {:?}",
        result.errors
    );
}

pub(super) fn data_rows(result: &PivotTableResult) -> Vec<&PivotRow> {
    result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect()
}

pub(super) fn leaf_rows(result: &PivotTableResult) -> Vec<&PivotRow> {
    data_rows(result)
}

pub(super) fn subtotal_rows(result: &PivotTableResult) -> Vec<&PivotRow> {
    result.rows.iter().filter(|r| r.is_subtotal).collect()
}

pub(super) fn subtotal_with_outer_header<'a>(
    rows: &'a [&PivotRow],
    outer_header: &str,
) -> Option<&'a PivotRow> {
    let total_header = CellValue::Text(format!("{outer_header} Total").into());
    rows.iter().copied().find(|row| {
        row.headers
            .iter()
            .any(|h| h.value == cv_text(outer_header) || h.value == total_header)
    })
}
