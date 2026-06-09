use domain_types::SheetView;
use ooxml_types::worksheet::{Pane, PaneState, Selection, SheetPane, SheetView as OoxmlSheetView};

#[test]
fn from_ooxml_uses_active_pane_selection_for_saved_active_cell() {
    let mut sv = OoxmlSheetView {
        pane: Some(SheetPane {
            x_split: 8.0,
            y_split: 440.0,
            top_left_cell: Some("I441".to_string()),
            active_pane: Some(Pane::BottomRight),
            state: Some(PaneState::Frozen),
        }),
        ..OoxmlSheetView::default()
    };
    sv.selections = vec![
        Selection {
            pane: Some(Pane::TopLeft),
            active_cell: Some("A1".to_string()),
            active_cell_id: None,
            sqref: Some("A1".to_string()),
        },
        Selection {
            pane: Some(Pane::BottomRight),
            active_cell: Some("AJ454".to_string()),
            active_cell_id: None,
            sqref: Some("AJ454".to_string()),
        },
    ];

    let view = SheetView::from_ooxml(&sv);

    assert_eq!(view.active_cell.as_deref(), Some("AJ454"));
    assert_eq!(view.sqref.as_deref(), Some("AJ454"));
}

#[test]
fn from_ooxml_uses_pane_top_left_cell_for_saved_scroll() {
    let sv = OoxmlSheetView {
        pane: Some(SheetPane {
            x_split: 8.0,
            y_split: 440.0,
            top_left_cell: Some("I441".to_string()),
            active_pane: Some(Pane::BottomRight),
            state: Some(PaneState::Frozen),
        }),
        ..OoxmlSheetView::default()
    };

    let view = SheetView::from_ooxml(&sv);

    assert_eq!(view.scroll_row, 440);
    assert_eq!(view.scroll_col, 8);
    assert!(!view.has_explicit_top_left_cell);
}

#[test]
fn from_ooxml_prefers_sheet_view_top_left_cell_over_pane_top_left_cell() {
    let sv = OoxmlSheetView {
        top_left_cell: Some("C7".to_string()),
        pane: Some(SheetPane {
            x_split: 8.0,
            y_split: 440.0,
            top_left_cell: Some("I441".to_string()),
            active_pane: Some(Pane::BottomRight),
            state: Some(PaneState::Frozen),
        }),
        ..OoxmlSheetView::default()
    };

    let view = SheetView::from_ooxml(&sv);

    assert_eq!(view.scroll_row, 6);
    assert_eq!(view.scroll_col, 2);
    assert!(view.has_explicit_top_left_cell);
}
