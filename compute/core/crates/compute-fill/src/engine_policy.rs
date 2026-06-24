use value_types::CellValue;

use crate::patterns::detect_fill_pattern;
use crate::types::*;

pub(crate) struct FillPolicy {
    pub(crate) include_values: bool,
    pub(crate) include_formulas: bool,
    pub(crate) include_formats: bool,
}

impl FillPolicy {
    pub(crate) fn from_request(mode: FillMode, request: &FillRequest) -> Self {
        let (include_values, include_formulas, include_formats) = match mode {
            FillMode::Formats => (false, false, true),
            FillMode::Values | FillMode::WithoutFormats => (true, true, false),
            _ => (
                request.include_values,
                request.include_formulas,
                request.include_formats,
            ),
        };

        Self {
            include_values,
            include_formulas,
            include_formats,
        }
    }
}

pub(crate) fn copy_pattern() -> FillPattern {
    FillPattern {
        pattern_type: FillPatternType::Copy,
        step: None,
        multiplier: None,
        date_unit: None,
        time_unit: None,
        start_index: None,
        prefix: None,
        num_digits: None,
        list_id: None,
    }
}

pub(crate) fn determine_lane_pattern(
    mode: FillMode,
    source_values: &[CellValue],
    request: &FillRequest,
    custom_lists: &[CustomList],
    locale: &LocaleNames,
) -> FillPattern {
    let mut pattern = determine_pattern(mode, source_values, custom_lists, locale);

    if mode == FillMode::Series && pattern.pattern_type == FillPatternType::Copy {
        if source_values
            .iter()
            .any(|value| matches!(value, CellValue::Number(_)))
        {
            pattern.pattern_type = FillPatternType::Linear;
            pattern.step = Some(request.step_value);
        }
    } else if request.step_value != 1.0 && pattern.pattern_type == FillPatternType::Linear {
        pattern.step = Some(request.step_value);
    }

    pattern
}

fn determine_pattern(
    mode: FillMode,
    source_values: &[CellValue],
    custom_lists: &[CustomList],
    locale: &LocaleNames,
) -> FillPattern {
    match mode {
        FillMode::Copy => copy_pattern(),
        FillMode::Days => FillPattern {
            pattern_type: FillPatternType::Date,
            date_unit: Some(DateUnit::Day),
            step: Some(1.0),
            ..copy_pattern()
        },
        FillMode::Weekdays => FillPattern {
            pattern_type: FillPatternType::Date,
            date_unit: Some(DateUnit::Weekday),
            step: Some(1.0),
            ..copy_pattern()
        },
        FillMode::Months => {
            let detected = detect_fill_pattern(source_values, custom_lists, locale);
            if matches!(
                detected.pattern_type,
                FillPatternType::Month | FillPatternType::MonthShort
            ) {
                detected
            } else {
                FillPattern {
                    pattern_type: FillPatternType::Date,
                    date_unit: Some(DateUnit::Month),
                    step: Some(1.0),
                    ..copy_pattern()
                }
            }
        }
        FillMode::Years => FillPattern {
            pattern_type: FillPatternType::Date,
            date_unit: Some(DateUnit::Year),
            step: Some(1.0),
            ..copy_pattern()
        },
        FillMode::LinearTrend => FillPattern {
            pattern_type: FillPatternType::Linear,
            step: Some(1.0),
            ..copy_pattern()
        },
        FillMode::GrowthTrend => FillPattern {
            pattern_type: FillPatternType::Growth,
            multiplier: Some(2.0),
            ..copy_pattern()
        },
        FillMode::Auto
        | FillMode::Series
        | FillMode::Formats
        | FillMode::Values
        | FillMode::WithoutFormats => {
            if source_values.is_empty() {
                copy_pattern()
            } else {
                detect_fill_pattern(source_values, custom_lists, locale)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(mode: FillMode) -> FillRequest {
        FillRequest {
            source_range: FillRangeSpec {
                start_row: 0,
                start_col: 0,
                end_row: 0,
                end_col: 0,
            },
            target_range: FillRangeSpec {
                start_row: 0,
                start_col: 0,
                end_row: 3,
                end_col: 0,
            },
            direction: FillDirection::Down,
            mode,
            include_formulas: true,
            include_values: true,
            include_formats: true,
            step_value: 1.0,
        }
    }

    #[test]
    fn months_mode_preserves_full_month_text_pattern() {
        let pattern = determine_lane_pattern(
            FillMode::Months,
            &[CellValue::Text("January".into())],
            &request(FillMode::Months),
            &[],
            &LocaleNames::default(),
        );

        assert_eq!(pattern.pattern_type, FillPatternType::Month);
    }

    #[test]
    fn months_mode_preserves_short_month_text_pattern() {
        let pattern = determine_lane_pattern(
            FillMode::Months,
            &[CellValue::Text("Jan".into())],
            &request(FillMode::Months),
            &[],
            &LocaleNames::default(),
        );

        assert_eq!(pattern.pattern_type, FillPatternType::MonthShort);
    }
}
