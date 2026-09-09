use cell_types::SheetId;
use domain_types::CFStyle;
use domain_types::domain::conditional_format::{CFRule, ConditionalFormat};

use crate::engine_types::cf::CFCellRange;
use crate::storage::WorkbookStorage;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn storage_with_sheet() -> (WorkbookStorage, SheetId) {
    let mut storage = WorkbookStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");
    (storage, sheet_id)
}

pub(super) fn default_style() -> CFStyle {
    CFStyle {
        background_color: Some("#FF0000".into()),
        bold: Some(true),
        ..Default::default()
    }
}

pub(super) fn make_rule(id: &str, priority: i32) -> CFRule {
    CFRule::CellValue {
        id: id.to_string(),
        priority,
        stop_if_true: None,
        operator: ooxml_types::cond_format::CfOperator::GreaterThan,
        value1: serde_json::json!(10),
        value2: None,
        style: default_style(),
        text: None,
    }
}

pub(super) fn make_format(
    id: &str,
    sheet_id: &SheetId,
    ranges: Vec<CFCellRange>,
    rules: Vec<CFRule>,
) -> ConditionalFormat {
    ConditionalFormat {
        id: id.to_string(),
        sheet_id: sheet_id.to_uuid_string(),
        pivot: None,

        ranges,
        rules,
    }
}

pub(super) fn rng(sr: u32, sc: u32, er: u32, ec: u32) -> CFCellRange {
    CFCellRange::new(sr, sc, er, ec)
}
