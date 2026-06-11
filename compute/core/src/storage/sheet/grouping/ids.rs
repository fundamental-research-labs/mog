use std::sync::atomic::{AtomicU64, Ordering};

use cell_types::SheetId;

#[cfg(test)]
use super::types::GroupDefinition;
use super::types::SheetGroupingConfig;

/// Atomic counter for deterministic group ID generation.
static GROUP_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

pub(crate) fn sheet_id_to_hex(sheet_id: &SheetId) -> String {
    format!("{:032x}", sheet_id.as_u128())
}

#[cfg(test)]
pub(crate) fn hex_to_sheet_id(hex: &str) -> Option<SheetId> {
    u128::from_str_radix(hex, 16).ok().map(SheetId::from_raw)
}

pub(crate) fn generate_group_id() -> String {
    let id = GROUP_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("group-{id}")
}

pub(crate) fn generate_unique_group_id(config: &SheetGroupingConfig) -> String {
    unique_group_id_from_candidate(config, generate_group_id())
}

fn unique_group_id_from_candidate(config: &SheetGroupingConfig, candidate: String) -> String {
    if !group_id_exists(config, &candidate) {
        return candidate;
    }

    let mut next = candidate
        .strip_prefix("group-")
        .and_then(|suffix| suffix.parse::<u64>().ok())
        .and_then(|value| value.checked_add(1))
        .unwrap_or(1);

    loop {
        let id = format!("group-{next}");
        if !group_id_exists(config, &id) {
            reserve_group_id_number(next);
            return id;
        }
        next = next.checked_add(1).unwrap_or(1);
    }
}

fn reserve_group_id_number(id_number: u64) {
    if let Some(min_next) = id_number.checked_add(1) {
        GROUP_ID_COUNTER.fetch_max(min_next, Ordering::Relaxed);
    }
}

fn group_id_exists(config: &SheetGroupingConfig, id: &str) -> bool {
    config
        .row_groups
        .iter()
        .chain(config.column_groups.iter())
        .any(|group| group.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sheet::grouping::types::GroupAxis;

    fn group(id: &str, axis: GroupAxis) -> GroupDefinition {
        GroupDefinition {
            id: id.to_string(),
            sheet_id: "sheet".to_string(),
            axis,
            start: 0,
            end: 1,
            level: 1,
            collapsed: false,
            parent_id: None,
            hidden: false,
            collapsed_on_member: false,
        }
    }

    #[test]
    fn unique_group_id_keeps_unused_candidate() {
        let config = SheetGroupingConfig::default();

        assert_eq!(
            unique_group_id_from_candidate(&config, "group-1".to_string()),
            "group-1"
        );
    }

    #[test]
    fn unique_group_id_skips_existing_ids_across_axes() {
        let config = SheetGroupingConfig {
            row_groups: vec![group("group-1", GroupAxis::Row)],
            column_groups: vec![
                group("group-2", GroupAxis::Column),
                group("group-3", GroupAxis::Column),
            ],
            ..SheetGroupingConfig::default()
        };

        assert_eq!(
            unique_group_id_from_candidate(&config, "group-1".to_string()),
            "group-4"
        );
    }

    #[test]
    fn generate_unique_group_id_reserves_skipped_ids() {
        let config = SheetGroupingConfig {
            row_groups: vec![
                group("group-1", GroupAxis::Row),
                group("group-2", GroupAxis::Row),
                group("group-3", GroupAxis::Row),
            ],
            ..SheetGroupingConfig::default()
        };

        let first = generate_unique_group_id(&config);
        let second = generate_unique_group_id(&config);

        assert_ne!(first, second);
        assert!(!group_id_exists(&config, &first));
        assert!(!group_id_exists(&config, &second));
    }
}
