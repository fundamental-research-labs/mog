use crate::cf::types::{CFOperator, CFTextOperator, DatePeriod};

/// Narrow the OOXML `CfOperator` (12 variants covering both cellIs and text
/// ops) to compute-cf's `CFOperator` (8-variant cellIs-only subset). Returns
/// `None` if the input is a text-only variant - which should never appear on
/// `CFRule::CellValue.operator` by construction, so `None` is a soft warn.
pub(super) fn parse_cf_operator(op: ooxml_types::cond_format::CfOperator) -> Option<CFOperator> {
    use ooxml_types::cond_format::CfOperator as OoxmlOp;
    match op {
        OoxmlOp::GreaterThan => Some(CFOperator::GreaterThan),
        OoxmlOp::LessThan => Some(CFOperator::LessThan),
        OoxmlOp::GreaterThanOrEqual => Some(CFOperator::GreaterThanOrEqual),
        OoxmlOp::LessThanOrEqual => Some(CFOperator::LessThanOrEqual),
        OoxmlOp::Equal => Some(CFOperator::Equal),
        OoxmlOp::NotEqual => Some(CFOperator::NotEqual),
        OoxmlOp::Between => Some(CFOperator::Between),
        OoxmlOp::NotBetween => Some(CFOperator::NotBetween),
        OoxmlOp::ContainsText | OoxmlOp::NotContains | OoxmlOp::BeginsWith | OoxmlOp::EndsWith => {
            tracing::warn!(
                "CF CellValue.operator carried text-op variant {:?}, skipping",
                op
            );
            None
        }
    }
}

/// Narrow the OOXML `CfOperator` to compute-cf's 4-variant text-op enum.
pub(super) fn parse_text_operator(
    op: ooxml_types::cond_format::CfOperator,
) -> Option<CFTextOperator> {
    use ooxml_types::cond_format::CfOperator as OoxmlOp;
    match op {
        OoxmlOp::ContainsText => Some(CFTextOperator::Contains),
        OoxmlOp::NotContains => Some(CFTextOperator::NotContains),
        OoxmlOp::BeginsWith => Some(CFTextOperator::BeginsWith),
        OoxmlOp::EndsWith => Some(CFTextOperator::EndsWith),
        _ => {
            tracing::warn!("CF ContainsText.operator carried non-text variant {:?}", op);
            None
        }
    }
}

/// Map the OOXML `CfTimePeriod` (10 variants) to compute-cf's `DatePeriod`
/// (16 variants - includes Quarter / Year extensions the OOXML enum lacks).
pub(super) fn parse_date_period(tp: ooxml_types::cond_format::CfTimePeriod) -> Option<DatePeriod> {
    use ooxml_types::cond_format::CfTimePeriod as OoxmlTp;
    Some(match tp {
        OoxmlTp::Yesterday => DatePeriod::Yesterday,
        OoxmlTp::Today => DatePeriod::Today,
        OoxmlTp::Tomorrow => DatePeriod::Tomorrow,
        OoxmlTp::Last7Days => DatePeriod::Last7Days,
        OoxmlTp::LastWeek => DatePeriod::LastWeek,
        OoxmlTp::ThisWeek => DatePeriod::ThisWeek,
        OoxmlTp::NextWeek => DatePeriod::NextWeek,
        OoxmlTp::LastMonth => DatePeriod::LastMonth,
        OoxmlTp::ThisMonth => DatePeriod::ThisMonth,
        OoxmlTp::NextMonth => DatePeriod::NextMonth,
    })
}
