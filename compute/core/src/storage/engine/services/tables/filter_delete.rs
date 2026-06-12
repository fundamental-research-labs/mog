use super::*;
use crate::storage::engine::services::filter_results::append_row_visibility_changes;
use crate::storage::engine::services::imported_filters;

pub(in crate::storage::engine) struct PreparedTableFilterDelete {
    filter_id: String,
    filter_kind: Option<String>,
    table_id: Option<String>,
    capability: Option<String>,
    unsupported_reasons: Vec<String>,
    has_active_filter: Option<bool>,
    clearable: Option<bool>,
}

struct TableFilterDeleteMetadata {
    table_id: Option<String>,
    capability: Option<String>,
    unsupported_reasons: Vec<String>,
    has_active_filter: Option<bool>,
    clearable: Option<bool>,
}

fn filter_kind_wire(kind: &filters::FilterKind) -> &'static str {
    match kind {
        filters::FilterKind::AutoFilter => "autoFilter",
        filters::FilterKind::TableFilter => "tableFilter",
        filters::FilterKind::AdvancedFilter => "advancedFilter",
    }
}

fn filter_capability_wire(capability: filters::FilterCapability) -> &'static str {
    match capability {
        filters::FilterCapability::Supported => "supported",
        filters::FilterCapability::Unsupported => "unsupported",
    }
}

fn unsupported_reason_wire(reason: filters::ImportFilterUnsupportedReason) -> &'static str {
    match reason {
        filters::ImportFilterUnsupportedReason::UnknownDynamicType => "unknownDynamicType",
        filters::ImportFilterUnsupportedReason::UnknownCustomOperator => "unknownCustomOperator",
        filters::ImportFilterUnsupportedReason::DateGroupUnsupported => "dateGroupUnsupported",
        filters::ImportFilterUnsupportedReason::DynamicTemporalContextUnsupported => {
            "dynamicTemporalContextUnsupported"
        }
        filters::ImportFilterUnsupportedReason::ValueTokenUnresolved => "valueTokenUnresolved",
        filters::ImportFilterUnsupportedReason::ValueTypeUnsupported => "valueTypeUnsupported",
        filters::ImportFilterUnsupportedReason::ColorDxfUnresolved => "colorDxfUnresolved",
        filters::ImportFilterUnsupportedReason::IconFilterUnsupported => "iconFilterUnsupported",
        filters::ImportFilterUnsupportedReason::UnknownExtension => "unknownExtension",
        filters::ImportFilterUnsupportedReason::TableFilterShapeUnsupported => {
            "tableFilterShapeUnsupported"
        }
    }
}

fn table_filter_delete_metadata(
    filter: Option<&filters::FilterState>,
    binding: Option<&filters::FilterMetadataBinding>,
) -> TableFilterDeleteMetadata {
    let table_id = filter
        .and_then(|filter| filter.table_id.clone())
        .or_else(|| binding.and_then(|binding| binding.table_id.clone()));
    let capability = binding.map(|binding| filter_capability_wire(binding.shell.capability).into());
    let unsupported_reasons = binding
        .map(|binding| {
            binding
                .shell
                .unsupported_reasons
                .iter()
                .map(|reason| unsupported_reason_wire(*reason).to_string())
                .collect()
        })
        .unwrap_or_default();
    let has_active_filter = (filter.is_some() || binding.is_some()).then(|| {
        filter
            .map(|filter| !filter.column_filters.is_empty())
            .unwrap_or(false)
            || binding
                .map(|binding| {
                    binding.shell.has_active_lossless_criteria
                        || !binding.shell.lossless_criteria.is_empty()
                })
                .unwrap_or(false)
    });
    let clearable = filter
        .map(|filter| filter.filter_kind != filters::FilterKind::AdvancedFilter)
        .or_else(|| {
            binding.map(|binding| binding.filter_kind != filters::FilterKind::AdvancedFilter)
        });

    TableFilterDeleteMetadata {
        table_id,
        capability,
        unsupported_reasons,
        has_active_filter,
        clearable,
    }
}

pub(in crate::storage::engine) fn prepare_table_filter_delete(
    stores: &EngineStores,
    sheet_id: &SheetId,
    filter_id: &str,
) -> PreparedTableFilterDelete {
    let existing = filters::get_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    let binding = filters::get_filter_metadata_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    );
    let metadata = table_filter_delete_metadata(existing.as_ref(), binding.as_ref());
    PreparedTableFilterDelete {
        filter_id: filter_id.to_string(),
        filter_kind: existing
            .as_ref()
            .map(|filter| filter_kind_wire(&filter.filter_kind).to_string()),
        table_id: metadata.table_id,
        capability: metadata.capability,
        unsupported_reasons: metadata.unsupported_reasons,
        has_active_filter: metadata.has_active_filter,
        clearable: metadata.clearable,
    }
}

pub(in crate::storage::engine) fn finish_prepared_table_filter_delete(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    prepared: PreparedTableFilterDelete,
    visibility_transitions: &[(u32, bool)],
) -> MutationResult {
    imported_filters::apply_visibility_transitions(
        stores,
        mirror,
        sheet_id,
        visibility_transitions,
    );

    let mut result = MutationResult::empty();
    append_row_visibility_changes(&mut result, sheet_id, visibility_transitions);
    result.filter_changes.push(FilterChange {
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: prepared.filter_id,
        filter_kind: prepared.filter_kind,
        table_id: prepared.table_id,
        capability: prepared.capability,
        unsupported_reasons: prepared.unsupported_reasons,
        has_active_filter: prepared.has_active_filter,
        clearable: prepared.clearable,
        diagnostics: Vec::new(),
        action: Some("deleted".to_string()),
        hidden_row_count: None,
        visible_row_count: None,
        kind: ChangeKind::Removed,
    });
    result
}
