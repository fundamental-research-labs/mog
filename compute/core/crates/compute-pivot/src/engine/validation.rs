//! Validation and resolution of pivot table configurations.

use std::collections::{HashMap, HashSet};

use crate::calc_field::parse_calc_field;
use crate::resolved::{
    ResolvedAxisPlacement, ResolvedCalculatedField, ResolvedFilter, ResolvedFilterPlacement,
    ResolvedLayout, ResolvedPivotConfig, ResolvedSortByValue, ResolvedTopBottom,
    ResolvedValuePlacement,
};
use crate::types::{
    BinaryFilterOp, FieldId, FilterOperator, LayoutForm, NullaryFilterOp, PivotError, PivotField,
    PivotFieldArea, PivotFieldPlacement, PivotFilterCondition, PivotFilterConditionFlat,
    PivotTableConfig, ShowValuesAs, SortDirection, TopBottomBy, UnaryFilterOp,
};

/// Validate and resolve a pivot table configuration.
///
/// Converts the wire-format `PivotTableConfig` into a `ResolvedPivotConfig` where:
/// - All field references are resolved to column indices
/// - All defaults are resolved to concrete values
/// - All flat serde types are converted to type-safe enums
/// - All validation checks pass (field references, number grouping, etc.)
///
/// This is the ONLY way to construct a `ResolvedPivotConfig`.
///
/// # Errors
///
/// Returns `Err(PivotError)` if validation fails (missing fields, unknown references,
/// invalid configurations, etc.). Multiple errors may be collected into
/// `PivotError::Multiple`.
///
/// # Panics
///
/// Panics (via `.unwrap()`) only when there is exactly one error in a non-empty
/// error list, which is guaranteed by the preceding length check.
pub fn validate_and_resolve(config: &PivotTableConfig) -> Result<ResolvedPivotConfig, PivotError> {
    let mut errors: Vec<PivotError> = Vec::new();

    // ---- 1. Basic required-field validation ----

    if config.id.is_empty() {
        errors.push(PivotError::MissingField {
            field: "id".to_string(),
            message: "Pivot table ID is required".to_string(),
        });
    }

    if config.source_sheet_id.is_none() && config.source_sheet_name.is_empty() {
        errors.push(PivotError::MissingField {
            field: "source_sheet_id".to_string(),
            message: "Source sheet ID is required unless source sheet name is provided for legacy configs".to_string(),
        });
    }

    if config.output_sheet_name.is_empty() {
        errors.push(PivotError::MissingField {
            field: "output_sheet_name".to_string(),
            message: "Output sheet name is required".to_string(),
        });
    }

    // Validate source_range is not inverted and has at least 2 rows (header + 1 data row)
    {
        let sr = &config.source_range;
        if sr.end_row() < sr.start_row() {
            errors.push(PivotError::ValidationError {
                message: format!(
                    "source_range has inverted rows: end_row ({}) < start_row ({})",
                    sr.end_row(),
                    sr.start_row()
                ),
            });
        }
        if sr.end_col() < sr.start_col() {
            errors.push(PivotError::ValidationError {
                message: format!(
                    "source_range has inverted columns: end_col ({}) < start_col ({})",
                    sr.end_col(),
                    sr.start_col()
                ),
            });
        }
        if sr.end_row() >= sr.start_row() && sr.end_row() - sr.start_row() < 1 {
            errors.push(PivotError::ValidationError {
                message: "source_range must contain at least 2 rows (header + 1 data row)"
                    .to_string(),
            });
        }
    }

    if config.fields.is_empty() {
        errors.push(PivotError::MissingField {
            field: "fields".to_string(),
            message: "At least one field is required".to_string(),
        });
    }

    // If fields are empty, we can't resolve anything — bail early.
    if !errors.is_empty() && config.fields.is_empty() {
        return Err(if errors.len() == 1 {
            errors.into_iter().next().unwrap()
        } else {
            PivotError::Multiple { errors }
        });
    }

    // ---- 2. Build field map ----

    let field_map: HashMap<&str, &PivotField> =
        config.fields.iter().map(|f| (f.id.as_ref(), f)).collect();

    if field_map.len() != config.fields.len() {
        errors.push(PivotError::ValidationError {
            message: "Duplicate field IDs detected".to_string(),
        });
    }

    // Calculated-field IDs — collected up-front so value placements that
    // reference a calculated field (introspection placements added by the
    // TS API so readPivot/queryPivot can list calculated fields in the
    // Values zone) are accepted as valid. Calculated fields themselves
    // are computed via the separate `apply_calc_fields_to_values` path,
    // so we deliberately do NOT push a `ResolvedValuePlacement` for them
    // — they are not "regular" aggregations.
    let calc_field_ids: HashSet<&str> = config
        .calculated_fields
        .as_ref()
        .map(|cfs| cfs.iter().map(|cf| cf.field_id.as_ref()).collect())
        .unwrap_or_default();

    // ---- 3. First pass: collect value placements (needed for sort-by-value & top-bottom resolution) ----

    let mut value_placements: Vec<ResolvedValuePlacement> = Vec::new();
    for placement in &config.placements {
        if let PivotFieldPlacement::Value(val) = placement {
            match field_map.get(val.base.field_id.as_ref()) {
                Some(field) => {
                    value_placements.push(ResolvedValuePlacement {
                        field_id: val.base.field_id.clone(),
                        column_index: field.source_column as usize,
                        position: val.base.position,
                        display_name: val.base.display_name.clone(),
                        aggregate_function: val.aggregate_function,
                        number_format: val.number_format.clone(),
                        show_values_as: val.show_values_as.clone(),
                    });
                }
                None if calc_field_ids.contains(val.base.field_id.as_ref()) => {
                    // Calculated-field introspection placement — engine
                    // emits it via apply_calc_fields_to_values, not via
                    // ResolvedValuePlacement. Skip silently.
                }
                None => {
                    errors.push(PivotError::UnknownField {
                        field_id: val.base.field_id.to_string(),
                        context: "value placement references unknown field".to_string(),
                    });
                }
            }
        }
    }

    // Validate ShowValuesAs base_field requirements
    for placement in &config.placements {
        if let PivotFieldPlacement::Value(val) = placement
            && let Some(ref sva) = val.show_values_as
        {
            match sva.calculation_type {
                ShowValuesAs::Difference
                | ShowValuesAs::PercentDifference
                | ShowValuesAs::RunningTotal
                | ShowValuesAs::PercentRunningTotal
                | ShowValuesAs::RankAscending
                | ShowValuesAs::RankDescending => {
                    if sva.base_field.is_none() {
                        errors.push(PivotError::InvalidValue {
                            field: val.base.field_id.to_string(),
                            message: format!("{:?} requires a base_field", sva.calculation_type),
                        });
                    }
                }
                _ => {}
            }
        }
    }

    // ---- 4. Resolve placements by area ----

    let mut row_placements: Vec<ResolvedAxisPlacement> = Vec::new();
    let mut column_placements: Vec<ResolvedAxisPlacement> = Vec::new();
    let mut filter_placements: Vec<ResolvedFilterPlacement> = Vec::new();

    for placement in &config.placements {
        match placement {
            PivotFieldPlacement::Row(axis) | PivotFieldPlacement::Column(axis) => {
                let is_row = matches!(placement, PivotFieldPlacement::Row(_));
                match field_map.get(axis.base.field_id.as_ref()) {
                    Some(field) => {
                        // Resolve sort-by-value
                        let sort_by_value = match &axis.sort_by_value {
                            Some(sbv) => {
                                if let Some(idx) = value_placements
                                    .iter()
                                    .position(|vp| vp.field_id == sbv.value_field_id)
                                {
                                    Some(ResolvedSortByValue {
                                        value_field_index: idx,
                                        order: sbv.order,
                                        column_key: sbv.column_key.clone(),
                                    })
                                } else {
                                    errors.push(PivotError::UnknownField {
                                        field_id: sbv.value_field_id.to_string(),
                                        context: format!(
                                            "sort_by_value on field '{}' references unknown value field",
                                            axis.base.field_id
                                        ),
                                    });
                                    None
                                }
                            }
                            None => None,
                        };

                        // Validate number grouping
                        let number_grouping = match &axis.number_grouping {
                            Some(ng) => match ng.validate() {
                                Ok(()) => Some(ng.clone()),
                                Err(msg) => {
                                    errors.push(PivotError::InvalidValue {
                                        field: axis.base.field_id.to_string(),
                                        message: msg,
                                    });
                                    None
                                }
                            },
                            None => None,
                        };

                        let resolved = ResolvedAxisPlacement {
                            field_id: axis.base.field_id.clone(),
                            column_index: field.source_column as usize,
                            position: axis.base.position,
                            display_name: axis.base.display_name.clone(),
                            sort_order: axis.sort_order.unwrap_or(SortDirection::Asc),
                            custom_sort_list: axis.custom_sort_list.clone(),
                            sort_by_value,
                            date_grouping: axis.date_grouping,
                            number_grouping,
                            show_subtotals: axis.show_subtotals.unwrap_or(false),
                        };

                        if is_row {
                            row_placements.push(resolved);
                        } else {
                            column_placements.push(resolved);
                        }
                    }
                    None => {
                        errors.push(PivotError::UnknownField {
                            field_id: axis.base.field_id.to_string(),
                            context: format!(
                                "{} placement references unknown field",
                                if is_row { "row" } else { "column" }
                            ),
                        });
                    }
                }
            }
            PivotFieldPlacement::Filter(fp) => match field_map.get(fp.base.field_id.as_ref()) {
                Some(field) => {
                    filter_placements.push(ResolvedFilterPlacement {
                        field_id: fp.base.field_id.clone(),
                        column_index: field.source_column as usize,
                        position: fp.base.position,
                        display_name: fp.base.display_name.clone(),
                    });
                }
                None => {
                    errors.push(PivotError::UnknownField {
                        field_id: fp.base.field_id.to_string(),
                        context: "filter placement references unknown field".to_string(),
                    });
                }
            },
            _ => {}
        }
    }

    // Sort placements by position
    row_placements.sort_by_key(|p| p.position);
    column_placements.sort_by_key(|p| p.position);
    value_placements.sort_by_key(|p| p.position);
    filter_placements.sort_by_key(|p| p.position);

    // ---- 5. Resolve filters ----

    let mut resolved_filters: Vec<ResolvedFilter> = Vec::new();
    for filter in &config.filters {
        let field_column_index = if let Some(field) = field_map.get(filter.field_id.as_ref()) {
            field.source_column as usize
        } else {
            errors.push(PivotError::UnknownField {
                field_id: filter.field_id.to_string(),
                context: "filter references unknown field".to_string(),
            });
            continue;
        };

        // Convert flat condition to type-safe condition with validation
        let condition = match &filter.condition {
            Some(flat) => match validate_filter_condition_flat(flat, &filter.field_id) {
                Ok(cond) => Some(cond),
                Err(e) => {
                    errors.push(e);
                    None
                }
            },
            None => None,
        };

        // Resolve top_bottom
        let top_bottom = match &filter.top_bottom {
            Some(tb) => {
                let value_field_index = match &tb.value_field_id {
                    Some(vfid) => {
                        if let Some(idx) =
                            value_placements.iter().position(|vp| vp.field_id == *vfid)
                        {
                            Some(idx)
                        } else {
                            errors.push(PivotError::UnknownField {
                                field_id: vfid.to_string(),
                                context: format!(
                                    "top_bottom filter on field '{}' references unknown value field",
                                    filter.field_id
                                ),
                            });
                            None
                        }
                    }
                    None => None,
                };

                // Validate tb.n
                if !tb.n.is_finite() {
                    errors.push(PivotError::InvalidValue {
                        field: filter.field_id.to_string(),
                        message: "top_bottom.n must be finite".to_string(),
                    });
                } else if tb.n < 0.0 {
                    errors.push(PivotError::InvalidValue {
                        field: filter.field_id.to_string(),
                        message: "top_bottom.n must be non-negative".to_string(),
                    });
                } else if tb.by == TopBottomBy::Items
                    && tb.n > 0.0
                    && (tb.n - tb.n.trunc()).abs() > f64::EPSILON
                {
                    errors.push(PivotError::InvalidValue {
                        field: filter.field_id.to_string(),
                        message: "top_bottom.n must be an integer for Items mode".to_string(),
                    });
                }

                Some(ResolvedTopBottom {
                    filter_type: tb.filter_type,
                    n: tb.n,
                    by: tb.by,
                    value_field_index,
                })
            }
            None => None,
        };

        resolved_filters.push(ResolvedFilter {
            field_id: filter.field_id.clone(),
            field_column_index,
            include_values: filter.include_values.clone(),
            exclude_values: filter.exclude_values.clone(),
            condition,
            top_bottom,
            show_items_with_no_data: filter.show_items_with_no_data.unwrap_or(true),
        });
    }

    // ---- 6. Resolve layout ----

    let layout_ref = config.layout.as_ref();
    let layout = ResolvedLayout {
        show_row_grand_totals: layout_ref
            .and_then(|l| l.show_row_grand_totals)
            .unwrap_or(true),
        show_column_grand_totals: layout_ref
            .and_then(|l| l.show_column_grand_totals)
            .unwrap_or(true),
        layout_form: layout_ref
            .and_then(|l| l.layout_form.clone())
            .unwrap_or(LayoutForm::Compact),
        repeat_all_item_labels: layout_ref
            .and_then(|l| l.repeat_row_labels)
            .unwrap_or(false),
        show_empty_rows: false,
        show_empty_columns: false,
        subtotal_at_top: layout_ref
            .and_then(|l| l.subtotal_location.as_ref())
            .is_some_and(|loc| matches!(loc, crate::types::SubtotalLocation::Top)),
        grand_total_caption: layout_ref.and_then(|l| l.grand_total_caption.clone()),
    };

    // ---- 7. Resolve calculated fields ----

    let mut resolved_calc_fields: Vec<ResolvedCalculatedField> = Vec::new();
    if let Some(ref calc_fields) = config.calculated_fields {
        for cf in calc_fields {
            if cf.field_id.is_empty() {
                errors.push(PivotError::MissingField {
                    field: "calculated_fields[].field_id".to_string(),
                    message: "Calculated field ID is required".to_string(),
                });
                continue;
            }
            if cf.name.is_empty() {
                errors.push(PivotError::MissingField {
                    field: format!("calculated_fields[{}].name", cf.field_id),
                    message: format!("Calculated field '{}' has empty name", cf.field_id),
                });
                continue;
            }
            if cf.formula.is_empty() {
                errors.push(PivotError::InvalidFormula {
                    field_id: cf.field_id.to_string(),
                    message: format!("Calculated field '{}' has empty formula", cf.name),
                });
                continue;
            }
            match parse_calc_field(&cf.formula) {
                Ok(parsed_expr) => {
                    resolved_calc_fields.push(ResolvedCalculatedField {
                        field_id: FieldId::from(cf.field_id.as_str()),
                        name: cf.name.clone(),
                        formula: cf.formula.clone(),
                        parsed_expr,
                    });
                }
                Err(e) => {
                    errors.push(PivotError::InvalidFormula {
                        field_id: cf.field_id.to_string(),
                        message: format!("Calculated field '{}' formula error: {}", cf.name, e),
                    });
                }
            }
        }
    }

    // ---- 8. Check duplicate placements ----

    {
        let mut seen: HashSet<(String, u8)> = HashSet::new();
        for placement in &config.placements {
            // Value area allows duplicates (e.g., Sum of Sales + Average of Sales)
            if placement.is_value() {
                continue;
            }
            let area_key = match placement.area() {
                PivotFieldArea::Row => 0,
                PivotFieldArea::Column => 1,
                PivotFieldArea::Filter => 3,
                PivotFieldArea::Value => unreachable!(),
                _ => continue,
            };
            let combo = (placement.field_id().to_string(), area_key);
            if !seen.insert(combo) {
                errors.push(PivotError::DuplicatePlacement {
                    field_id: placement.field_id().to_string(),
                    area: format!("{:?}", placement.area()),
                });
            }
        }
    }

    // ---- 9. Return result ----

    if !errors.is_empty() {
        return Err(if errors.len() == 1 {
            errors.into_iter().next().unwrap()
        } else {
            PivotError::Multiple { errors }
        });
    }

    Ok(ResolvedPivotConfig {
        id: config.id.clone(),
        source_sheet_id: config.source_sheet_id.clone(),
        source_sheet_name: config.source_sheet_name.clone(),
        source_range: config.source_range,
        output_sheet_name: config.output_sheet_name.clone(),
        output_location: config.output_location.clone(),
        fields: config.fields.clone(),
        row_placements,
        column_placements,
        value_placements,
        filter_placements,
        filters: resolved_filters,
        layout,
        calculated_fields: resolved_calc_fields,
    })
}

/// Validate a flat filter condition and convert it to the type-safe enum.
///
/// Checks that binary operators have `value` and ternary operators have both
/// `value` and `value2`. Unary operators don't need operands.
fn validate_filter_condition_flat(
    flat: &PivotFilterConditionFlat,
    field_id: &FieldId,
) -> Result<PivotFilterCondition, PivotError> {
    match flat.operator {
        // Nullary — no operands needed
        FilterOperator::IsBlank => Ok(PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank)),
        FilterOperator::IsNotBlank => {
            Ok(PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank))
        }
        FilterOperator::AboveAverage => {
            Ok(PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage))
        }
        FilterOperator::BelowAverage => {
            Ok(PivotFilterCondition::Nullary(NullaryFilterOp::BelowAverage))
        }

        // Unary — value must be Some
        FilterOperator::Equals
        | FilterOperator::NotEquals
        | FilterOperator::GreaterThan
        | FilterOperator::LessThan
        | FilterOperator::GreaterThanOrEqual
        | FilterOperator::LessThanOrEqual
        | FilterOperator::Contains
        | FilterOperator::NotContains
        | FilterOperator::StartsWith
        | FilterOperator::EndsWith => {
            let value = flat
                .value
                .clone()
                .ok_or_else(|| PivotError::InvalidFilter {
                    field_id: field_id.to_string(),
                    message: format!("{:?} operator requires a value operand", flat.operator),
                })?;
            let op = match flat.operator {
                FilterOperator::Equals => UnaryFilterOp::Equals,
                FilterOperator::NotEquals => UnaryFilterOp::NotEquals,
                FilterOperator::GreaterThan => UnaryFilterOp::GreaterThan,
                FilterOperator::LessThan => UnaryFilterOp::LessThan,
                FilterOperator::GreaterThanOrEqual => UnaryFilterOp::GreaterThanOrEqual,
                FilterOperator::LessThanOrEqual => UnaryFilterOp::LessThanOrEqual,
                FilterOperator::Contains => UnaryFilterOp::Contains,
                FilterOperator::NotContains => UnaryFilterOp::NotContains,
                FilterOperator::StartsWith => UnaryFilterOp::StartsWith,
                FilterOperator::EndsWith => UnaryFilterOp::EndsWith,
                _ => unreachable!(),
            };
            Ok(PivotFilterCondition::Unary { op, value })
        }

        // Binary — both value and value2 must be Some
        FilterOperator::Between | FilterOperator::NotBetween => {
            let value = flat
                .value
                .clone()
                .ok_or_else(|| PivotError::InvalidFilter {
                    field_id: field_id.to_string(),
                    message: format!("{:?} operator requires a value operand", flat.operator),
                })?;
            let value2 = flat
                .value2
                .clone()
                .ok_or_else(|| PivotError::InvalidFilter {
                    field_id: field_id.to_string(),
                    message: format!("{:?} operator requires a value2 operand", flat.operator),
                })?;
            let op = match flat.operator {
                FilterOperator::Between => BinaryFilterOp::Between,
                FilterOperator::NotBetween => BinaryFilterOp::NotBetween,
                _ => unreachable!(),
            };
            Ok(PivotFilterCondition::Binary { op, value, value2 })
        }

        // Future-proof: non-exhaustive enum from compute-stats
        _ => Err(PivotError::InvalidFilter {
            field_id: field_id.to_string(),
            message: format!("Unsupported filter operator: {:?}", flat.operator),
        }),
    }
}

/// Validate a pivot table configuration (legacy API).
///
/// Returns error messages as strings. Prefer `validate_and_resolve()` which returns
/// structured errors and a resolved config.
#[must_use]
pub fn validate_config(config: &PivotTableConfig) -> Vec<String> {
    match validate_and_resolve(config) {
        Ok(_) => vec![],
        Err(PivotError::Multiple { errors }) => errors
            .iter()
            .map(std::string::ToString::to_string)
            .collect(),
        Err(e) => vec![e.to_string()],
    }
}
