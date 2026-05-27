use std::sync::atomic::{AtomicU64, Ordering};

use cell_types::SheetId;

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
