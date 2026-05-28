pub(super) const GROUP_PREFIX: &str = "group:";
pub(super) const IDX_PREFIX: &str = "idx:";

pub(super) fn idx_key(row: u32, col: u32) -> String {
    format!("{}{},{}", IDX_PREFIX, row, col)
}

pub(super) fn group_key(group_id: &str) -> String {
    format!("{}{}", GROUP_PREFIX, group_id)
}
