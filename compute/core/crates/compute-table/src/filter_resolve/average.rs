use crate::types::{ConditionFilter, FilterLogic, FilterOperator, TableFilterCondition};
use value_types::CellValue;

/// Resolve an average filter. Computes average of finite numeric values.
///
/// Uses `GreaterThanOrEqual` for aboveAverage and `LessThanOrEqual` for
/// belowAverage (Excel semantics).
pub(super) fn resolve_average_filter(
    column_data: &[CellValue],
    operator: FilterOperator,
) -> ConditionFilter {
    let mut sum = 0.0;
    let mut count = 0u64;

    for v in column_data {
        if let CellValue::Number(n) = v {
            // FiniteF64 is always finite by construction, no guard needed.
            sum += n.get();
            count += 1;
        }
    }

    if count == 0 {
        // No numeric data — nothing matches.
        // Use operator with Infinity/-Infinity to produce empty result.
        let no_match_value = if operator == FilterOperator::GreaterThanOrEqual
            || operator == FilterOperator::GreaterThan
        {
            f64::INFINITY
        } else {
            f64::NEG_INFINITY
        };
        return ConditionFilter {
            conditions: vec![TableFilterCondition {
                operator,
                value: CellValue::number(no_match_value),
                value2: None,
            }],
            logic: FilterLogic::And,
        };
    }

    let avg = sum / count as f64;
    ConditionFilter {
        conditions: vec![TableFilterCondition {
            operator,
            value: CellValue::number(avg),
            value2: None,
        }],
        logic: FilterLogic::And,
    }
}
