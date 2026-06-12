//! Projects preserved table AutoFilter metadata into canonical runtime
//! `TableFilter` records during engine construction/import.
//!
//! After this pass, compute code should treat the result as an ordinary
//! `FilterKind::TableFilter`; import provenance only matters for diagnostics
//! and preservation metadata.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use cell_types::{SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_TABLES;
use compute_document::undo::ORIGIN_BOOTSTRAP;
use domain_types::domain::table::{FilterSpec, TableCatalogEntry as CanonicalTable};
use domain_types::yrs_schema;
use value_types::CellValue;
use yrs::{Map, Out, Transact};

use crate::mirror::CellMirror;
use crate::storage::engine::filter_import_diagnostics::{
    resolve_filter_cell_pos, unsupported_filter_import_diagnostic, upsert_import_diagnostic_phase,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{filters, properties};

pub(in crate::storage::engine) fn materialize_table_auto_filters_from_preserved_specs(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mut import_report: Option<&mut domain_types::ImportReport>,
    import_phase: domain_types::ImportPhase,
) {
    let tables = read_preserved_tables(stores);
    for table in tables {
        if table.auto_filter_ref.is_none() && table.filter_columns.is_empty() {
            continue;
        }

        let Ok(sheet_id) = SheetId::from_uuid_str(&table.sheet_id) else {
            continue;
        };
        if !table.has_header_row {
            continue;
        }
        stores.compute.set_table(mirror, table.clone());

        materialize_table_auto_filter_from_preserved_spec(
            stores,
            mirror,
            &sheet_id,
            &table,
            import_report.as_deref_mut(),
            import_phase,
        );
    }
}

fn read_preserved_tables(stores: &EngineStores) -> Vec<CanonicalTable> {
    let txn = stores.storage.doc().transact();
    let Some(Out::YMap(tables_map)) = stores.storage.workbook_map().get(&txn, KEY_TABLES) else {
        return Vec::new();
    };

    tables_map
        .iter(&txn)
        .filter_map(|(key, out)| match out {
            Out::YMap(map) => {
                yrs_schema::table::from_yrs_map_to_table(&map, &txn).filter(|table| table.id == key)
            }
            _ => None,
        })
        .collect()
}

fn materialize_table_auto_filter_from_preserved_spec(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    table: &CanonicalTable,
    import_report: Option<&mut domain_types::ImportReport>,
    import_phase: domain_types::ImportPhase,
) {
    let start_row = table.range.start_row();
    let start_col = table.range.start_col();
    let end_col = table.range.end_col();
    if end_col < start_col {
        return;
    }
    let data_end_row = if table.has_totals_row && table.range.end_row() > start_row {
        table.range.end_row() - 1
    } else {
        table.range.end_row()
    };

    let (
        header_start_cell_id,
        header_end_cell_id,
        data_end_cell_id,
        col_id_to_header_cell_id,
        table_column_id_to_header_cell_id,
    ) = {
        let Some(grid) = stores.grid_indexes.get_mut(sheet_id) else {
            return;
        };

        let header_start = grid.ensure_cell_id(start_row, start_col);
        let header_end = grid.ensure_cell_id(start_row, end_col);
        let data_end = grid.ensure_cell_id(data_end_row, end_col);
        mirror.register_identity_only(sheet_id, SheetPos::new(start_row, start_col), header_start);
        mirror.register_identity_only(sheet_id, SheetPos::new(start_row, end_col), header_end);
        mirror.register_identity_only(sheet_id, SheetPos::new(data_end_row, end_col), data_end);

        let mut col_id_to_header_cell_id = BTreeMap::new();
        let mut table_column_id_to_header_cell_id = BTreeMap::new();
        for col in start_col..=end_col {
            let cell_id = grid.ensure_cell_id(start_row, col);
            mirror.register_identity_only(sheet_id, SheetPos::new(start_row, col), cell_id);
            let relative_col = col.saturating_sub(start_col);
            let header_cell_id = id_to_hex(cell_id.as_u128()).to_string();
            col_id_to_header_cell_id.insert(relative_col, header_cell_id.clone());
            if let Some(stable_column_id) = stable_column_id_for_filter_col(table, relative_col) {
                table_column_id_to_header_cell_id
                    .insert(stable_column_id.to_string(), header_cell_id);
            }
        }

        (
            id_to_hex(header_start.as_u128()).to_string(),
            id_to_hex(header_end.as_u128()).to_string(),
            id_to_hex(data_end.as_u128()).to_string(),
            col_id_to_header_cell_id,
            table_column_id_to_header_cell_id,
        )
    };

    let shell = build_table_filter_shell_metadata(table, &col_id_to_header_cell_id);
    let column_filters = if shell.capability == filters::FilterCapability::Supported {
        table
            .filter_columns
            .iter()
            .filter_map(|column| {
                let header_cell_id = col_id_to_header_cell_id.get(&column.col_id)?;
                Some((
                    header_cell_id.clone(),
                    table_filter_spec_to_column_filter(&column.filter)?,
                ))
            })
            .collect::<HashMap<_, _>>()
    } else {
        HashMap::new()
    };

    let existing_filter = filters::get_table_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &table.id,
    );
    let filter_id = existing_filter
        .as_ref()
        .map(|filter| filter.id.clone())
        .unwrap_or_else(|| format!("{:032x}", stores.id_alloc.next_u128()));
    let filter_state = filters::FilterState {
        id: filter_id,
        filter_kind: filters::FilterKind::TableFilter,
        header_start_cell_id,
        header_end_cell_id,
        data_end_cell_id,
        column_filters,
        advanced_filter: None,
        sort_state: None,
        table_id: Some(table.id.clone()),
        created_at: existing_filter
            .as_ref()
            .and_then(|filter| filter.created_at),
        updated_at: None,
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    };

    if filters::upsert_import_filter_state(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &filter_state,
    )
    .is_err()
    {
        return;
    }

    let binding = upsert_table_auto_filter_binding(
        stores,
        sheet_id,
        table,
        &filter_state,
        col_id_to_header_cell_id,
        table_column_id_to_header_cell_id,
        shell,
    );
    if binding.shell.capability == filters::FilterCapability::Unsupported
        && let Some(report) = import_report
    {
        record_unsupported_table_filter_import_diagnostics(
            stores,
            mirror,
            sheet_id,
            table,
            &binding,
            report,
            import_phase,
        );
    }
}

fn upsert_table_auto_filter_binding(
    stores: &EngineStores,
    sheet_id: &SheetId,
    table: &CanonicalTable,
    filter_state: &filters::FilterState,
    col_id_to_header_cell_id: BTreeMap<u32, String>,
    table_column_id_to_header_cell_id: BTreeMap<String, String>,
    shell: filters::FilterShellMetadata,
) -> filters::FilterMetadataBinding {
    let sheet_id_text = sheet_id.to_uuid_string();
    let range_ref = table
        .auto_filter_ref
        .clone()
        .filter(|range| !range.is_empty())
        .unwrap_or_else(|| {
            range_ref_from_bounds(
                table.range.start_row(),
                table.range.start_col(),
                table.range.end_row(),
                table.range.end_col(),
            )
        });
    let binding = filters::FilterMetadataBinding {
        filter_id: filter_state.id.clone(),
        filter_kind: filters::FilterKind::TableFilter,
        sheet_id: sheet_id_text.clone(),
        table_id: Some(table.id.clone()),
        owner_path: filters::FilterMetadataOwnerPath::TableAutoFilter {
            sheet_id: sheet_id_text.clone(),
            table_id: table.id.clone(),
        },
        source_key: filters::FilterMetadataSourceKey::TableAutoFilter {
            sheet_id: sheet_id_text.clone(),
            table_id: table.id.clone(),
            table_name: table.name.clone(),
            range_ref: range_ref.clone(),
        },
        range_ref: range_ref.clone(),
        header_start_cell_id: filter_state.header_start_cell_id.clone(),
        header_end_cell_id: filter_state.header_end_cell_id.clone(),
        data_end_cell_id: filter_state.data_end_cell_id.clone(),
        col_id_to_header_cell_id,
        table_column_id_to_header_cell_id,
        source_fingerprint: table_filter_binding_fingerprint(
            &sheet_id_text,
            table,
            &range_ref,
            &shell,
        ),
        shell,
    };

    filters::delete_stale_filter_metadata_bindings_for_source_key_with_origin(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &binding,
        ORIGIN_BOOTSTRAP,
    );
    filters::upsert_import_filter_metadata_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        &binding,
    );
    binding
}

fn record_unsupported_table_filter_import_diagnostics(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    table: &CanonicalTable,
    binding: &filters::FilterMetadataBinding,
    report: &mut domain_types::ImportReport,
    import_phase: domain_types::ImportPhase,
) {
    let sheet_index = stores
        .storage
        .sheet_order()
        .iter()
        .position(|candidate| candidate == sheet_id)
        .map(|idx| idx as u32);
    let sheet_name =
        properties::get_sheet_name(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let source_key = serde_json::to_string(&binding.source_key).ok();

    if table.auto_filter_ext_lst_raw.is_some() {
        let diagnostic = unsupported_filter_import_diagnostic(
            binding,
            sheet_index,
            sheet_name.clone(),
            source_key.clone(),
            Some(table.id.clone()),
            None,
            None,
            resolve_filter_cell_pos(stores, mirror, sheet_id, &binding.header_start_cell_id),
            vec![filters::ImportFilterUnsupportedReason::UnknownExtension],
            "tableFilter".to_string(),
            domain_types::ImportFeatureKind::Table,
        );
        upsert_import_diagnostic_phase(report, diagnostic, import_phase);
    }

    for column in &table.filter_columns {
        let mut reasons = BTreeSet::new();
        if !binding
            .col_id_to_header_cell_id
            .contains_key(&column.col_id)
        {
            reasons.insert(filters::ImportFilterUnsupportedReason::TableFilterShapeUnsupported);
        }
        if column.ext_lst_raw.is_some() {
            reasons.insert(filters::ImportFilterUnsupportedReason::UnknownExtension);
        }
        reasons.extend(unsupported_reasons_for_table_filter_spec(&column.filter));
        if reasons.is_empty() {
            continue;
        }

        let resolved_cell = binding
            .col_id_to_header_cell_id
            .get(&column.col_id)
            .and_then(|header_cell_id| {
                resolve_filter_cell_pos(stores, mirror, sheet_id, header_cell_id)
            });
        let diagnostic = unsupported_filter_import_diagnostic(
            binding,
            sheet_index,
            sheet_name.clone(),
            source_key.clone(),
            Some(table.id.clone()),
            None,
            Some(column.col_id),
            resolved_cell,
            reasons.into_iter().collect(),
            "tableFilter".to_string(),
            domain_types::ImportFeatureKind::Table,
        );
        upsert_import_diagnostic_phase(report, diagnostic, import_phase);
    }
}

fn build_table_filter_shell_metadata(
    table: &CanonicalTable,
    col_id_to_header_cell_id: &BTreeMap<u32, String>,
) -> filters::FilterShellMetadata {
    let mut unsupported_reasons = BTreeSet::new();
    let mut button_metadata = BTreeMap::new();
    let mut lossless_criteria = Vec::new();

    if table.auto_filter_ext_lst_raw.is_some() {
        unsupported_reasons.insert(filters::ImportFilterUnsupportedReason::UnknownExtension);
    }

    for (&col_id, header_cell_id) in col_id_to_header_cell_id {
        let source_column = table
            .filter_columns
            .iter()
            .find(|column| column.col_id == col_id);
        let hidden_button = source_column.is_some_and(|column| column.hidden_button);
        let show_button = source_column.map(|column| column.show_button);
        button_metadata.insert(
            header_cell_id.clone(),
            filters::FilterButtonMetadata {
                header_cell_id: header_cell_id.clone(),
                col_id,
                hidden_button,
                show_button,
                button_visible: table.show_filter_buttons
                    && !hidden_button
                    && show_button.unwrap_or(true),
            },
        );
    }

    for column in &table.filter_columns {
        if !col_id_to_header_cell_id.contains_key(&column.col_id) {
            unsupported_reasons
                .insert(filters::ImportFilterUnsupportedReason::TableFilterShapeUnsupported);
        }
        if column.ext_lst_raw.is_some() {
            unsupported_reasons.insert(filters::ImportFilterUnsupportedReason::UnknownExtension);
        }
        unsupported_reasons.extend(unsupported_reasons_for_table_filter_spec(&column.filter));
        lossless_criteria.push(filters::LosslessCriterionDescriptor {
            filter_col_id: None,
            table_column_id: stable_column_id_for_filter_col(table, column.col_id)
                .map(str::to_string),
            table_column_ordinal: Some(column.col_id),
            kind: table_filter_kind(&column.filter).to_string(),
            preserved_json: serde_json::to_value(&column.filter).unwrap_or(serde_json::Value::Null),
        });
    }

    let unsupported_reasons = unsupported_reasons.into_iter().collect::<Vec<_>>();
    filters::FilterShellMetadata {
        capability: if unsupported_reasons.is_empty() {
            filters::FilterCapability::Supported
        } else {
            filters::FilterCapability::Unsupported
        },
        unsupported_reasons,
        has_active_lossless_criteria: !table.filter_columns.is_empty(),
        button_metadata,
        lossless_criteria,
    }
}

fn unsupported_reasons_for_table_filter_spec(
    filter: &FilterSpec,
) -> Vec<filters::ImportFilterUnsupportedReason> {
    match filter {
        FilterSpec::Values {
            date_group_items, ..
        } if !date_group_items.is_empty() => {
            vec![filters::ImportFilterUnsupportedReason::DateGroupUnsupported]
        }
        FilterSpec::Custom { filters: specs, .. } => {
            if specs
                .iter()
                .any(|condition| !is_supported_custom_operator(&condition.operator))
            {
                vec![filters::ImportFilterUnsupportedReason::UnknownCustomOperator]
            } else {
                Vec::new()
            }
        }
        FilterSpec::Dynamic { kind, .. } => {
            let mut reasons =
                vec![filters::ImportFilterUnsupportedReason::DynamicTemporalContextUnsupported];
            if !is_known_dynamic_type(kind) {
                reasons.push(filters::ImportFilterUnsupportedReason::UnknownDynamicType);
            }
            reasons
        }
        FilterSpec::Color { .. } => {
            vec![filters::ImportFilterUnsupportedReason::ColorDxfUnresolved]
        }
        FilterSpec::Icon { .. } => {
            vec![filters::ImportFilterUnsupportedReason::IconFilterUnsupported]
        }
        _ => Vec::new(),
    }
}

fn table_filter_spec_to_column_filter(filter: &FilterSpec) -> Option<filters::ColumnFilter> {
    Some(match filter {
        FilterSpec::Values { blank, values, .. } => filters::ColumnFilter::Values {
            values: values
                .iter()
                .map(|value| serde_json::Value::String(value.clone()))
                .collect(),
            include_blanks: *blank,
        },
        FilterSpec::Custom {
            and,
            filters: specs,
        } => filters::ColumnFilter::Condition {
            conditions: specs
                .iter()
                .map(|condition| {
                    Some(filters::FilterCondition {
                        operator: parse_table_custom_operator(&condition.operator)?,
                        value: Some(CellValue::Text(condition.val.clone().into())),
                        value2: None,
                    })
                })
                .collect::<Option<Vec<_>>>()?,
            logic: if *and {
                filters::FilterLogic::And
            } else {
                filters::FilterLogic::Or
            },
        },
        FilterSpec::Top10 {
            top, percent, val, ..
        } => filters::ColumnFilter::TopBottom {
            direction: if *top {
                filters::TopBottomDirection::Top
            } else {
                filters::TopBottomDirection::Bottom
            },
            count: *val,
            by: if *percent {
                filters::TopBottomBy::Percent
            } else {
                filters::TopBottomBy::Items
            },
        },
        FilterSpec::Dynamic { .. } | FilterSpec::Color { .. } | FilterSpec::Icon { .. } => {
            return None;
        }
    })
}

fn parse_table_custom_operator(operator: &str) -> Option<filters::FilterOperator> {
    Some(match operator {
        "equal" | "equals" => filters::FilterOperator::Equals,
        "notEqual" | "notEquals" => filters::FilterOperator::NotEquals,
        "greaterThan" => filters::FilterOperator::GreaterThan,
        "greaterThanOrEqual" => filters::FilterOperator::GreaterThanOrEqual,
        "lessThan" => filters::FilterOperator::LessThan,
        "lessThanOrEqual" => filters::FilterOperator::LessThanOrEqual,
        "beginsWith" | "startsWith" => filters::FilterOperator::BeginsWith,
        "endsWith" => filters::FilterOperator::EndsWith,
        "contains" => filters::FilterOperator::Contains,
        "notContains" => filters::FilterOperator::NotContains,
        "between" => filters::FilterOperator::Between,
        "notBetween" => filters::FilterOperator::NotBetween,
        _ => return None,
    })
}

fn table_filter_kind(filter: &FilterSpec) -> &'static str {
    match filter {
        FilterSpec::Values { .. } => "values",
        FilterSpec::Custom { .. } => "custom",
        FilterSpec::Top10 { .. } => "top10",
        FilterSpec::Dynamic { .. } => "dynamic",
        FilterSpec::Color { .. } => "color",
        FilterSpec::Icon { .. } => "icon",
    }
}

fn is_supported_custom_operator(operator: &str) -> bool {
    matches!(
        operator,
        "equal"
            | "equals"
            | "notEqual"
            | "notEquals"
            | "greaterThan"
            | "greaterThanOrEqual"
            | "lessThan"
            | "lessThanOrEqual"
            | "beginsWith"
            | "startsWith"
            | "endsWith"
            | "contains"
            | "notContains"
            | "between"
            | "notBetween"
    )
}

fn is_known_dynamic_type(dynamic_type: &str) -> bool {
    matches!(
        dynamic_type,
        "aboveAverage"
            | "belowAverage"
            | "today"
            | "yesterday"
            | "tomorrow"
            | "thisWeek"
            | "lastWeek"
            | "nextWeek"
            | "thisMonth"
            | "lastMonth"
            | "nextMonth"
            | "thisQuarter"
            | "lastQuarter"
            | "nextQuarter"
            | "thisYear"
            | "lastYear"
            | "nextYear"
    )
}

fn table_filter_binding_fingerprint(
    sheet_id: &str,
    table: &CanonicalTable,
    range_ref: &str,
    shell: &filters::FilterShellMetadata,
) -> String {
    let value = serde_json::json!({
        "schema": "filterMetadataBindingFingerprintV1",
        "ownerPath": {
            "kind": "tableAutoFilter",
            "sheetId": sheet_id,
            "tableId": table.id,
        },
        "rangeRef": range_ref,
        "tableName": table.name,
        "filterColumns": table.filter_columns,
        "autoFilterXrUid": table.auto_filter_xr_uid,
        "autoFilterExtLst": table.auto_filter_ext_lst_raw,
        "buttonMetadata": &shell.button_metadata,
        "losslessCriteria": &shell.lossless_criteria,
    });
    format!(
        "filterMetadataBindingFingerprintV1:{}",
        serde_json::to_string(&value).unwrap_or_default()
    )
}

fn stable_column_id_for_filter_col(table: &CanonicalTable, filter_col_id: u32) -> Option<&str> {
    table
        .columns
        .iter()
        .find(|column| column.index == filter_col_id)
        .or_else(|| table.columns.get(filter_col_id as usize))
        .map(|column| column.id.as_str())
}

fn range_ref_from_bounds(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> String {
    format!(
        "{}{}:{}{}",
        column_name(start_col),
        start_row + 1,
        column_name(end_col),
        end_row + 1
    )
}

fn column_name(mut zero_based_col: u32) -> String {
    let mut chars = Vec::new();
    zero_based_col += 1;
    while zero_based_col > 0 {
        let rem = ((zero_based_col - 1) % 26) as u8;
        chars.push((b'A' + rem) as char);
        zero_based_col = (zero_based_col - 1) / 26;
    }
    chars.iter().rev().collect()
}
