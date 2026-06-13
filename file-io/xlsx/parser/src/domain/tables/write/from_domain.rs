use super::{
    AutoFilterDef, CustomFilter, DynamicFilterType, FilterColumn, FilterOperator, FilterType,
    SortBy, SortCondition, SortState, TableColumn, TableFormula, TableStyleInfo, TableWriter,
    TotalsRowFunction,
};

/// Convert a `domain_types::TableSpec` into a fully configured `TableWriter`.
///
/// The caller is responsible for calling `.to_xml()` on the returned writer.
/// This keeps serialization in one place (the writer) and conversion separate.
pub fn table_writer_from_domain(global_id: u32, table: &domain_types::TableSpec) -> TableWriter {
    table_writer_from_domain_with_strict(global_id, table, false)
}

pub fn table_writer_from_domain_with_strict(
    global_id: u32,
    table: &domain_types::TableSpec,
    strict: bool,
) -> TableWriter {
    let mut tw = TableWriter::new(global_id, &table.name, &table.range_ref);
    tw.strict_ooxml = strict;
    tw.display_name = table.display_name.clone();

    // Header/totals row settings
    tw.header_row_count = if table.has_headers { 1 } else { 0 };
    tw.totals_row_count = if table.has_totals { 1 } else { 0 };

    // Table-level metadata
    tw.table_type = table.table_type.clone();
    tw.totals_row_shown = table.totals_row_shown;
    tw.connection_id = table.connection_id;
    tw.comment = table.comment.clone();
    tw.insert_row = table.insert_row;
    tw.insert_row_shift = table.insert_row_shift;
    tw.published = table.published;
    tw.xr_uid = table.xr_uid.clone();

    // DXF formatting IDs
    tw.header_row_dxf_id = table.header_row_dxf_id;
    tw.data_dxf_id = table.data_dxf_id;
    tw.totals_row_dxf_id = table.totals_row_dxf_id;
    tw.header_row_border_dxf_id = table.header_row_border_dxf_id;
    tw.table_border_dxf_id = table.table_border_dxf_id;
    tw.totals_row_border_dxf_id = table.totals_row_border_dxf_id;
    tw.header_row_cell_style = table.header_row_cell_style.clone();
    tw.data_cell_style = table.data_cell_style.clone();
    tw.totals_row_cell_style = table.totals_row_cell_style.clone();

    // Auto-filter
    if let Some(ref af_ref) = table.auto_filter_ref {
        let mut af = AutoFilterDef::new(af_ref);
        af.xr_uid = table.auto_filter_xr_uid.clone();
        af.ext_lst_raw = table.auto_filter_ext_lst_raw.clone();
        // Convert domain filter column specs to writer filter columns
        for fc_spec in &table.filter_columns {
            if let Some(fc) = convert_filter_column_spec_to_writer(fc_spec) {
                af.filter_columns.push(fc);
            }
        }
        tw.auto_filter = Some(af);
    }

    // Table columns
    for col in &table.columns {
        let mut tc = TableColumn::new(col.id, &col.name);
        tc.unique_name = col.unique_name.clone();
        tc.query_table_field_id = col.query_table_field_id;
        tc.xml_column_pr = col.xml_column_pr.clone();
        if let Some(ref label) = col.totals_label {
            tc.totals_row_label = Some(label.clone());
        }
        if let Some(func) = &col.totals_function {
            tc.totals_row_function = Some(TotalsRowFunction::from_ooxml(func.to_ooxml_str()));
        }
        if let Some(ref formula) = col.calculated_formula {
            tc.calculated_column_formula = Some(if col.calculated_formula_array {
                TableFormula::new_array(formula)
            } else {
                TableFormula::new(formula)
            });
        }
        if let Some(ref formula) = col.totals_row_formula {
            tc.totals_row_formula = Some(if col.totals_row_formula_array {
                TableFormula::new_array(formula)
            } else {
                TableFormula::new(formula)
            });
        }
        tc.data_format_id = col.data_dxf_id;
        tc.header_row_dxf_id = col.header_row_dxf_id;
        tc.totals_row_dxf_id = col.totals_row_dxf_id;
        tc.header_row_cell_style = col.header_row_cell_style.clone();
        tc.data_cell_style = col.data_cell_style.clone();
        tc.totals_row_cell_style = col.totals_row_cell_style.clone();
        tc.xr3_uid = col.xr3_uid.clone();
        tw.columns.push(tc);
    }

    // Sort state (table-level)
    if let Some(ref ss) = table.sort_state {
        let mut sort = SortState::new(&ss.ref_range);
        sort.column_sort = ss.column_sort;
        sort.case_sensitive = ss.case_sensitive;
        sort.sort_method = ss.sort_method;
        sort.ext_lst_raw = ss.ext_lst_raw.clone();
        for sc in &ss.conditions {
            let mut cond = SortCondition::new(&sc.ref_range);
            cond.descending = sc.descending;
            cond.sort_by = Some(match sc.sort_by {
                domain_types::SortConditionBy::Value => SortBy::Value,
                domain_types::SortConditionBy::CellColor => SortBy::CellColor,
                domain_types::SortConditionBy::FontColor => SortBy::FontColor,
                domain_types::SortConditionBy::Icon => SortBy::Icon,
            });
            cond.custom_list = sc.custom_list.clone();
            cond.dxf_id = sc.dxf_id;
            cond.icon_set = sc.icon_set;
            cond.icon_id = sc.icon_id;
            sort.add_condition(cond);
        }
        tw.sort_state = Some(sort);
    }

    // Table style
    tw.style_info = Some(TableStyleInfo {
        name: table.style_name.clone(),
        show_first_column: table.first_col_highlight,
        show_last_column: table.last_col_highlight,
        show_row_stripes: table.row_stripes,
        show_column_stripes: table.col_stripes,
    });

    tw
}

fn convert_filter_column_spec_to_writer(
    spec: &domain_types::FilterColumnSpec,
) -> Option<FilterColumn> {
    let filter = match &spec.filter {
        domain_types::FilterSpec::Values {
            values,
            blank,
            calendar_type,
            date_group_items,
        } => FilterType::Filters {
            values: values.clone(),
            blank: *blank,
            calendar_type: *calendar_type,
            date_group_items: date_group_items.clone(),
        },
        domain_types::FilterSpec::Custom { filters, and } => FilterType::CustomFilters {
            filters: filters
                .iter()
                .map(|f| CustomFilter::new(FilterOperator::from_ooxml(&f.operator), &f.val))
                .collect(),
            and: *and,
        },
        domain_types::FilterSpec::Top10 {
            top,
            percent,
            val,
            filter_val,
        } => FilterType::Top10 {
            top: *top,
            percent: *percent,
            val: *val,
            filter_val: *filter_val,
        },
        domain_types::FilterSpec::Dynamic {
            kind,
            val,
            max_val,
            val_iso,
            max_val_iso,
        } => FilterType::DynamicFilter {
            kind: DynamicFilterType::from_ooxml(kind),
            val: *val,
            max_val: *max_val,
            val_iso: val_iso.clone(),
            max_val_iso: max_val_iso.clone(),
        },
        domain_types::FilterSpec::Color { dxf_id, cell_color } => FilterType::ColorFilter {
            cell_color: *cell_color,
            dxf_id: *dxf_id,
        },
        domain_types::FilterSpec::Icon { icon_set, icon_id } => FilterType::IconFilter {
            icon_set: icon_set.clone(),
            icon_id: *icon_id,
        },
    };
    Some(FilterColumn {
        col_id: spec.col_id,
        hidden_button: spec.hidden_button,
        show_button: spec.show_button,
        filter,
        ext_lst_raw: spec.ext_lst_raw.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_without_auto_filter_ref_does_not_emit_default_auto_filter() {
        let table = domain_types::TableSpec {
            id: 1,
            name: "StyledSales".to_string(),
            display_name: "StyledSales".to_string(),
            range_ref: "A1:D5".to_string(),
            has_headers: true,
            style_name: Some("MogBrandExportStyle".to_string()),
            auto_filter_ref: None,
            ..Default::default()
        };

        let xml = String::from_utf8(table_writer_from_domain(1, &table).to_xml()).unwrap();

        assert!(!xml.contains("<autoFilter"));
        assert!(xml.contains(r#"<tableStyleInfo name="MogBrandExportStyle""#));
    }
}
