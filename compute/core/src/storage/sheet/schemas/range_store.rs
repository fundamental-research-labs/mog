use std::collections::HashSet;

use cell_types::{IdAllocator, SheetId};
use compute_document::range::ValidationBinding;
use compute_document::schema::{
    KEY_RANGE_BINDINGS, KEY_RANGE_PAYLOADS, KEY_RANGES, KEY_VALIDATION_RULES,
};
use yrs::{MapRef, ReadTxn};

use super::ValidationSpec;
use super::range_view::range_schema_id_for;
use super::validation_rules::{read_ordered_validation_rules, validation_spec_to_rule_json};
use super::yrs_io::{ensure_sheet_sub_map, get_sheet_sub_map};

#[derive(Debug, Clone)]
pub(super) struct RangeBackedValidationSpec {
    pub(super) rule_id: String,
    pub(super) spec: ValidationSpec,
}

pub(super) fn create_validation_ranges(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    rule_id: &str,
    spec: &ValidationSpec,
    priority: u64,
    id_alloc: &IdAllocator,
) {
    let Some(rules_map) = ensure_sheet_sub_map(txn, sheets_root, sheet_id, KEY_VALIDATION_RULES)
    else {
        return;
    };
    let Some(ranges_map) = ensure_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGES) else {
        return;
    };
    let Some(payloads_map) = ensure_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_PAYLOADS)
    else {
        return;
    };
    let Some(bindings_map) = ensure_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_BINDINGS)
    else {
        return;
    };

    let rule_json = validation_spec_to_rule_json(spec, priority);
    compute_document::range::write_validation_rule(txn, &rules_map, rule_id, &rule_json);

    let binding = ValidationBinding {
        rule_ref: rule_id.to_string(),
    };
    let binding_bytes = binding.to_bytes();

    for _range_str in &spec.ranges {
        let range_id = id_alloc.next_range_id();
        let metadata = compute_document::range::RangeMetadata {
            range_id,
            kind: cell_types::RangeKind::Validation,
            anchor: cell_types::RangeAnchor::Strict {
                row_ids: Vec::new(),
                col_ids: Vec::new(),
            },
            encoding: cell_types::PayloadEncoding::None,
            row_axis: None,
            col_axis: None,
            row_ids: Vec::new(),
            col_ids: Vec::new(),
        };
        compute_document::range::write_range_to_yrs(
            txn,
            &ranges_map,
            &payloads_map,
            &metadata,
            &[],
        );
        compute_document::range::write_range_binding(txn, &bindings_map, &range_id, &binding_bytes);
    }
}

pub(crate) fn write_imported_validation_specs(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    specs: &[ValidationSpec],
    anonymous_id_prefix: &str,
) {
    for (idx, spec) in specs.iter().enumerate() {
        let base_id = range_schema_id_for(spec, idx);
        let rule_id = if spec.uid.as_deref().unwrap_or_default().is_empty() {
            format!("{anonymous_id_prefix}{base_id}")
        } else {
            base_id
        };
        create_validation_ranges(
            txn,
            sheets_root,
            sheet_id,
            &rule_id,
            spec,
            idx as u64,
            &crate::storage::STORAGE_ID_ALLOC,
        );
    }
}

pub(super) fn delete_validation_ranges_for_rule(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    rule_id: &str,
) {
    let Some(ranges_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGES) else {
        return;
    };
    let Some(payloads_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_PAYLOADS)
    else {
        return;
    };
    let Some(bindings_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_BINDINGS)
    else {
        return;
    };

    let entries = compute_document::range::read_ranges_from_yrs(txn, &ranges_map, &payloads_map);
    let mut to_remove = Vec::new();
    for entry in &entries {
        if entry.metadata.kind != cell_types::RangeKind::Validation {
            continue;
        }
        if let Some(binding_data) = compute_document::range::read_range_binding(
            txn,
            &bindings_map,
            &entry.metadata.range_id,
        ) && let Some(binding) = ValidationBinding::from_bytes(&binding_data)
            && binding.rule_ref == rule_id
        {
            to_remove.push(entry.metadata.range_id);
        }
    }

    for range_id in &to_remove {
        compute_document::range::remove_range_from_yrs(txn, &ranges_map, &payloads_map, range_id);
        compute_document::range::remove_range_binding(txn, &bindings_map, range_id);
    }

    if let Some(rules_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_VALIDATION_RULES) {
        let remaining =
            compute_document::range::count_bindings_for_rule(txn, &bindings_map, rule_id);
        if remaining == 0 {
            compute_document::range::remove_validation_rule(txn, &rules_map, rule_id);
        }
    }
}

pub(super) fn read_range_backed_validation_specs(
    txn: &impl ReadTxn,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Vec<ValidationSpec> {
    read_range_backed_validation_entries(txn, sheets_root, sheet_id)
        .into_iter()
        .map(|entry| entry.spec)
        .collect()
}

pub(super) fn read_range_backed_validation_entries(
    txn: &impl ReadTxn,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Vec<RangeBackedValidationSpec> {
    let Some(ranges_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGES) else {
        return Vec::new();
    };
    let Some(payloads_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_PAYLOADS)
    else {
        return Vec::new();
    };
    let Some(bindings_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_BINDINGS)
    else {
        return Vec::new();
    };
    let Some(rules_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_VALIDATION_RULES)
    else {
        return Vec::new();
    };

    let entries = compute_document::range::read_ranges_from_yrs(txn, &ranges_map, &payloads_map);
    let mut seen_rules: HashSet<String> = HashSet::new();

    for entry in &entries {
        if entry.metadata.kind != cell_types::RangeKind::Validation {
            continue;
        }
        if let Some(binding_data) = compute_document::range::read_range_binding(
            txn,
            &bindings_map,
            &entry.metadata.range_id,
        ) && let Some(binding) = ValidationBinding::from_bytes(&binding_data)
        {
            seen_rules.insert(binding.rule_ref);
        }
    }

    let mut specs = Vec::new();
    for rule in read_ordered_validation_rules(txn, &rules_map) {
        if seen_rules.contains(&rule.rule_id) {
            specs.push(RangeBackedValidationSpec {
                rule_id: rule.rule_id,
                spec: rule.spec,
            });
        }
    }
    specs
}
