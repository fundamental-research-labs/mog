use super::super::*;
use super::test_support::*;

#[test]
fn test_outline_symbols() {
    let (s, id) = storage_with_sheet();
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    let vp = Viewport {
        start_row: 0,
        end_row: 10,
        start_col: 0,
        end_col: 10,
    };
    let sy = get_outline_symbols(s.doc(), &s.sheets_ref(), &id, &vp);
    assert_eq!(sy.len(), 1);
    assert_eq!(sy[0].index, 6);
    assert_eq!(sy[0].group_id, g.id);
}

#[test]
fn test_outline_symbols_summary_above() {
    let (s, id) = storage_with_sheet();
    set_outline_settings(
        s.doc(),
        &s.sheets_ref(),
        &id,
        &OutlineSettingsUpdate {
            summary_rows_below: Some(false),
            summary_columns_right: Some(false),
            ..Default::default()
        },
    );
    let rg = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    let cg = group_columns(s.doc(), &s.sheets_ref(), &id, 3, 6).unwrap();
    let sy = get_outline_symbols(
        s.doc(),
        &s.sheets_ref(),
        &id,
        &Viewport {
            start_row: 0,
            end_row: 10,
            start_col: 0,
            end_col: 10,
        },
    );

    let row_symbol = sy.iter().find(|s| s.group_id == rg.id).unwrap();
    let col_symbol = sy.iter().find(|s| s.group_id == cg.id).unwrap();
    assert_eq!(row_symbol.index, 1);
    assert_eq!(col_symbol.index, 2);
}

#[test]
fn test_symbols_outside_viewport() {
    let (s, id) = storage_with_sheet();
    group_rows(s.doc(), &s.sheets_ref(), &id, 20, 30).unwrap();
    assert!(get_outline_symbols(
        s.doc(),
        &s.sheets_ref(),
        &id,
        &Viewport {
            start_row: 0,
            end_row: 10,
            start_col: 0,
            end_col: 10
        }
    )
    .is_empty());
}

#[test]
fn test_level_buttons() {
    let (s, id) = storage_with_sheet();
    group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
    group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
    let b: Vec<_> = get_outline_level_buttons(s.doc(), &s.sheets_ref(), &id)
        .into_iter()
        .filter(|x| x.axis == GroupAxis::Row)
        .collect();
    assert_eq!(b.len(), 3);
    assert_eq!(b[2].level, 3);
}

#[test]
fn test_render_data() {
    let (s, id) = storage_with_sheet();
    group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    group_columns(s.doc(), &s.sheets_ref(), &id, 1, 3).unwrap();
    let d = get_outline_render_data(
        s.doc(),
        &s.sheets_ref(),
        &id,
        &Viewport {
            start_row: 0,
            end_row: 10,
            start_col: 0,
            end_col: 10,
        },
    );
    assert_eq!(d.row_groups.len(), 1);
    assert_eq!(d.column_groups.len(), 1);
}

#[test]
fn test_should_render() {
    let (s, id) = storage_with_sheet();
    assert!(!should_render_outlines(s.doc(), &s.sheets_ref(), &id));
    group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    assert!(should_render_outlines(s.doc(), &s.sheets_ref(), &id));
    set_outline_settings(
        s.doc(),
        &s.sheets_ref(),
        &id,
        &OutlineSettingsUpdate {
            show_outline_symbols: Some(false),
            ..Default::default()
        },
    );
    assert!(!should_render_outlines(s.doc(), &s.sheets_ref(), &id));
}

#[test]
fn test_gutter() {
    let (s, id) = storage_with_sheet();
    assert_eq!(
        get_outline_gutter_dimensions(s.doc(), &s.sheets_ref(), &id, 16, 16),
        (0, 0)
    );
    group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
    group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
    assert_eq!(
        get_outline_gutter_dimensions(s.doc(), &s.sheets_ref(), &id, 16, 16),
        (32, 0)
    );
}
