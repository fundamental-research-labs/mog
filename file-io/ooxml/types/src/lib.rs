//! # ooxml-types
//!
//! Shared OOXML vocabulary types for the Shortcut Data OS.
//!
//! This crate contains curated enums, structs, and constants for OOXML concepts
//! used by Mog import/export code. It is a shared vocabulary and typed
//! preservation helper crate, not a complete ECMA-376 schema object model and
//! not an XML parser or writer by itself. The production parser/writer contract
//! is the source of truth for XLSX round-trip coverage.
//!
//! ## Design Principles
//!
//! - **Serde always on** — `serde` derive is unconditional (feature kept as no-op for compat)
//! - **Attribute-level conversion** — `from_ooxml(&str)` / `to_ooxml(&self)` for
//!   string↔enum conversion. No XML tree parsing.
//! - **Scoped completeness** — verified closed enums may document complete ECMA coverage
//!   individually; for example, `ShapePreset` covers all 187 OOXML ST_ShapeType values.
//! - **Shared vocabulary** — types used by both read and write paths live here
//! - **Coverage manifest** — `docs/ooxml-coverage/manifest.json` records coarse schema/dialect
//!   ownership and parser/writer integration status for audited modules.

// OOXML choice groups are represented as direct schema enums. Boxing large
// variants would leak allocation policy into the shared vocabulary API.
#![allow(clippy::large_enum_variant)]

pub mod calc_chain;
pub mod cell_watches;
pub mod chart_ex;
pub mod charts;
pub mod chartsheet;
pub mod comments;
pub mod cond_format;
pub mod controls;
pub mod custom_views;
pub mod doc_props;
pub mod drawing_refs;
pub mod drawings;
pub mod external_links;
pub mod ole;
pub mod print;
pub mod protection;
pub mod shared;
pub mod shared_strings;
pub mod slicers;
pub mod sparklines;
pub mod styles;
pub mod tables;
pub mod themes;
pub mod timelines;
pub mod workbook;
pub mod worksheet;

pub mod connections;
pub mod mdx;
pub mod metadata;
pub mod pivot;
pub mod revisions;
pub mod smart_tags;
pub mod volatile;
pub mod web_publish;
pub mod xml_map;

// =============================================================================
// ExtensionList — CT_ExtensionList (shared across SML types)
// =============================================================================

/// Extension list for owner-scoped forward-compatible round-tripping
/// (ECMA-376 CT_ExtensionList).
///
/// Many SML complex types (CT_Workbook, CT_BookView, CT_Xf, CT_CellStyle,
/// CT_Dxf, CT_Stylesheet, CT_Sst, etc.) include an optional `<extLst>` child
/// element that carries vendor-specific extension data (e.g., x14/x15 slicer
/// styles, sparklines, data validations).
///
/// This type stores raw XML for feature owners that explicitly validate and
/// replay extension payloads. Its presence is not a blanket guarantee that any
/// `extLst` is edit-safe or semantically supported.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ExtensionList {
    /// Raw XML string of the `<extLst>` element contents.
    ///
    /// Contains zero or more `<ext uri="...">` child elements as a raw XML
    /// fragment. `None` means no extension list was present.
    pub raw_xml: Option<String>,
}

// =============================================================================
// String Type Aliases (ECMA-376 simple type restrictions)
// =============================================================================

/// Cell reference string, e.g. `"A1"`, `"B12"` (ECMA-376 ST_CellRef).
pub type CellRef = String;

/// Cell range reference, e.g. `"A1:B5"` (ECMA-376 ST_Ref).
pub type Ref = String;

/// Space-separated list of cell range references (ECMA-376 ST_Sqref).
pub type Sqref = String;

/// Absolute cell reference for formulas (ECMA-376 ST_RefA).
pub type RefA = String;

/// Formula expression string (ECMA-376 ST_Formula, restriction of ST_Xstring).
pub type Formula = String;

/// Cell span string, e.g. `"1:3"` (ECMA-376 ST_CellSpan).
pub type CellSpan = String;

/// Space-separated list of cell spans (ECMA-376 ST_CellSpans).
pub type CellSpans = String;

/// 4-byte unsigned hex string, e.g. `"00FF00FF"` (ECMA-376 ST_UnsignedIntHex).
pub type UnsignedIntHex = String;

/// 2-byte unsigned hex string, e.g. `"00FF"` (ECMA-376 ST_UnsignedShortHex).
pub type UnsignedShortHex = String;

/// Text rotation value: 0-180 degrees or 255 for vertical (ECMA-376 ST_TextRotation).
/// Represented as u16 to cover the union range.
pub type TextRotation = u16;

/// XML data type string (ECMA-376 ST_XmlDataType, unrestricted).
pub type XmlDataType = String;
