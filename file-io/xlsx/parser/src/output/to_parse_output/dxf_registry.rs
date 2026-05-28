use super::*;

pub(super) fn populate_dxf_registry_owners(output: &mut ParseOutput) {
    let Some(stylesheet) = output.workbook_stylesheet.as_mut() else {
        return;
    };
    if stylesheet.dxf_registry.is_empty() {
        return;
    }

    let mut owners_by_id = HashMap::<u32, Vec<domain_types::DxfOwner>>::new();
    for (sheet_index, sheet) in output.sheets.iter().enumerate() {
        let sheet_index = sheet_index as u32;
        for cf in &sheet.conditional_formats {
            for rule in &cf.rules {
                if let Some((rule_id, dxf_id)) = cf_rule_dxf(rule) {
                    owners_by_id.entry(dxf_id).or_default().push(
                        domain_types::DxfOwner::ConditionalFormatRule {
                            sheet_index,
                            format_id: cf.id.clone(),
                            rule_id: rule_id.to_string(),
                        },
                    );
                }
            }
        }

        if let Some(auto_filter) = &sheet.auto_filter {
            for column in &auto_filter.columns {
                if let Some(domain_types::OoxmlFilterType::Color {
                    dxf_id: Some(dxf_id),
                    ..
                }) = &column.filter_type
                {
                    owners_by_id.entry(*dxf_id).or_default().push(
                        domain_types::DxfOwner::AutoFilter {
                            sheet_index,
                            column_id: column.col_index,
                        },
                    );
                }
            }
            if let Some(sort) = &auto_filter.sort {
                for (condition_index, condition) in sort.conditions.iter().enumerate() {
                    if let Some(dxf_id) = condition.dxf_id {
                        owners_by_id.entry(dxf_id).or_default().push(
                            domain_types::DxfOwner::SheetSort {
                                sheet_index,
                                condition_index: condition_index as u32,
                            },
                        );
                    }
                }
            }
        }

        if let Some(sort) = &sheet.sort_state {
            for (condition_index, condition) in sort.conditions.iter().enumerate() {
                if let Some(dxf_id) = condition.dxf_id {
                    owners_by_id.entry(dxf_id).or_default().push(
                        domain_types::DxfOwner::SheetSort {
                            sheet_index,
                            condition_index: condition_index as u32,
                        },
                    );
                }
            }
        }

        for table in &sheet.tables {
            for (field, dxf_id) in [
                ("headerRowDxfId", table.header_row_dxf_id),
                ("dataDxfId", table.data_dxf_id),
                ("totalsRowDxfId", table.totals_row_dxf_id),
                ("headerRowBorderDxfId", table.header_row_border_dxf_id),
                ("tableBorderDxfId", table.table_border_dxf_id),
                ("totalsRowBorderDxfId", table.totals_row_border_dxf_id),
            ] {
                if let Some(dxf_id) = dxf_id {
                    owners_by_id
                        .entry(dxf_id)
                        .or_default()
                        .push(domain_types::DxfOwner::Table {
                            sheet_index,
                            table_name: table.name.clone(),
                            field: field.to_string(),
                        });
                }
            }
            for column in &table.columns {
                for (field, dxf_id) in [
                    ("headerRowDxfId", column.header_row_dxf_id),
                    ("dataDxfId", column.data_dxf_id),
                    ("totalsRowDxfId", column.totals_row_dxf_id),
                ] {
                    if let Some(dxf_id) = dxf_id {
                        owners_by_id.entry(dxf_id).or_default().push(
                            domain_types::DxfOwner::TableColumn {
                                sheet_index,
                                table_name: table.name.clone(),
                                column_name: column.name.clone(),
                                field: field.to_string(),
                            },
                        );
                    }
                }
            }
            for column in &table.filter_columns {
                if let domain_types::FilterSpec::Color {
                    dxf_id: Some(dxf_id),
                    ..
                } = &column.filter
                {
                    owners_by_id.entry(*dxf_id).or_default().push(
                        domain_types::DxfOwner::TableFilter {
                            sheet_index,
                            table_name: table.name.clone(),
                            column_id: column.col_id,
                        },
                    );
                }
            }
            if let Some(sort) = &table.sort_state {
                for (condition_index, condition) in sort.conditions.iter().enumerate() {
                    if let Some(dxf_id) = condition.dxf_id {
                        owners_by_id.entry(dxf_id).or_default().push(
                            domain_types::DxfOwner::TableSort {
                                sheet_index,
                                table_name: table.name.clone(),
                                condition_index: condition_index as u32,
                            },
                        );
                    }
                }
            }
        }
    }

    for style in &output.custom_table_styles {
        for (element_index, element) in style.elements.iter().enumerate() {
            if let Some(dxf_id) = element.dxf_id {
                owners_by_id
                    .entry(dxf_id)
                    .or_default()
                    .push(domain_types::DxfOwner::TableStyle {
                        style_name: style.name.clone(),
                        element_index: element_index as u32,
                    });
            }
        }
    }

    for entry in &mut stylesheet.dxf_registry {
        entry.owners = owners_by_id.remove(&entry.id).unwrap_or_default();
    }
}

fn cf_rule_dxf(rule: &domain_types::CFRule) -> Option<(&str, u32)> {
    match rule {
        domain_types::CFRule::CellValue { id, style, .. }
        | domain_types::CFRule::Formula { id, style, .. }
        | domain_types::CFRule::Top10 { id, style, .. }
        | domain_types::CFRule::AboveAverage { id, style, .. }
        | domain_types::CFRule::DuplicateValues { id, style, .. }
        | domain_types::CFRule::ContainsText { id, style, .. }
        | domain_types::CFRule::ContainsBlanks { id, style, .. }
        | domain_types::CFRule::ContainsErrors { id, style, .. }
        | domain_types::CFRule::TimePeriod { id, style, .. } => {
            style.dxf_id.map(|dxf_id| (id.as_str(), dxf_id))
        }
        domain_types::CFRule::ColorScale { .. }
        | domain_types::CFRule::DataBar { .. }
        | domain_types::CFRule::IconSet { .. } => None,
    }
}
