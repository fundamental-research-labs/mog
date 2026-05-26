use serde::{Deserialize, Serialize};

/// Access level granted to a principal for a given target.
///
/// Explicit discriminants guarantee wire-format stability and let the
/// matrix bit-pack five variants into 3 bits per cell.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessLevel {
    None = 0,
    Structure = 1,
    Read = 2,
    Write = 3,
    Admin = 4,
}

impl AccessLevel {
    /// Stable byte value matching the `#[repr(u8)]` discriminant.
    #[inline]
    #[must_use]
    pub const fn as_u8(self) -> u8 {
        self as u8
    }
}
