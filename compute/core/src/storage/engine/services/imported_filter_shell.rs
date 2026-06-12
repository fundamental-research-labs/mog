use std::collections::{BTreeMap, BTreeSet};

use domain_types::domain::filter::{AutoFilter, OoxmlFilterType};

use crate::storage::sheet::filters;

pub(in crate::storage::engine::services) fn build_filter_shell_metadata(
    imported_auto_filter: Option<&AutoFilter>,
    button_metadata: BTreeMap<String, filters::FilterButtonMetadata>,
) -> filters::FilterShellMetadata {
    let mut unsupported_reasons = BTreeSet::new();
    let mut lossless_criteria = Vec::new();
    let mut has_active_lossless_criteria = false;

    if let Some(auto_filter) = imported_auto_filter {
        if auto_filter.ext_lst_raw.is_some() {
            unsupported_reasons.insert(filters::ImportFilterUnsupportedReason::UnknownExtension);
        }
        for column in &auto_filter.columns {
            if column.ext_lst_raw.is_some() {
                unsupported_reasons
                    .insert(filters::ImportFilterUnsupportedReason::UnknownExtension);
            }
            let Some(filter_type) = &column.filter_type else {
                continue;
            };
            has_active_lossless_criteria = true;
            unsupported_reasons.extend(unsupported_reasons_for_filter_type(filter_type));
            lossless_criteria.push(filters::LosslessCriterionDescriptor {
                filter_col_id: Some(column.col_index),
                table_column_id: None,
                table_column_ordinal: None,
                kind: lossless_filter_kind(filter_type).to_string(),
                preserved_json: serde_json::to_value(filter_type)
                    .unwrap_or(serde_json::Value::Null),
            });
        }
    }

    let unsupported_reasons = unsupported_reasons.into_iter().collect::<Vec<_>>();
    filters::FilterShellMetadata {
        capability: if unsupported_reasons.is_empty() {
            filters::FilterCapability::Supported
        } else {
            filters::FilterCapability::Unsupported
        },
        unsupported_reasons,
        has_active_lossless_criteria,
        button_metadata,
        lossless_criteria,
    }
}

pub(in crate::storage::engine::services) fn unsupported_reasons_for_filter_type(
    filter_type: &OoxmlFilterType,
) -> Vec<filters::ImportFilterUnsupportedReason> {
    match filter_type {
        OoxmlFilterType::Values {
            date_group_items, ..
        } if !date_group_items.is_empty() => {
            vec![filters::ImportFilterUnsupportedReason::DateGroupUnsupported]
        }
        OoxmlFilterType::Custom { conditions, .. } => {
            if conditions
                .iter()
                .any(|condition| !is_supported_custom_operator(&condition.operator))
            {
                vec![filters::ImportFilterUnsupportedReason::UnknownCustomOperator]
            } else {
                Vec::new()
            }
        }
        OoxmlFilterType::Dynamic { dynamic_type, .. } => {
            let mut reasons =
                vec![filters::ImportFilterUnsupportedReason::DynamicTemporalContextUnsupported];
            if !is_known_dynamic_type(dynamic_type) {
                reasons.push(filters::ImportFilterUnsupportedReason::UnknownDynamicType);
            }
            reasons
        }
        OoxmlFilterType::Color { .. } => {
            vec![filters::ImportFilterUnsupportedReason::ColorDxfUnresolved]
        }
        OoxmlFilterType::Icon { .. } => {
            vec![filters::ImportFilterUnsupportedReason::IconFilterUnsupported]
        }
        _ => Vec::new(),
    }
}

pub(in crate::storage::engine::services) fn lossless_filter_kind(
    filter_type: &OoxmlFilterType,
) -> &'static str {
    match filter_type {
        OoxmlFilterType::Values { .. } => "values",
        OoxmlFilterType::Top10 { .. } => "top10",
        OoxmlFilterType::Custom { .. } => "custom",
        OoxmlFilterType::Dynamic { .. } => "dynamic",
        OoxmlFilterType::Color { .. } => "color",
        OoxmlFilterType::Icon { .. } => "icon",
    }
}

pub(in crate::storage::engine::services) fn filter_binding_fingerprint(
    sheet_id: &str,
    range_ref: &str,
    imported_auto_filter: Option<&AutoFilter>,
    shell: &filters::FilterShellMetadata,
    col_id_to_header_cell_id: &BTreeMap<u32, String>,
) -> String {
    let value = serde_json::json!({
        "schema": "filterMetadataBindingFingerprintV1",
        "ownerPath": { "kind": "sheetAutoFilter", "sheetId": sheet_id },
        "rangeRef": range_ref,
        "columns": imported_auto_filter.map(|auto_filter| &auto_filter.columns),
        "sort": imported_auto_filter.and_then(|auto_filter| auto_filter.sort.as_ref()),
        "xrUid": imported_auto_filter.and_then(|auto_filter| auto_filter.xr_uid.as_ref()),
        "autoFilterExtLst": imported_auto_filter.and_then(|auto_filter| auto_filter.ext_lst_raw.as_ref()),
        "buttonMetadata": &shell.button_metadata,
        "losslessCriteria": &shell.lossless_criteria,
        "colIdToHeaderCellId": col_id_to_header_cell_id,
    });
    format!(
        "filterMetadataBindingFingerprintV1:{}",
        serde_json::to_string(&value).unwrap_or_default()
    )
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
