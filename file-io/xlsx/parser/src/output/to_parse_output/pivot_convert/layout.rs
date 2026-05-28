use crate::domain::pivot::read::PivotTable;
use pivot_types::{LayoutForm, PivotTableLayout};

pub(super) fn build_layout(pivot: &PivotTable) -> PivotTableLayout {
    let has_non_compact = pivot.pivot_fields.iter().any(|f| !f.compact);
    let has_non_outline = pivot.pivot_fields.iter().any(|f| !f.outline);

    let layout_form = if has_non_compact && has_non_outline {
        Some(LayoutForm::Tabular)
    } else if has_non_compact {
        Some(LayoutForm::Outline)
    } else {
        None
    };

    PivotTableLayout {
        show_row_grand_totals: Some(pivot.row_grand_totals),
        show_column_grand_totals: Some(pivot.col_grand_totals),
        layout_form,
        subtotal_location: None,
        repeat_row_labels: None,
        insert_blank_row_after_item: None,
        show_row_headers: None,
        show_column_headers: None,
        classic_layout: None,
        grand_total_caption: pivot.grand_total_caption.clone(),
        row_header_caption: pivot.row_header_caption.clone(),
        col_header_caption: pivot.col_header_caption.clone(),
        data_caption: None,
        grid_drop_zones: if pivot.grid_drop_zones {
            Some(true)
        } else {
            None
        },
        error_caption: pivot.error_caption.clone(),
        show_error: if pivot.show_error { Some(true) } else { None },
        missing_caption: pivot.missing_caption.clone(),
        show_missing: if !pivot.show_missing {
            Some(false)
        } else {
            None
        },
    }
}
