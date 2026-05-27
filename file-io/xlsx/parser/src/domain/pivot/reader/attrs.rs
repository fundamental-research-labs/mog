//! Pivot-specific attribute and enum parsing.

use crate::domain::pivot::model::{PivotAxis, PivotItemType, SortType, Subtotal};
use crate::infra::xml::{parse_string_attr, parse_u32_attr};

pub(crate) fn parse_axis_attr(xml: &[u8]) -> Option<PivotAxis> {
    let axis_str = parse_string_attr(xml, b"axis=\"")?;
    match axis_str.as_str() {
        "axisRow" => Some(PivotAxis::Row),
        "axisCol" => Some(PivotAxis::Col),
        "axisPage" => Some(PivotAxis::Page),
        "axisValues" => Some(PivotAxis::Values),
        _ => None,
    }
}

pub(crate) fn parse_sort_attr(xml: &[u8]) -> Option<SortType> {
    let sort_str = parse_string_attr(xml, b"sortType=\"")?;
    match sort_str.as_str() {
        "manual" => Some(SortType::Manual),
        "ascending" => Some(SortType::Ascending),
        "descending" => Some(SortType::Descending),
        _ => None,
    }
}

pub(crate) fn parse_subtotal_attr(xml: &[u8]) -> Subtotal {
    if let Some(subtotal_str) = parse_string_attr(xml, b"subtotal=\"") {
        match subtotal_str.as_str() {
            "sum" => Subtotal::Sum,
            "count" => Subtotal::Count,
            "average" => Subtotal::Average,
            "max" => Subtotal::Max,
            "min" => Subtotal::Min,
            "product" => Subtotal::Product,
            "countNums" => Subtotal::CountNums,
            "stdDev" => Subtotal::StdDev,
            "stdDevp" => Subtotal::StdDevP,
            "var" => Subtotal::Var,
            "varp" => Subtotal::VarP,
            _ => Subtotal::Sum,
        }
    } else {
        Subtotal::Sum
    }
}

pub(crate) fn parse_item_type_attr(xml: &[u8]) -> PivotItemType {
    if let Some(type_str) = parse_string_attr(xml, b"t=\"") {
        match type_str.as_str() {
            "data" => PivotItemType::Data,
            "default" => PivotItemType::Default,
            "sum" => PivotItemType::Sum,
            "countA" => PivotItemType::CountA,
            "avg" => PivotItemType::Avg,
            "max" => PivotItemType::Max,
            "min" => PivotItemType::Min,
            "product" => PivotItemType::Product,
            "count" => PivotItemType::Count,
            "stdDev" => PivotItemType::Stddev,
            "stdDevP" => PivotItemType::StddevP,
            "var" => PivotItemType::Var,
            "varP" => PivotItemType::VarP,
            "grand" => PivotItemType::Grand,
            "blank" => PivotItemType::Blank,
            _ => PivotItemType::Data,
        }
    } else {
        PivotItemType::Data
    }
}

pub(crate) fn parse_data_field_sentinel(xml: &[u8]) -> bool {
    parse_u32_attr(xml, b"field=\"") == Some(4294967294)
}
