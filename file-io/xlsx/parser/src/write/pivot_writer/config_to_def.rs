use crate::write::pivot_writer::a1::col_to_letters;
use domain_types::domain::pivot::ParsedPivotTable;

/// Convert a `ParsedPivotTable` into the `PivotTableDef` that the writer expects.
pub(super) fn parsed_pivot_to_def(pt: &ParsedPivotTable) -> domain_types::PivotTableDef {
    use domain_types::domain::pivot::*;

    let config = &pt.config;
    let engine_config = match pivot_types::PivotEngineConfig::try_from(config.clone()) {
        Ok(config) => config,
        Err(_) => return domain_types::PivotTableDef::default(),
    };
    let value_field_ids: Vec<_> = config
        .placements
        .iter()
        .filter(|p| p.area == pivot_types::PivotFieldArea::Value)
        .map(|p| p.field_id.clone())
        .collect();

    let fields: Vec<PivotFieldDef> = config
        .fields
        .iter()
        .map(|field| {
            let axis_placement = config.placements.iter().find(|p| {
                p.field_id.as_str() == field.id.as_str()
                    && matches!(
                        p.area,
                        pivot_types::PivotFieldArea::Row | pivot_types::PivotFieldArea::Column
                    )
            });
            let axis = engine_config
                .placements
                .iter()
                .find(|p| p.field_id().as_str() == field.id.as_str())
                .and_then(|p| match p {
                    pivot_types::PivotFieldPlacement::Row(_) => Some(PivotAxis::Row),
                    pivot_types::PivotFieldPlacement::Column(_) => Some(PivotAxis::Col),
                    pivot_types::PivotFieldPlacement::Filter(_) => Some(PivotAxis::Page),
                    pivot_types::PivotFieldPlacement::Value(_) => None,
                    _ => None,
                });

            let is_data_field = engine_config.placements.iter().any(|p| {
                p.field_id().as_str() == field.id.as_str()
                    && matches!(p, pivot_types::PivotFieldPlacement::Value(_))
            });

            let (compact, outline) = config
                .layout
                .as_ref()
                .and_then(|l| l.layout_form.as_ref())
                .map(|form| match form {
                    pivot_types::LayoutForm::Compact => (true, true),
                    pivot_types::LayoutForm::Outline => (false, true),
                    pivot_types::LayoutForm::Tabular => (false, false),
                    _ => (true, true),
                })
                .unwrap_or((true, true));

            PivotFieldDef {
                name: Some(pivot_field_ooxml_name(field.name.as_str(), axis_placement)),
                axis,
                data_field: is_data_field,
                compact,
                outline,
                show_all: field.show_all,
                sort_type: axis_placement.and_then(sort_type_for_axis_placement),
                auto_sort_data_field: axis_placement
                    .and_then(|p| p.sort_by_value.as_ref())
                    .and_then(|sort| {
                        value_field_ids
                            .iter()
                            .position(|field_id| field_id == &sort.value_field_id)
                            .map(|index| index as u32)
                    }),
                subtotal_top: field.subtotal_top.unwrap_or(true),
                default_subtotal: field.default_subtotal.unwrap_or(true),
                subtotals: field.subtotals.clone(),
                items: field.items.clone(),
            }
        })
        .collect();

    let row_fields: Vec<i32> = engine_config
        .row_placements()
        .iter()
        .filter_map(|p| {
            engine_config
                .fields
                .iter()
                .position(|f| f.id.as_str() == p.field_id().as_str())
                .map(|i| i as i32)
        })
        .collect();

    let col_fields: Vec<i32> = engine_config
        .column_placements()
        .iter()
        .filter_map(|p| {
            engine_config
                .fields
                .iter()
                .position(|f| f.id.as_str() == p.field_id().as_str())
                .map(|i| i as i32)
        })
        .collect();

    let mut col_fields = col_fields;
    let mut row_fields = row_fields;
    let data_on_rows = config
        .data_on_rows
        .unwrap_or_else(|| engine_config.value_placements().len() > 1 && col_fields.is_empty());
    if engine_config.value_placements().len() > 1 {
        if data_on_rows {
            row_fields.push(-2);
        } else {
            col_fields.push(-2);
        }
    }

    let page_fields: Vec<PivotPageFieldDef> = engine_config
        .get_placements_for_area(pivot_types::PivotFieldArea::Filter)
        .iter()
        .filter_map(|p| {
            engine_config
                .fields
                .iter()
                .position(|f| f.id.as_str() == p.field_id().as_str())
                .map(|i| PivotPageFieldDef {
                    field_index: i as i32,
                    item: None,
                    hierarchy: None,
                    name: None,
                    caption: None,
                })
        })
        .collect();

    let data_fields: Vec<PivotDataFieldDef> = engine_config
        .value_placements()
        .iter()
        .filter_map(|p| {
            let field_idx = engine_config
                .fields
                .iter()
                .position(|f| f.id.as_str() == p.field_id().as_str())?;
            let agg = p
                .aggregate_function()
                .unwrap_or(pivot_types::AggregateFunction::Sum);
            let func = map_agg_function(agg);
            let field = &config.fields[field_idx];
            let field_name = &field.name;
            let name = p
                .display_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("{} of {}", func_label(&func), field_name));
            Some(PivotDataFieldDef {
                name,
                field_index: field_idx as u32,
                function: func,
                num_fmt_id: field.num_fmt_id,
                base_field: field.base_field,
                base_item: field.base_item,
                show_data_as: match p {
                    pivot_types::PivotFieldPlacement::Value(value) => {
                        value.show_values_as.as_ref().map(show_values_as_ooxml)
                    }
                    _ => None,
                },
            })
        })
        .collect();

    let layout = config.layout.as_ref();
    let row_grand_totals = layout.and_then(|l| l.show_row_grand_totals).unwrap_or(true);
    let col_grand_totals = layout
        .and_then(|l| l.show_column_grand_totals)
        .unwrap_or(true);
    let data_caption = layout
        .and_then(|l| l.data_caption.clone())
        .unwrap_or_else(|| "Values".to_string());

    let start_row = config.output_location.row;
    let start_col = config.output_location.col;
    let num_row_fields = row_fields.len() as u32;
    let num_data_fields = data_fields.len().max(1) as u32;
    let location_str = config.ref_range.clone().unwrap_or_else(|| {
        let est_rows = 3u32;
        let est_cols = num_row_fields + num_data_fields;
        format!(
            "{}{}:{}{}",
            col_to_letters(start_col),
            start_row + 1,
            col_to_letters(start_col + est_cols.saturating_sub(1)),
            start_row + est_rows,
        )
    });

    let first_header_row = 1;
    let first_header_row = config.first_header_row.unwrap_or(first_header_row);
    let first_data_row = config
        .first_data_row
        .unwrap_or(if col_fields.is_empty() { 1 } else { 2 });
    let first_data_col = config
        .first_data_col
        .unwrap_or_else(|| num_row_fields.max(1));

    let style = config.style.as_ref().map(|s| PivotStyleDef {
        name: s
            .style_name
            .clone()
            .unwrap_or_else(|| "PivotStyleLight16".to_string()),
        show_row_headers: s.show_row_headers.unwrap_or(true),
        show_col_headers: s.show_column_headers.unwrap_or(true),
        show_row_stripes: s.show_row_stripes.unwrap_or(false),
        show_col_stripes: s.show_column_stripes.unwrap_or(false),
        show_last_column: s.show_last_column.unwrap_or(false),
    });

    PivotTableDef {
        data_on_rows,
        data_caption,
        location: PivotLocationDef {
            ref_range: location_str,
            first_header_row,
            first_data_row,
            first_data_col,
            rows_per_page: config.rows_per_page,
            cols_per_page: config.cols_per_page,
        },
        fields,
        row_fields,
        col_fields,
        page_fields,
        data_fields,
        row_items: config.row_items.clone(),
        col_items: config.col_items.clone(),
        style,
        grand_total_caption: layout.and_then(|l| l.grand_total_caption.clone()),
        row_header_caption: layout.and_then(|l| l.row_header_caption.clone()),
        col_header_caption: layout.and_then(|l| l.col_header_caption.clone()),
        row_grand_totals,
        col_grand_totals,
        grid_drop_zones: layout.and_then(|l| l.grid_drop_zones).unwrap_or(false),
        error_caption: layout.and_then(|l| l.error_caption.clone()),
        show_error: layout.and_then(|l| l.show_error).unwrap_or(false),
        missing_caption: layout.and_then(|l| l.missing_caption.clone()),
        show_missing: layout.and_then(|l| l.show_missing).unwrap_or(true),
        ooxml_preservation: pt.ooxml_preservation.clone(),
    }
}

fn sort_type_for_axis_placement(
    placement: &pivot_types::PivotFieldPlacementFlat,
) -> Option<String> {
    let sort = placement
        .sort_order
        .or_else(|| placement.sort_by_value.as_ref().map(|sort| sort.order))?;
    Some(
        match sort {
            domain_types::domain::analytics::SortDirection::Asc => "ascending",
            domain_types::domain::analytics::SortDirection::Desc => "descending",
            _ => "manual",
        }
        .to_string(),
    )
}

fn pivot_field_ooxml_name(
    field_name: &str,
    axis_placement: Option<&pivot_types::PivotFieldPlacementFlat>,
) -> String {
    axis_placement
        .and_then(|placement| placement.display_name.clone())
        .unwrap_or_else(|| field_name.to_string())
}

fn map_agg_function(
    agg: pivot_types::AggregateFunction,
) -> domain_types::domain::pivot::PivotFieldFunction {
    use domain_types::domain::pivot::PivotFieldFunction;
    match agg {
        pivot_types::AggregateFunction::Sum => PivotFieldFunction::Sum,
        pivot_types::AggregateFunction::Count
        | pivot_types::AggregateFunction::CountA
        | pivot_types::AggregateFunction::CountUnique => PivotFieldFunction::Count,
        pivot_types::AggregateFunction::Average => PivotFieldFunction::Average,
        pivot_types::AggregateFunction::Max => PivotFieldFunction::Max,
        pivot_types::AggregateFunction::Min => PivotFieldFunction::Min,
        pivot_types::AggregateFunction::Product => PivotFieldFunction::Product,
        pivot_types::AggregateFunction::StdDev => PivotFieldFunction::StdDev,
        pivot_types::AggregateFunction::StdDevP => PivotFieldFunction::StdDevP,
        pivot_types::AggregateFunction::Var => PivotFieldFunction::Var,
        pivot_types::AggregateFunction::VarP => PivotFieldFunction::VarP,
        _ => PivotFieldFunction::Sum,
    }
}

fn func_label(func: &domain_types::domain::pivot::PivotFieldFunction) -> &'static str {
    use domain_types::domain::pivot::PivotFieldFunction;
    match func {
        PivotFieldFunction::Sum => "Sum",
        PivotFieldFunction::Count => "Count",
        PivotFieldFunction::Average => "Average",
        PivotFieldFunction::Max => "Max",
        PivotFieldFunction::Min => "Min",
        PivotFieldFunction::Product => "Product",
        PivotFieldFunction::CountNums => "Count",
        PivotFieldFunction::StdDev => "StdDev",
        PivotFieldFunction::StdDevP => "StdDevP",
        PivotFieldFunction::Var => "Var",
        PivotFieldFunction::VarP => "VarP",
    }
}

fn show_values_as_ooxml(config: &pivot_types::ShowValuesAsConfig) -> String {
    use pivot_types::ShowValuesAs;
    match config.calculation_type {
        ShowValuesAs::NoCalculation => "normal",
        ShowValuesAs::Difference => "difference",
        ShowValuesAs::PercentDifference => "percentDiff",
        ShowValuesAs::RunningTotal => "runTotal",
        ShowValuesAs::PercentRunningTotal => "percentOfRunningTotal",
        ShowValuesAs::PercentOfRowTotal => "percentOfRow",
        ShowValuesAs::PercentOfColumnTotal => "percentOfCol",
        ShowValuesAs::PercentOfGrandTotal => "percentOfTotal",
        ShowValuesAs::PercentOfParentRowTotal => "percentOfParentRow",
        ShowValuesAs::PercentOfParentColumnTotal => "percentOfParentCol",
        ShowValuesAs::RankAscending => "rankAscending",
        ShowValuesAs::RankDescending => "rankDescending",
        ShowValuesAs::Index => "index",
        _ => "normal",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use pivot_types::{
        FieldId, PivotFieldArea, PivotFieldPlacementFlat, SortByValueConfig, SortDirection,
    };

    fn axis_placement() -> PivotFieldPlacementFlat {
        PivotFieldPlacementFlat {
            placement_id: pivot_types::PlacementId::new("p0"),
            field_id: FieldId::from("Region"),
            calculated_field_id: None,
            area: PivotFieldArea::Row,
            position: 0,
            aggregate_function: None,
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
            display_name: None,
            number_format: None,
            show_values_as: None,
        }
    }

    #[test]
    fn sort_type_uses_sort_by_value_order_when_label_sort_order_is_cleared() {
        let mut placement = axis_placement();
        placement.sort_by_value = Some(SortByValueConfig {
            value_field_id: FieldId::from("Sales"),
            order: SortDirection::Desc,
            column_key: None,
        });

        assert_eq!(
            sort_type_for_axis_placement(&placement),
            Some("descending".to_string())
        );
    }

    #[test]
    fn explicit_label_sort_order_wins_over_sort_by_value_order() {
        let mut placement = axis_placement();
        placement.sort_order = Some(SortDirection::Asc);
        placement.sort_by_value = Some(SortByValueConfig {
            value_field_id: FieldId::from("Sales"),
            order: SortDirection::Desc,
            column_key: None,
        });

        assert_eq!(
            sort_type_for_axis_placement(&placement),
            Some("ascending".to_string())
        );
    }

    #[test]
    fn axis_placement_display_name_becomes_pivot_field_name() {
        let mut placement = axis_placement();
        placement.display_name = Some("PLC".to_string());

        assert_eq!(
            pivot_field_ooxml_name("Category", Some(&placement)),
            "PLC".to_string()
        );
    }

    #[test]
    fn pivot_field_name_falls_back_to_source_field_name_without_display_override() {
        let placement = axis_placement();

        assert_eq!(
            pivot_field_ooxml_name("Category", Some(&placement)),
            "Category".to_string()
        );
        assert_eq!(
            pivot_field_ooxml_name("Category", None),
            "Category".to_string()
        );
    }
}
