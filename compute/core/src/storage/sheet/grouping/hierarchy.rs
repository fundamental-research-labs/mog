use super::types::{GroupDefinition, MAX_OUTLINE_LEVEL};

pub fn calculate_group_level(
    existing_groups: &[GroupDefinition],
    start: u32,
    end: u32,
) -> Result<u32, String> {
    let mut max_overlapping_level: u32 = 0;
    for group in existing_groups {
        let overlaps = !(end < group.start || start > group.end);
        if overlaps && group.level > max_overlapping_level {
            max_overlapping_level = group.level;
        }
    }
    let new_level = max_overlapping_level + 1;
    if new_level > MAX_OUTLINE_LEVEL {
        return Err(format!(
            "Cannot create group: maximum outline level ({MAX_OUTLINE_LEVEL}) exceeded"
        ));
    }
    Ok(new_level)
}

pub fn find_parent_group(
    existing_groups: &[GroupDefinition],
    start: u32,
    end: u32,
    level: u32,
) -> Option<String> {
    if level <= 1 {
        return None;
    }
    let mut potential_parents: Vec<&GroupDefinition> = existing_groups
        .iter()
        .filter(|g| g.level == level - 1 && g.start <= start && g.end >= end)
        .collect();
    potential_parents.sort_by_key(|g| g.end - g.start);
    potential_parents.first().map(|g| g.id.clone())
}
