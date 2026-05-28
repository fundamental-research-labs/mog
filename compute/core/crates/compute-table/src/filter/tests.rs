use super::*;
use crate::types::TableColorFilter;
use domain_types::CellFormat;
use value_types::{CellError, Color, FiniteF64};

mod color;
mod conditions;
mod dynamic;
mod edges;
mod state;
mod top_bottom;
mod values;

pub(super) mod fixtures {
    use super::*;

    pub(super) fn cv_num(n: f64) -> CellValue {
        CellValue::Number(FiniteF64::must(n))
    }

    pub(super) fn cv_text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    pub(super) fn cv_bool(b: bool) -> CellValue {
        CellValue::Boolean(b)
    }

    pub(super) fn cv_null() -> CellValue {
        CellValue::Null
    }

    pub(super) fn cv_err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }

    pub(super) fn cv_nan() -> CellValue {
        CellValue::number(f64::NAN)
    }

    pub(super) fn make_value_filter(
        included: Vec<CellValue>,
        include_blanks: bool,
    ) -> FilterCriteria {
        FilterCriteria::Values(ValueFilter {
            included,
            include_blanks,
        })
    }

    pub(super) fn make_condition_filter(
        conditions: Vec<TableFilterCondition>,
        logic: FilterLogic,
    ) -> FilterCriteria {
        FilterCriteria::Condition(ConditionFilter { conditions, logic })
    }

    pub(super) fn make_cond(op: FilterOperator, value: CellValue) -> TableFilterCondition {
        TableFilterCondition {
            operator: op,
            value,
            value2: None,
        }
    }

    pub(super) fn make_cond2(
        op: FilterOperator,
        value: CellValue,
        value2: CellValue,
    ) -> TableFilterCondition {
        TableFilterCondition {
            operator: op,
            value,
            value2: Some(value2),
        }
    }

    pub(super) fn eval(criteria: &FilterCriteria, data: &[CellValue]) -> Vec<u8> {
        evaluate_column_filter(criteria, data, None, None, None)
    }

    pub(super) fn eval_color(
        criteria: &FilterCriteria,
        data: &[CellValue],
        formats: &[CellFormat],
    ) -> Vec<u8> {
        evaluate_column_filter(criteria, data, Some(formats), None, None)
    }
}
