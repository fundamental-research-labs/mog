//! Workbook identity and external workbook reference types.
//!
//! This crate is intentionally leaf-level. It contains semantic workbook IDs,
//! session/link IDs, and parser-independent external reference keys. Host
//! document handles, paths, authorization state, and OOXML relationship details
//! belong in higher storage/runtime layers.

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![warn(clippy::all, clippy::pedantic)]

use serde::{Deserialize, Serialize};
use std::fmt;

macro_rules! define_uuid_id {
    ($name:ident, $prefix:literal, $doc:literal) => {
        #[doc = $doc]
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(into = "String", try_from = "String")]
        #[repr(transparent)]
        pub struct $name(u128);

        impl $name {
            /// Create an ID from raw UUID bytes.
            #[inline]
            #[must_use]
            pub const fn from_raw(raw: u128) -> Self {
                Self(raw)
            }

            /// Mint a new random UUID-backed ID.
            #[inline]
            #[must_use]
            pub fn new_v4() -> Self {
                Self(uuid::Uuid::new_v4().as_u128())
            }

            /// Parse an ID from either dashed UUID text or compact 32-char hex.
            ///
            /// # Errors
            ///
            /// Returns [`uuid::Error`] when the input is not valid UUID text.
            pub fn from_uuid_str(s: &str) -> Result<Self, uuid::Error> {
                let uuid = uuid::Uuid::parse_str(s)?;
                Ok(Self(uuid.as_u128()))
            }

            /// Return the raw UUID bytes as a `u128`.
            #[inline]
            #[must_use]
            pub const fn as_u128(self) -> u128 {
                self.0
            }

            /// Format as compact lowercase UUID hex without dashes.
            #[must_use]
            pub fn to_uuid_string(self) -> String {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                let bytes = self.0.to_be_bytes();
                let mut buf = [0u8; 32];
                for (i, &b) in bytes.iter().enumerate() {
                    buf[i * 2] = HEX[(b >> 4) as usize];
                    buf[i * 2 + 1] = HEX[(b & 0x0f) as usize];
                }
                String::from_utf8(buf.to_vec()).expect("hex bytes are valid UTF-8")
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", $prefix, uuid::Uuid::from_u128(self.0))
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", uuid::Uuid::from_u128(self.0))
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Self::from_uuid_str(s)
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> Self {
                id.to_uuid_string()
            }
        }

        impl TryFrom<String> for $name {
            type Error = uuid::Error;

            fn try_from(value: String) -> Result<Self, Self::Error> {
                Self::from_uuid_str(&value)
            }
        }
    };
}

define_uuid_id!(
    WorkbookId,
    "WorkbookId",
    "Stable semantic identity embedded in workbook content."
);
define_uuid_id!(
    WorkbookSessionId,
    "WorkbookSessionId",
    "Runtime identity for one trusted open workbook session; never persisted."
);
define_uuid_id!(
    LinkId,
    "LinkId",
    "Destination-workbook-scoped persisted relationship ID for an external source."
);

/// Compatibility alias for call sites that spell link identity explicitly.
pub type ExternalLinkId = LinkId;

/// Parser-preserved workbook token from external reference syntax.
///
/// This is deliberately lexical, not a resolved identity. Examples include
/// `[Budget.xlsx]`, `[1]`, and `C:\Reports\[Budget.xlsx]`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ExternalWorkbookToken {
    /// Original workbook token text from formula syntax.
    pub raw: String,
}

impl ExternalWorkbookToken {
    /// Create a token from formula text.
    #[must_use]
    pub fn new(token: String) -> Self {
        Self { raw: token }
    }

    /// Borrow the original token text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.raw
    }

    /// Consume the token and return its text.
    #[must_use]
    pub fn into_string(self) -> String {
        self.raw
    }
}

/// One A1 cell address in an external workbook, independent of parser ASTs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalA1Cell {
    /// One-based row number.
    pub row: u32,
    /// One-based column number.
    pub col: u32,
}

/// One A1 rectangular range in an external workbook.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalA1Range {
    /// Inclusive start cell.
    pub start: ExternalA1Cell,
    /// Inclusive end cell.
    pub end: ExternalA1Cell,
}

/// Absolute/relative flags for one external A1 cell address.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAbsFlags {
    /// Whether the row coordinate is absolute.
    pub row_abs: bool,
    /// Whether the column coordinate is absolute.
    pub col_abs: bool,
}

/// Absolute/relative flags for an external A1 range.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRangeAbsFlags {
    /// Flags for the range start address.
    pub start: ExternalAbsFlags,
    /// Flags for the range end address.
    pub end: ExternalAbsFlags,
}

/// Best-effort Mog sheet identity hint persisted with an external reference.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSheetIdHint {
    /// Source workbook sheet ID text as imported or emitted by Mog metadata.
    pub id: String,
}

/// Sheet selector for an external reference.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExternalSheetKey {
    /// Sheet selected by display name.
    Name {
        /// Sheet name.
        name: String,
    },
    /// Excel external-link sheet index plus optional fallback display name.
    ExcelSheetIndex {
        /// Zero-based external-link sheet index.
        index: u32,
        /// Optional display name fallback.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fallback_name: Option<String>,
    },
    /// Mog sheet identity hint plus fallback display name.
    MogSheetHint {
        /// Persisted source sheet identity hint.
        sheet_id_hint: ExternalSheetIdHint,
        /// Display name fallback.
        fallback_name: String,
    },
}

/// Address selector for an external reference.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExternalAddressKey {
    /// A single A1 cell address.
    A1 {
        /// Cell coordinates.
        r#ref: ExternalA1Cell,
        /// Absolute/relative flags.
        abs: ExternalAbsFlags,
    },
    /// A rectangular A1 range.
    Range {
        /// Range coordinates.
        r#ref: ExternalA1Range,
        /// Absolute/relative flags.
        abs: ExternalRangeAbsFlags,
    },
    /// Defined name.
    Name {
        /// Defined-name text.
        name: String,
    },
}

/// Stable unresolved key for any persisted external reference.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRefKey {
    /// Destination workbook link registry entry.
    pub link_id: LinkId,
    /// Optional external sheet selector.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<ExternalSheetKey>,
    /// External address selector.
    pub address: ExternalAddressKey,
}

/// Persisted external cell reference.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalCellRef {
    /// Destination workbook link registry entry.
    pub link_id: LinkId,
    /// External sheet selector.
    pub sheet: ExternalSheetKey,
    /// External cell address.
    pub address: ExternalA1Cell,
    /// Absolute/relative flags.
    pub abs: ExternalAbsFlags,
}

/// Persisted external range reference.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRangeRef {
    /// Destination workbook link registry entry.
    pub link_id: LinkId,
    /// External sheet selector.
    pub sheet: ExternalSheetKey,
    /// External range address.
    pub address: ExternalA1Range,
    /// Absolute/relative flags.
    pub abs: ExternalRangeAbsFlags,
}

/// Persisted external defined-name reference.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalNameRef {
    /// Destination workbook link registry entry.
    pub link_id: LinkId,
    /// Optional sheet selector for sheet-scoped names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<ExternalSheetKey>,
    /// Defined-name text.
    pub name: String,
}

/// External dependency target tracked outside local graph hot paths.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExternalDepTarget {
    /// Cell target.
    Cell(ExternalCellRef),
    /// Range target.
    Range(ExternalRangeRef),
    /// Defined-name target.
    Name(ExternalNameRef),
}

/// Runtime status class for one external workbook link.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkStatus {
    /// Link has not been resolved.
    Unresolved,
    /// Link resolution or value fetch is in progress.
    Loading,
    /// Link is resolved and usable.
    Ready,
    /// Link is using stale but permitted cached values.
    Stale,
    /// Current actor/principal is denied.
    Denied,
    /// Target cannot be used.
    Broken,
    /// Multiple candidates match and no exact target disambiguates them.
    Ambiguous,
}

/// Sanitized reason for a non-ready link status.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkStatusReason {
    /// Resolved workbook identity differs from the expected identity.
    WrongWorkbookId,
    /// Target cannot be found.
    MissingTarget,
    /// Link kind is preserved but not evaluable.
    UnsupportedLinkKind,
    /// Access policy denied resolution or source reads.
    PermissionDenied,
    /// Source exists but is unavailable.
    SourceUnavailable,
}

/// Principal-safe status view for UI/API surfaces.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatusView {
    /// Link registry entry.
    pub link_id: LinkId,
    /// Current sanitized status.
    pub status: LinkStatus,
    /// Optional sanitized reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<LinkStatusReason>,
    /// Last successful resolution timestamp.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_resolved_at: Option<String>,
    /// Cached values version, when visible to the requester.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_values_version: Option<String>,
}
