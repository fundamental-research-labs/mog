use serde::{Deserialize, Serialize};
use std::fmt;

macro_rules! define_id {
    ($(#[$meta:meta])* $name:ident, $display_prefix:literal, $doc:literal) => {
        #[doc = $doc]
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(into = "String", try_from = "String")]
        #[repr(transparent)]
        pub struct $name(pub(crate) u128);

        impl $name {
            /// Create from raw u128 bytes.
            #[inline]
            pub const fn from_raw(raw: u128) -> Self {
                Self(raw)
            }

            /// Parse from UUID string (IPC boundary only).
            ///
            /// # Errors
            ///
            /// Returns `uuid::Error` if the string is not a valid UUID.
            pub fn from_uuid_str(s: &str) -> Result<Self, uuid::Error> {
                // Fast path: 32-char lowercase hex (the format we generate internally)
                if s.len() == 32 {
                    if let Some(val) = Self::parse_hex32(s.as_bytes()) {
                        return Ok(Self(val));
                    }
                }
                let id = uuid::Uuid::parse_str(s)?;
                Ok(Self(id.as_u128()))
            }

            /// Fast hex parser for exactly 32 hex chars (no dashes).
            #[inline]
            fn parse_hex32(bytes: &[u8]) -> Option<u128> {
                if bytes.len() != 32 {
                    return None;
                }
                let mut result: u128 = 0;
                for &b in bytes {
                    let digit = match b {
                        b'0'..=b'9' => b - b'0',
                        b'a'..=b'f' => b - b'a' + 10,
                        b'A'..=b'F' => b - b'A' + 10,
                        _ => return None,
                    };
                    result = (result << 4) | u128::from(digit);
                }
                Some(result)
            }

            /// Convert to hex string without dashes (IPC boundary only).
            /// Produces `"ba5e8e043e5541c4be55192e1bf10470"` — the format TS uses internally.
            #[must_use]
            pub fn to_uuid_string(&self) -> String {
                // Fast inline hex: avoid uuid::Uuid round-trip + Display formatting.
                const HEX: &[u8; 16] = b"0123456789abcdef";
                let bytes = self.0.to_be_bytes();
                let mut buf = [0u8; 32];
                for (i, &b) in bytes.iter().enumerate() {
                    buf[i * 2] = HEX[(b >> 4) as usize];
                    buf[i * 2 + 1] = HEX[(b & 0xf) as usize];
                }
                String::from_utf8(buf.to_vec()).expect("hex is valid UTF-8")
            }

            /// Get the raw u128 value.
            #[inline]
            pub const fn as_u128(&self) -> u128 {
                self.0
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{prefix}({id})", prefix = $display_prefix, id = uuid::Uuid::from_u128(self.0))
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                let id = uuid::Uuid::from_u128(self.0);
                write!(f, "{id}")
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Self::from_uuid_str(s)
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> String {
                id.to_uuid_string()
            }
        }

        impl TryFrom<String> for $name {
            type Error = uuid::Error;
            fn try_from(s: String) -> Result<Self, Self::Error> {
                Self::from_uuid_str(&s)
            }
        }
    };
}

define_id!(
    #[doc(alias = "UUID")]
    CellId,
    "CellId",
    "Stable identity for a cell — survives insert/delete operations. u128 newtype over UUID bytes."
);
define_id!(
    SheetId,
    "SheetId",
    "Stable identity for a sheet. u128 newtype over UUID bytes."
);
define_id!(
    RowId,
    "RowId",
    "Stable identity for a row. u128 newtype over UUID bytes."
);
define_id!(
    ColId,
    "ColId",
    "Stable identity for a column. u128 newtype over UUID bytes."
);
define_id!(
    NameId,
    "NameId",
    "Stable identity for a defined name (named range). u128 newtype over UUID bytes. \
Reserved for unified-reference PR 2; only the type exists in PR 1 so the `WorkbookLookup` \
trait signatures compile. No allocator method yet."
);
define_id!(
    TableId,
    "TableId",
    "Stable identity for a table. u128 newtype over UUID bytes. Reserved for table dependency work; \
only the type exists in PR 1 so the `WorkbookLookup` trait signatures compile. \
No allocator method yet."
);

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_uuid_contract<Id>(id: Id, simple: &str, hyphenated: &str)
    where
        Id: Copy
            + std::fmt::Debug
            + std::fmt::Display
            + PartialEq
            + serde::Serialize
            + serde::de::DeserializeOwned
            + TryFrom<String, Error = uuid::Error>
            + Into<String>,
    {
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, format!("\"{simple}\""));
        let roundtrip: Id = serde_json::from_str(&json).unwrap();
        assert_eq!(id, roundtrip);
        let hyphenated_roundtrip: Id = serde_json::from_str(&format!("\"{hyphenated}\"")).unwrap();
        assert_eq!(id, hyphenated_roundtrip);
        let converted: String = id.into();
        assert_eq!(converted, simple);
        assert_eq!(format!("{id}"), hyphenated);
    }

    #[test]
    fn test_uuid_roundtrip() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id = CellId::from_uuid_str(uuid_str).unwrap();
        assert_eq!(id.to_uuid_string(), "550e8400e29b41d4a716446655440000");
    }

    #[test]
    fn uppercase_simple_uuid_parses_and_outputs_lowercase() {
        let id = CellId::from_uuid_str("550E8400E29B41D4A716446655440000").unwrap();
        assert_eq!(id.to_uuid_string(), "550e8400e29b41d4a716446655440000");
    }

    #[test]
    fn test_copy_semantics() {
        let id = CellId::from_raw(42);
        let copy = id;
        assert_eq!(id, copy);
    }

    #[test]
    fn test_hash_deterministic() {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let id = CellId::from_raw(12345);
        let mut h1 = DefaultHasher::new();
        let mut h2 = DefaultHasher::new();
        id.hash(&mut h1);
        id.hash(&mut h2);
        assert_eq!(h1.finish(), h2.finish());
    }

    #[test]
    fn cell_id_serde_roundtrip() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id = CellId::from_uuid_str(uuid_str).unwrap();
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"550e8400e29b41d4a716446655440000\"");
        let id2: CellId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, id2);
    }

    #[test]
    fn from_uuid_str_invalid() {
        assert!(CellId::from_uuid_str("not-a-uuid").is_err());
        assert!(CellId::from_uuid_str("").is_err());
        assert!(CellId::from_uuid_str("12345").is_err());
    }

    #[test]
    fn from_raw_as_u128_roundtrip() {
        let raw: u128 = 0xDEAD_BEEF_CAFE_BABE_1234_5678_9ABC_DEF0;
        let id = CellId::from_raw(raw);
        assert_eq!(id.as_u128(), raw);
    }

    #[test]
    fn sheet_id_basic() {
        let s1 = SheetId::from_raw(1);
        let s2 = SheetId::from_raw(2);
        assert_ne!(s1, s2);
        assert_eq!(s1, SheetId::from_raw(1));
    }

    #[test]
    fn row_id_basic() {
        let r = RowId::from_raw(100);
        assert_eq!(r.as_u128(), 100);
    }

    #[test]
    fn col_id_basic() {
        let c = ColId::from_raw(200);
        assert_eq!(c.as_u128(), 200);
    }

    #[test]
    fn display_format() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id = CellId::from_uuid_str(uuid_str).unwrap();
        assert_eq!(format!("{id}"), uuid_str);
    }

    #[test]
    fn debug_format() {
        let id = CellId::from_raw(0);
        let dbg = format!("{id:?}");
        assert!(dbg.starts_with("CellId("));
    }

    #[test]
    fn all_id_types_serde_and_uuid_strings() {
        let uuid_str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let simple = "a1b2c3d4e5f67890abcdef1234567890";

        assert_uuid_contract(CellId::from_uuid_str(uuid_str).unwrap(), simple, uuid_str);
        assert_uuid_contract(SheetId::from_uuid_str(uuid_str).unwrap(), simple, uuid_str);
        assert_uuid_contract(RowId::from_uuid_str(uuid_str).unwrap(), simple, uuid_str);
        assert_uuid_contract(ColId::from_uuid_str(uuid_str).unwrap(), simple, uuid_str);
        assert_uuid_contract(NameId::from_uuid_str(uuid_str).unwrap(), simple, uuid_str);
        assert_uuid_contract(TableId::from_uuid_str(uuid_str).unwrap(), simple, uuid_str);
    }

    #[test]
    fn deserialize_invalid_uuid_string_fails() {
        let json = "\"not-a-uuid\"";
        let result: Result<CellId, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }
}
