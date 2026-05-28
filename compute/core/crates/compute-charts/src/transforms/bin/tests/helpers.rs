use serde_json::json;

use crate::types::DataRow;

pub(super) fn make_row(field: &str, val: f64) -> DataRow {
    let mut row = DataRow::new();
    row.insert(field.to_string(), json!(val));
    row
}
