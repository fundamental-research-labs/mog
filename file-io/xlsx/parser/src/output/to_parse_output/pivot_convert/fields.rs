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
                show_all: pf.and_then(|f| f.show_all),
                subtotal_top: pf.and_then(|f| if f.subtotal_top { None } else { Some(false) }),
                default_subtotal: pf.and_then(|f| {
                    if f.default_subtotal {
                        None
                    } else {
                        Some(false)
                    }
                }),
                subtotals: pf
                    .map(|f| f.subtotals.iter().map(convert_subtotal_function).collect())
                    .unwrap_or_default(),
                items: pf
                    .map(|f| f.items.iter().map(convert_pivot_item).collect())
                    .unwrap_or_default(),
            }
        })
        .collect()
}

fn convert_subtotal_function(
    subtotal: &crate::domain::pivot::model::Subtotal,
) -> domain_types::domain::pivot::PivotFieldFunction {
    match subtotal {
        crate::domain::pivot::model::Subtotal::Sum => {
            domain_types::domain::pivot::PivotFieldFunction::Sum
        }
        crate::domain::pivot::model::Subtotal::Count => {
            domain_types::domain::pivot::PivotFieldFunction::Count
        }
        crate::domain::pivot::model::Subtotal::Average => {
            domain_types::domain::pivot::PivotFieldFunction::Average
        }
        crate::domain::pivot::model::Subtotal::Max => {
            domain_types::domain::pivot::PivotFieldFunction::Max
        }
        crate::domain::pivot::model::Subtotal::Min => {
            domain_types::domain::pivot::PivotFieldFunction::Min
        }
        crate::domain::pivot::model::Subtotal::Product => {
            domain_types::domain::pivot::PivotFieldFunction::Product
        }
        crate::domain::pivot::model::Subtotal::CountNums => {
            domain_types::domain::pivot::PivotFieldFunction::CountNums
        }
        crate::domain::pivot::model::Subtotal::StdDev => {
            domain_types::domain::pivot::PivotFieldFunction::StdDev
        }
        crate::domain::pivot::model::Subtotal::StdDevP => {
            domain_types::domain::pivot::PivotFieldFunction::StdDevP
        }
        crate::domain::pivot::model::Subtotal::Var => {
            domain_types::domain::pivot::PivotFieldFunction::Var
        }
        crate::domain::pivot::model::Subtotal::VarP => {
            domain_types::domain::pivot::PivotFieldFunction::VarP
        }
    }
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
