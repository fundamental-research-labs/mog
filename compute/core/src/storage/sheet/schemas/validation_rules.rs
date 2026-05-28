use serde::{Deserialize, Serialize};
use yrs::{MapRef, ReadTxn};

use super::ValidationSpec;

const VALIDATION_RULE_STORAGE_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub(super) struct OrderedValidationRule {
    pub(super) rule_id: String,
    pub(super) spec: ValidationSpec,
    pub(super) priority: u64,
}

#[derive(Debug)]
struct ParsedValidationRule {
    rule_id: String,
    spec: ValidationSpec,
    priority: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredValidationRuleRef<'a> {
    version: u32,
    priority: u64,
    spec: &'a ValidationSpec,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredValidationRule {
    #[serde(rename = "version")]
    _version: u32,
    priority: u64,
    spec: ValidationSpec,
}

pub(super) fn validation_spec_to_rule_json(spec: &ValidationSpec, priority: u64) -> String {
    let stored = StoredValidationRuleRef {
        version: VALIDATION_RULE_STORAGE_VERSION,
        priority,
        spec,
    };
    serde_json::to_string(&stored).expect("ValidationSpec must serialize")
}

fn rule_json_to_parsed_validation_rule(rule_id: &str, json: &str) -> Option<ParsedValidationRule> {
    if let Ok(stored) = serde_json::from_str::<StoredValidationRule>(json) {
        return Some(ParsedValidationRule {
            rule_id: rule_id.to_string(),
            spec: stored.spec,
            priority: Some(stored.priority),
        });
    }

    serde_json::from_str::<ValidationSpec>(json)
        .ok()
        .map(|spec| ParsedValidationRule {
            rule_id: rule_id.to_string(),
            spec,
            priority: None,
        })
}

pub(super) fn read_ordered_validation_rules(
    txn: &impl ReadTxn,
    rules_map: &MapRef,
) -> Vec<OrderedValidationRule> {
    let mut parsed: Vec<ParsedValidationRule> =
        compute_document::range::read_all_validation_rules(txn, rules_map)
            .into_iter()
            .filter_map(|(rule_id, rule_json)| {
                rule_json_to_parsed_validation_rule(&rule_id, &rule_json)
            })
            .collect();

    parsed.sort_by(|a, b| a.rule_id.cmp(&b.rule_id));

    let mut next_legacy_priority = 0;
    let mut ordered: Vec<OrderedValidationRule> = parsed
        .into_iter()
        .map(|rule| {
            let priority = rule.priority.unwrap_or_else(|| {
                let priority = next_legacy_priority;
                next_legacy_priority += 1;
                priority
            });
            OrderedValidationRule {
                rule_id: rule.rule_id,
                spec: rule.spec,
                priority,
            }
        })
        .collect();

    ordered.sort_by(|a, b| {
        a.priority
            .cmp(&b.priority)
            .then_with(|| a.rule_id.cmp(&b.rule_id))
    });
    ordered
}

pub(super) fn validation_rule_priority(
    txn: &impl ReadTxn,
    rules_map: &MapRef,
    rule_id: &str,
) -> Option<u64> {
    read_ordered_validation_rules(txn, rules_map)
        .into_iter()
        .find(|rule| rule.rule_id == rule_id)
        .map(|rule| rule.priority)
}

pub(super) fn next_validation_rule_priority(txn: &impl ReadTxn, rules_map: &MapRef) -> u64 {
    read_ordered_validation_rules(txn, rules_map)
        .into_iter()
        .map(|rule| rule.priority)
        .max()
        .map_or(0, |priority| priority.saturating_add(1))
}
