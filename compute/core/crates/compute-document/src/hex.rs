//! Hex encoding/decoding helpers for u128 IDs.
//!
//! [`SmallHex`] is a stack-allocated 32-byte hex string that avoids heap
//! allocation.  It implements `Deref<Target=str>` so it can be used anywhere
//! a `&str` is expected.

use std::borrow::Borrow;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::ops::Deref;

use cell_types::{CellId, SheetId};
use value_types::ComputeError;

// ---------------------------------------------------------------------------
// Lookup table for fast hex conversion
// ---------------------------------------------------------------------------

const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";

// ---------------------------------------------------------------------------
// SmallHex — stack-allocated 32-char hex string
// ---------------------------------------------------------------------------

/// A 32-character lowercase hex string stored on the stack.
///
/// This is the output of [`id_to_hex`] and is the standard representation for
/// u128 IDs (CellId, SheetId, RowId, ColId) as Yrs map keys.
#[derive(Clone, Copy)]
pub struct SmallHex {
    buf: [u8; 32],
}

impl Default for SmallHex {
    #[inline]
    fn default() -> Self {
        SmallHex { buf: [b'0'; 32] }
    }
}

impl serde::Serialize for SmallHex {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl From<SmallHex> for String {
    #[inline]
    fn from(h: SmallHex) -> String {
        h.as_str().to_owned()
    }
}

impl From<SmallHex> for std::sync::Arc<str> {
    #[inline]
    fn from(h: SmallHex) -> std::sync::Arc<str> {
        std::sync::Arc::from(h.as_str())
    }
}

impl SmallHex {
    /// Create a `SmallHex` from a `u128` value.
    #[inline]
    pub fn from_u128(id: u128) -> Self {
        let mut buf = [0u8; 32];
        let bytes = id.to_be_bytes(); // 16 bytes
        for (i, &b) in bytes.iter().enumerate() {
            buf[i * 2] = HEX_DIGITS[(b >> 4) as usize];
            buf[i * 2 + 1] = HEX_DIGITS[(b & 0x0f) as usize];
        }
        SmallHex { buf }
    }

    /// View as a `&str`.
    #[inline]
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.buf).expect("SmallHex stores only ASCII hex digits")
    }
}

impl Deref for SmallHex {
    type Target = str;
    #[inline]
    fn deref(&self) -> &str {
        self.as_str()
    }
}

impl AsRef<str> for SmallHex {
    #[inline]
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl Borrow<str> for SmallHex {
    #[inline]
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for SmallHex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for SmallHex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SmallHex(\"{}\")", self.as_str())
    }
}

impl PartialEq for SmallHex {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.buf == other.buf
    }
}

impl Eq for SmallHex {}

impl PartialEq<str> for SmallHex {
    #[inline]
    fn eq(&self, other: &str) -> bool {
        self.as_str() == other
    }
}

impl PartialEq<&str> for SmallHex {
    #[inline]
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

impl PartialEq<String> for SmallHex {
    #[inline]
    fn eq(&self, other: &String) -> bool {
        self.as_str() == other.as_str()
    }
}

impl Hash for SmallHex {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.as_str().hash(state);
    }
}

// ---------------------------------------------------------------------------
// CellGridKey — stack-allocated 65-char "rowHex:colHex" key
// ---------------------------------------------------------------------------

/// A cell grid key (`"rowIdHex:colIdHex"`) stored on the stack.
/// In production, always 65 bytes (32 + ':' + 32). The buffer supports
/// up to 65 bytes for shorter test keys.
#[derive(Clone, Copy)]
pub struct CellGridKey {
    buf: [u8; 65],
    len: u8,
}

impl CellGridKey {
    /// Build a cell grid key from two hex strings.
    #[inline]
    pub fn new(row_hex: &str, col_hex: &str) -> Self {
        let total = row_hex.len() + 1 + col_hex.len();
        debug_assert!(total <= 65, "CellGridKey overflow: {total}");
        let mut buf = [0u8; 65];
        buf[..row_hex.len()].copy_from_slice(row_hex.as_bytes());
        buf[row_hex.len()] = b':';
        buf[row_hex.len() + 1..total].copy_from_slice(col_hex.as_bytes());
        CellGridKey {
            buf,
            len: total as u8,
        }
    }

    /// View as a `&str`.
    #[inline]
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.buf[..self.len as usize])
            .expect("CellGridKey stores only ASCII hex digits plus ':'")
    }
}

impl From<CellGridKey> for String {
    #[inline]
    fn from(k: CellGridKey) -> String {
        k.as_str().to_owned()
    }
}

impl From<CellGridKey> for std::sync::Arc<str> {
    #[inline]
    fn from(k: CellGridKey) -> std::sync::Arc<str> {
        std::sync::Arc::from(k.as_str())
    }
}

impl Deref for CellGridKey {
    type Target = str;
    #[inline]
    fn deref(&self) -> &str {
        self.as_str()
    }
}

impl AsRef<str> for CellGridKey {
    #[inline]
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl Borrow<str> for CellGridKey {
    #[inline]
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for CellGridKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for CellGridKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "CellGridKey(\"{}\")", self.as_str())
    }
}

impl PartialEq for CellGridKey {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.buf == other.buf
    }
}

impl Eq for CellGridKey {}

impl Hash for CellGridKey {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.as_str().hash(state);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Convert a u128 ID to a compact hex string (32 chars, stack-allocated).
#[inline]
pub fn id_to_hex(id: u128) -> SmallHex {
    SmallHex::from_u128(id)
}

/// Parse a hex string back to u128.
pub fn hex_to_id(hex: &str) -> Option<u128> {
    u128::from_str_radix(hex, 16).ok()
}

/// Parse a cell_id UUID string to hex format (for yrs map keys).
pub fn cell_id_str_to_hex(uuid_str: &str) -> Result<SmallHex, ComputeError> {
    let id = CellId::from_uuid_str(uuid_str)?;
    Ok(id_to_hex(id.as_u128()))
}

/// Parse a hex key to a SheetId.
pub fn parse_sheet_id(hex: &str) -> Option<SheetId> {
    hex_to_id(hex).map(SheetId::from_raw)
}

/// Parse a hex key to a CellId.
pub fn parse_cell_id(hex: &str) -> Option<CellId> {
    hex_to_id(hex).map(CellId::from_raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn hex_roundtrip() {
        let id: u128 = 0x550e8400_e29b_41d4_a716_446655440000;
        let hex = id_to_hex(id);
        assert_eq!(hex.as_str(), "550e8400e29b41d4a716446655440000");
        assert_eq!(hex_to_id(&hex), Some(id));
    }

    #[test]
    fn hex_zero() {
        assert_eq!(id_to_hex(0).as_str(), "00000000000000000000000000000000");
        assert_eq!(hex_to_id("00000000000000000000000000000000"), Some(0));
    }

    #[test]
    fn hex_max() {
        assert_eq!(
            id_to_hex(u128::MAX).as_str(),
            "ffffffffffffffffffffffffffffffff"
        );
        assert_eq!(
            hex_to_id("ffffffffffffffffffffffffffffffff"),
            Some(u128::MAX)
        );
    }

    #[test]
    fn parse_ids() {
        let hex = "550e8400e29b41d4a716446655440000";
        assert!(parse_sheet_id(hex).is_some());
        assert!(parse_cell_id(hex).is_some());
        assert!(parse_sheet_id("zzz").is_none());
    }

    #[test]
    fn cell_id_str_to_hex_valid_uuid() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let hex = cell_id_str_to_hex(uuid_str).expect("valid UUID should parse");
        assert_eq!(hex.as_str(), "550e8400e29b41d4a716446655440000");
    }

    #[test]
    fn cell_id_str_to_hex_invalid_uuid() {
        let result = cell_id_str_to_hex("not-a-uuid");
        assert!(result.is_err(), "invalid UUID string should return Err");
    }

    #[test]
    fn cell_id_str_to_hex_roundtrip() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let hex = cell_id_str_to_hex(uuid_str).unwrap();
        let cell_id = parse_cell_id(&hex).expect("hex from cell_id_str_to_hex should parse back");
        let expected_u128: u128 = 0x550e8400_e29b_41d4_a716_446655440000;
        assert_eq!(cell_id.as_u128(), expected_u128);
    }

    #[test]
    fn small_hex_deref() {
        let hex = id_to_hex(42);
        let s: &str = &hex;
        assert_eq!(s.len(), 32);
    }

    #[test]
    fn small_hex_eq_str() {
        let hex = id_to_hex(0x550e8400_e29b_41d4_a716_446655440000);
        assert_eq!(hex, *"550e8400e29b41d4a716446655440000");
    }

    #[test]
    fn cell_grid_key_format() {
        let row = id_to_hex(1);
        let col = id_to_hex(2);
        let key = CellGridKey::new(&row, &col);
        assert_eq!(key.as_str().len(), 65);
        assert_eq!(&key.as_str()[32..33], ":");
    }

    #[test]
    fn small_hex_borrowed_str_lookup() {
        let hex = id_to_hex(0x2a);
        let mut map = HashMap::new();
        map.insert(hex, "value");

        assert_eq!(map.get("0000000000000000000000000000002a"), Some(&"value"));
    }

    #[test]
    fn cell_grid_key_exposes_full_initialized_prefix_only() {
        let row = "0123456789abcdef0123456789abcdef";
        let col = "fedcba9876543210fedcba9876543210";
        let key = CellGridKey::new(row, col);
        assert_eq!(
            key.as_str(),
            "0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210"
        );
        assert_eq!(key.as_str().len(), 65);
        assert!(!key.as_str().as_bytes().contains(&0));

        let short = CellGridKey::new("a", "bc");
        assert_eq!(short.as_str(), "a:bc");
        assert_eq!(short.as_str().len(), 4);
        assert!(!short.as_str().as_bytes().contains(&0));
    }
}
