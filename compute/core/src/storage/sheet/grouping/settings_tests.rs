use super::super::*;
use super::test_support::*;

#[test]
fn test_set_outline_settings() {
    let (s, id) = storage_with_sheet();
    set_outline_settings(
        s.doc(),
        &s.sheets_ref(),
        &id,
        &OutlineSettingsUpdate {
            summary_rows_below: Some(false),
            show_outline_symbols: Some(false),
            ..Default::default()
        },
    );
    let c = get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id);
    assert!(!c.summary_rows_below);
    assert!(!c.show_outline_symbols);
    assert!(c.summary_columns_right);
}
