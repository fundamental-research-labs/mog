use crate::domain::pivot::read::{PivotCache, PivotTable};
use pivot_types::{DetectedDataType, FieldId, PivotField};
use value_types::CellValue;

use super::value_map::convert_pivot_item;

pub(super) fn build_fields(
    pivot: &PivotTable,
    cache: &PivotCache,
    cache_records: &[Vec<CellValue>],
) -> Vec<PivotField> {
    cache
        .fields
        .iter()
        .enumerate()
        .map(|(idx, cf)| {
            let pf = pivot.pivot_fields.get(idx);
            let data_field_info = pivot
                .data_fields
                .iter()
                .find(|df| df.field_index as usize == idx);
            PivotField {
                id: FieldId::from(cf.name.as_str()),
                name: cf.name.clone(),
                source_column: idx as u32,
                data_type: detect_data_type(cache_records, idx),
                num_fmt_id: data_field_info.and_then(|df| df.num_fmt_id),
                base_field: data_field_info.and_then(|df| df.base_field),
                base_item: data_field_info.and_then(|df| df.base_item),
                show_all: pf.and_then(|f| if f.show_all { Some(true) } else { None }),
                subtotal_top: pf.and_then(|f| if f.subtotal_top { None } else { Some(false) }),
                default_subtotal: pf.and_then(|f| {
                    if f.default_subtotal {
                        None
                    } else {
                        Some(false)
                    }
                }),
                subtotals: Vec::new(),
                items: pf
                    .map(|f| f.items.iter().map(convert_pivot_item).collect())
                    .unwrap_or_default(),
            }
        })
        .collect()
}

fn detect_data_type(records: &[Vec<CellValue>], col_idx: usize) -> DetectedDataType {
    let mut has_number = false;
    let mut has_text = false;
    let mut has_bool = false;
    let mut count = 0;

    for row in records.iter().take(100) {
        if let Some(val) = row.get(col_idx) {
            match val {
                CellValue::Number(_) => {
                    has_number = true;
                    count += 1;
                }
                CellValue::Text(_) => {
                    has_text = true;
                    count += 1;
                }
                CellValue::Boolean(_) => {
                    has_bool = true;
                    count += 1;
                }
                CellValue::Null => {}
                _ => {
                    count += 1;
                }
            }
        }
    }

    if count == 0 {
        return DetectedDataType::Empty;
    }
    if has_number && !has_text && !has_bool {
        return DetectedDataType::Number;
    }
    if has_bool && !has_text && !has_number {
        return DetectedDataType::Boolean;
    }
    DetectedDataType::String
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_sampled_column_data_types() {
        assert_eq!(detect_data_type(&[], 0), DetectedDataType::Empty);
        assert_eq!(
            detect_data_type(&[vec![CellValue::number(1.0)], vec![CellValue::Null]], 0),
            DetectedDataType::Number
        );
        assert_eq!(
            detect_data_type(&[vec![CellValue::Boolean(true)]], 0),
            DetectedDataType::Boolean
        );
        assert_eq!(
            detect_data_type(&[vec![CellValue::Text("x".into())]], 0),
            DetectedDataType::String
        );
        assert_eq!(
            detect_data_type(
                &[
                    vec![CellValue::number(1.0)],
                    vec![CellValue::Text("x".into())]
                ],
                0
            ),
            DetectedDataType::String
        );
    }

    #[test]
    fn only_samples_first_100_records() {
        let mut records = vec![vec![CellValue::number(1.0)]; 100];
        records.push(vec![CellValue::Text("later".into())]);
        assert_eq!(detect_data_type(&records, 0), DetectedDataType::Number);
    }
}
