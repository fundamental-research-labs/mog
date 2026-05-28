use std::collections::HashMap;

use value_types::CellValue;

use compute_relational::{
    AggregateFunction as RelAggFunc, CalcExpr, CalcOp, CalculatedMeasure, DateGroupingKind,
    FilterCondition, GrandTotalConfig, GroupField, GroupingStrategy, Measure, NumberGroupingKind,
    QueryFilter, RelationalQuery, SortBy, SortConfig as RelSortConfig,
    SortDirection as RelSortDirection, SubtotalConfig, TopBottomBy as RelTopBottomBy,
    TopBottomFilter as RelTopBottom, TopBottomType as RelTopBottomType,
};

use crate::calc_field::{CalcFieldExpr, CalcFieldOp};
use crate::resolved::{
    ResolvedAxisPlacement, ResolvedCalculatedField, ResolvedPivotConfig, ResolvedTopBottom,
    ResolvedValuePlacement,
};
use crate::types::{AggregateFunction, DateGrouping, SortDirection, TopBottomBy, TopBottomType};

/// Convert a `ResolvedPivotConfig` to a `RelationalQuery`.
///
/// Maps pivot domain types to the relational engine's declarative query model.
#[must_use]
pub fn pivot_config_to_query(config: &ResolvedPivotConfig) -> RelationalQuery {
    let row_fields: Vec<GroupField> = config
        .row_placements()
        .iter()
        .map(map_axis_to_group_field)
        .collect();

    let column_fields: Vec<GroupField> = config
        .column_placements()
        .iter()
        .map(map_axis_to_group_field)
        .collect();

    let field_name_by_id: HashMap<&str, &str> = config
        .fields()
        .iter()
        .map(|f| (f.id.as_ref(), f.name.as_str()))
        .collect();

    let measures: Vec<Measure> = config
        .value_placements()
        .iter()
        .map(|vp| map_value_to_measure(vp, &field_name_by_id))
        .collect();

    let filters: Vec<QueryFilter> = config
        .filters()
        .iter()
        .map(|f| QueryFilter {
            field_id: f.field_id().to_string(),
            column_index: f.field_column_index(),
            include_values: f.include_values().map(<[CellValue]>::to_vec),
            exclude_values: f.exclude_values().map(<[CellValue]>::to_vec),
            condition: f.condition().map(|c| FilterCondition::Pivot(c.clone())),
            top_bottom: f.top_bottom().map(|tb| map_top_bottom(tb, config)),
            show_items_with_no_data: f.show_items_with_no_data(),
        })
        .collect();

    let calculated_measures: Vec<CalculatedMeasure> = config
        .calculated_fields()
        .iter()
        .map(map_calc_field)
        .collect();

    let subtotals = SubtotalConfig {
        enabled: config
            .row_placements()
            .iter()
            .map(ResolvedAxisPlacement::show_subtotals)
            .collect(),
    };

    let show_column_grand_totals =
        config.layout().show_column_grand_totals() && !config.column_placements().is_empty();

    let grand_totals = GrandTotalConfig {
        show_row: config.layout().show_row_grand_totals(),
        show_column: show_column_grand_totals,
    };

    RelationalQuery {
        row_fields,
        column_fields,
        measures,
        filters,
        calculated_measures,
        subtotals,
        grand_totals,
    }
}

fn map_axis_to_group_field(ap: &ResolvedAxisPlacement) -> GroupField {
    GroupField {
        id: ap.field_id().to_string(),
        column_index: ap.column_index(),
        grouping: match (ap.date_grouping(), ap.number_grouping()) {
            (Some(dg), _) => GroupingStrategy::Date(map_date_grouping(dg)),
            (_, Some(ng)) => GroupingStrategy::Number(NumberGroupingKind {
                start: ng.start,
                end: ng.end,
                interval: ng.interval,
            }),
            _ => GroupingStrategy::Identity,
        },
        sort: RelSortConfig {
            sort_by: match ap.sort_by_value() {
                Some(sbv) => SortBy::Value {
                    measure_index: sbv.value_field_index(),
                    column_key: sbv.column_key().map(String::from),
                },
                None => SortBy::Label,
            },
            direction: match ap.sort_by_value() {
                Some(sbv) => map_sort_direction(sbv.order()),
                None => map_sort_direction(ap.sort_order()),
            },
            custom_order: ap.custom_sort_list().map(<[CellValue]>::to_vec),
        },
    }
}

fn map_value_to_measure(
    vp: &ResolvedValuePlacement,
    field_name_by_id: &HashMap<&str, &str>,
) -> Measure {
    let field_id = vp.field_id().to_string();
    let name = field_name_by_id
        .get(field_id.as_str())
        .map(|s| (*s).to_string())
        .or_else(|| vp.display_name().map(std::string::ToString::to_string))
        .unwrap_or_else(|| field_id.clone());
    Measure {
        id: field_id,
        name,
        column_index: vp.column_index(),
        aggregate: map_aggregate(vp.aggregate_function()),
        window: None,
    }
}

fn map_date_grouping(dg: DateGrouping) -> DateGroupingKind {
    match dg {
        DateGrouping::Year => DateGroupingKind::Year,
        DateGrouping::Quarter => DateGroupingKind::Quarter,
        DateGrouping::Month => DateGroupingKind::Month,
        DateGrouping::Week => DateGroupingKind::Week,
        DateGrouping::Hour => DateGroupingKind::Hour,
        DateGrouping::Minute => DateGroupingKind::Minute,
        DateGrouping::Second => DateGroupingKind::Second,
        _ => DateGroupingKind::Day,
    }
}

fn map_sort_direction(sd: SortDirection) -> RelSortDirection {
    match sd {
        SortDirection::Desc => RelSortDirection::Descending,
        _ => RelSortDirection::Ascending,
    }
}

fn map_aggregate(af: AggregateFunction) -> RelAggFunc {
    match af {
        AggregateFunction::Count | AggregateFunction::CountUnique => RelAggFunc::Count,
        AggregateFunction::CountA => RelAggFunc::CountNums,
        AggregateFunction::Average => RelAggFunc::Average,
        AggregateFunction::Min => RelAggFunc::Min,
        AggregateFunction::Max => RelAggFunc::Max,
        AggregateFunction::Product => RelAggFunc::Product,
        AggregateFunction::StdDev => RelAggFunc::StdDev,
        AggregateFunction::StdDevP => RelAggFunc::StdDevP,
        AggregateFunction::Var => RelAggFunc::Var,
        AggregateFunction::VarP => RelAggFunc::VarP,
        _ => RelAggFunc::Sum,
    }
}

fn map_top_bottom(tb: &ResolvedTopBottom, _config: &ResolvedPivotConfig) -> RelTopBottom {
    RelTopBottom {
        filter_type: match tb.filter_type() {
            TopBottomType::Bottom => RelTopBottomType::Bottom,
            _ => RelTopBottomType::Top,
        },
        n: tb.n(),
        by: match tb.by() {
            TopBottomBy::Items => RelTopBottomBy::Items,
            TopBottomBy::Percent => RelTopBottomBy::Percent,
            TopBottomBy::Sum => RelTopBottomBy::Sum,
            _ => RelTopBottomBy::Count,
        },
        measure_index: tb.value_field_index(),
    }
}

fn map_calc_field(cf: &ResolvedCalculatedField) -> CalculatedMeasure {
    CalculatedMeasure {
        id: cf.field_id().to_string(),
        name: cf.name().to_string(),
        formula: cf.formula().to_string(),
        parsed_expr: Some(map_calc_expr(cf.parsed_expr())),
    }
}

fn map_calc_expr(expr: &CalcFieldExpr) -> CalcExpr {
    match expr {
        CalcFieldExpr::Number(n) => CalcExpr::Number(*n),
        CalcFieldExpr::FieldRef(name) => CalcExpr::Field(name.clone()),
        CalcFieldExpr::BinaryOp { op, left, right } => CalcExpr::BinaryOp {
            op: match op {
                CalcFieldOp::Add => CalcOp::Add,
                CalcFieldOp::Sub => CalcOp::Sub,
                CalcFieldOp::Mul => CalcOp::Mul,
                CalcFieldOp::Div => CalcOp::Div,
            },
            left: Box::new(map_calc_expr(left)),
            right: Box::new(map_calc_expr(right)),
        },
        CalcFieldExpr::Negate(inner) => CalcExpr::UnaryNeg(Box::new(map_calc_expr(inner))),
    }
}
