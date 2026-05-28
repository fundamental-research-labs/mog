use crate::domain::pivot::read::{PivotItem, PivotItemType, PivotRowColItem, SharedItem, Subtotal};
use domain_types::domain::pivot::{
    PivotFieldItem, PivotItemType as DtPivotItemType, PivotRowColItem as DtPivotRowColItem,
};
use pivot_types::{AggregateFunction, FieldId, PivotField, ShowValuesAs, ShowValuesAsConfig};
use value_types::CellValue;

pub(super) fn convert_subtotal(s: &Subtotal) -> AggregateFunction {
    match s {
        Subtotal::Sum => AggregateFunction::Sum,
        Subtotal::Count => AggregateFunction::CountA,
        Subtotal::Average => AggregateFunction::Average,
        Subtotal::Max => AggregateFunction::Max,
        Subtotal::Min => AggregateFunction::Min,
        Subtotal::Product => AggregateFunction::Product,
        Subtotal::CountNums => AggregateFunction::Count,
        Subtotal::StdDev => AggregateFunction::StdDev,
        Subtotal::StdDevP => AggregateFunction::StdDevP,
        Subtotal::Var => AggregateFunction::Var,
        Subtotal::VarP => AggregateFunction::VarP,
    }
}

pub(super) fn convert_show_data_as(
    show_data_as: &Option<String>,
    base_field_idx: Option<i32>,
    fields: &[PivotField],
) -> Option<ShowValuesAsConfig> {
    let s = show_data_as.as_deref()?;

    let calculation_type = match s {
        "normal" => return None,
        "percentOfTotal" => ShowValuesAs::PercentOfGrandTotal,
        "percentOfRow" => ShowValuesAs::PercentOfRowTotal,
        "percentOfCol" => ShowValuesAs::PercentOfColumnTotal,
        "difference" => ShowValuesAs::Difference,
        "percentDiff" => ShowValuesAs::PercentDifference,
        "runTotal" => ShowValuesAs::RunningTotal,
        "index" => ShowValuesAs::Index,
        "percent" => ShowValuesAs::PercentOfParentRowTotal,
        "percentOfRunningTotal" => ShowValuesAs::PercentRunningTotal,
        "rankAscending" => ShowValuesAs::RankAscending,
        "rankDescending" => ShowValuesAs::RankDescending,
        "percentOfParentRow" => ShowValuesAs::PercentOfParentRowTotal,
        "percentOfParentCol" => ShowValuesAs::PercentOfParentColumnTotal,
        _ => return None,
    };

    let base_field = base_field_idx
        .filter(|&idx| idx >= 0)
        .and_then(|idx| fields.get(idx as usize))
        .map(|f| f.id.clone());

    Some(ShowValuesAsConfig {
        calculation_type,
        base_field,
        base_item: None,
    })
}

pub(super) fn shared_item_to_cell_value(item: &SharedItem) -> CellValue {
    match item {
        SharedItem::String(s) => CellValue::Text(s.as_str().into()),
        SharedItem::Number(n) => CellValue::number(*n),
        SharedItem::Boolean(b) => CellValue::Boolean(*b),
        SharedItem::Error(e) => e
            .parse::<value_types::CellError>()
            .map(|e| CellValue::Error(e, None))
            .unwrap_or(CellValue::Null),
        SharedItem::DateTime(s) => CellValue::Text(s.as_str().into()),
        SharedItem::Missing => CellValue::Null,
    }
}

pub(super) fn shared_item_to_key(item: &SharedItem) -> String {
    match item {
        SharedItem::String(s) => format!("T:{}", s.to_lowercase()),
        SharedItem::Number(n) => {
            let n = if *n == 0.0 { 0.0 } else { *n };
            format!("N:{}", n.to_bits())
        }
        SharedItem::Boolean(b) => format!("B:{b}"),
        SharedItem::Error(e) => format!("E:{e}"),
        SharedItem::DateTime(s) => format!("T:{}", s.to_lowercase()),
        SharedItem::Missing => "\x00BLANK\x00".to_string(),
    }
}

pub(super) fn convert_pivot_item(item: &PivotItem) -> PivotFieldItem {
    PivotFieldItem {
        item_type: convert_item_type(&item.item_type),
        value: item.x,
        hidden: item.hidden,
        show_details: item.show_details,
        s: item.s.clone(),
    }
}

pub(super) fn convert_row_col_item(item: &PivotRowColItem) -> DtPivotRowColItem {
    DtPivotRowColItem {
        item_type: item.item_type.as_ref().map(convert_item_type),
        x_values: item.x_values.clone(),
    }
}

fn convert_item_type(t: &PivotItemType) -> DtPivotItemType {
    match t {
        PivotItemType::Data => DtPivotItemType::Data,
        PivotItemType::Default => DtPivotItemType::Default,
        PivotItemType::Sum => DtPivotItemType::Sum,
        PivotItemType::CountA => DtPivotItemType::CountA,
        PivotItemType::Avg => DtPivotItemType::Avg,
        PivotItemType::Max => DtPivotItemType::Max,
        PivotItemType::Min => DtPivotItemType::Min,
        PivotItemType::Product => DtPivotItemType::Product,
        PivotItemType::Count => DtPivotItemType::Count,
        PivotItemType::Stddev => DtPivotItemType::StdDev,
        PivotItemType::StddevP => DtPivotItemType::StdDevP,
        PivotItemType::Var => DtPivotItemType::Var,
        PivotItemType::VarP => DtPivotItemType::VarP,
        PivotItemType::Grand => DtPivotItemType::Grand,
        PivotItemType::Blank => DtPivotItemType::Blank,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subtotal_count_mappings_match_engine_contract() {
        assert_eq!(
            convert_subtotal(&Subtotal::Count),
            AggregateFunction::CountA
        );
        assert_eq!(
            convert_subtotal(&Subtotal::CountNums),
            AggregateFunction::Count
        );
    }

    #[test]
    fn show_data_as_normal_and_unknown_are_elided() {
        let fields = vec![PivotField {
            id: FieldId::from("amount"),
            name: "Amount".to_string(),
            source_column: 0,
            data_type: pivot_types::DetectedDataType::Number,
            ..Default::default()
        }];

        assert!(convert_show_data_as(&None, Some(0), &fields).is_none());
        assert!(convert_show_data_as(&Some("normal".to_string()), Some(0), &fields).is_none());
        assert!(convert_show_data_as(&Some("bogus".to_string()), Some(0), &fields).is_none());

        let percent =
            convert_show_data_as(&Some("percentOfTotal".to_string()), Some(0), &fields).unwrap();
        assert_eq!(percent.calculation_type, ShowValuesAs::PercentOfGrandTotal);
        assert_eq!(percent.base_field, Some(FieldId::from("amount")));
        assert_eq!(percent.base_item, None);
    }

    #[test]
    fn shared_item_keys_preserve_canonical_encoding() {
        assert_eq!(
            shared_item_to_key(&SharedItem::String("West".to_string())),
            "T:west"
        );
        assert_eq!(
            shared_item_to_key(&SharedItem::DateTime("2024-01-01".to_string())),
            "T:2024-01-01"
        );
        assert_eq!(shared_item_to_key(&SharedItem::Boolean(true)), "B:true");
        assert_eq!(
            shared_item_to_key(&SharedItem::Error("#DIV/0!".to_string())),
            "E:#DIV/0!"
        );
        assert_eq!(shared_item_to_key(&SharedItem::Missing), "\x00BLANK\x00");
        assert_eq!(
            shared_item_to_key(&SharedItem::Number(-0.0)),
            shared_item_to_key(&SharedItem::Number(0.0))
        );
    }
}
