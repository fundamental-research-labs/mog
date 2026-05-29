//! Cell formatting domain types.
//!
//! Pure data contracts for cell metadata and properties.
//! `CellFormat` itself lives in `crate::cell_format`.

use crate::{CellFormat, FormulaCacheProvenance};
use serde::{Deserialize, Serialize};

/// Cell metadata (non-format properties: provenance, validation, etc.)
///
/// The metadata block carries both editorial provenance (provenance /
/// validation / connection_id) and XLSX round-trip bookkeeping fields
/// required to reconstruct modeled workbook state (style palette index,
/// cellMeta flag, valueMeta index, formula-result type, import-only SST
/// provenance, original value). Typed OOXML preservation: eliminated the `extra: HashMap<String,
/// serde_json::Value>` escape hatch; every former bag key is now a
/// typed named field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CellMetadata {
    /// Origin of the cell value (e.g. "ai-generated", "user-input").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
    /// Validation rule identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<String>,
    /// External data connection identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    /// XLSX style palette index (`<c s="N">`). Resolved against the
    /// workbook-level `stylePalette` map to recover the full
    /// `CellFormat` on read. Only set on cells hydrated from an XLSX
    /// that have not yet been edited — user edits expand to full
    /// inline `CellFormat` and drop this index.
    #[serde(rename = "s", skip_serializing_if = "Option::is_none")]
    pub style_id: Option<u32>,
    /// Cell-metadata-record index (`<c cm="N">`). Paired with an entry
    /// in `metadata.xml`'s cellMetadata block.
    #[serde(rename = "cm", skip_serializing_if = "Option::is_none")]
    pub cell_metadata_index: Option<u32>,
    /// Value-metadata-record index (`<c vm="N">`). Paired with entry
    /// `N` in `metadata.xml`'s valueMetadata block.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vm: Option<u32>,
    /// Formula-result type code preserved from the original `<c>`
    /// element for cells whose computed result type cannot be
    /// recovered from the cached value alone (e.g. empty-string vs
    /// number ambiguity on formulas).
    #[serde(rename = "formulaResultType", skip_serializing_if = "Option::is_none")]
    pub formula_result_type: Option<u8>,
    /// Whether an imported formula cell had an explicit empty cached
    /// value element (`<v/>`). This is metadata for XLSX serialization,
    /// not a computed result.
    #[serde(
        rename = "hasEmptyCachedValue",
        default,
        skip_serializing_if = "is_false"
    )]
    pub has_empty_cached_value: bool,
    /// Formula-cache metadata owner. Missing/empty means absent or unknown
    /// provenance and must not authorize cache-only OOXML replay.
    #[serde(
        rename = "formulaCacheProvenance",
        default,
        skip_serializing_if = "FormulaCacheProvenance::is_absent_or_unknown"
    )]
    pub formula_cache_provenance: FormulaCacheProvenance,
    /// Original shared-string-table index for imported `t="s"` cells.
    /// Import provenance only; XLSX export derives shared-string indices from
    /// current cell values and must not use this field as SST identity.
    #[serde(rename = "sstIndex", skip_serializing_if = "Option::is_none")]
    pub original_sst_index: Option<u32>,
    /// Original `<v>` text preserved verbatim to survive float-
    /// rounding loss across the parse → compute → write cycle (e.g.
    /// `"0.1"` as stored vs `0.1_f64` after a round-trip through
    /// `f64`).
    #[serde(rename = "originalValue", skip_serializing_if = "Option::is_none")]
    pub original_value: Option<String>,
    /// Whether this cell participates in an array formula (CSE or
    /// dynamic-array). Set on both anchors and members. Display-only
    /// — the formula-bar uses this together with `is_cse_anchor` to
    /// decide whether to render `{=…}` braces.
    #[serde(rename = "isArrayFormula", default, skip_serializing_if = "is_false")]
    pub is_array_formula: bool,
    /// Whether this cell is the explicit anchor of a CSE array formula
    /// (`Ctrl+Shift+Enter`). True only on the top-left anchor. Members
    /// of the same CSE array have `is_array_formula=true` but
    /// `is_cse_anchor=false`. Editing any member of a CSE array
    /// (anchor or projected) is rejected by Rust as
    /// `ComputeError::PartialArrayWrite`.
    #[serde(rename = "isCseAnchor", default, skip_serializing_if = "is_false")]
    pub is_cse_anchor: bool,
}

/// Full cell properties (format + metadata combined).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CellProperties {
    /// Visual formatting for the cell.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<CellFormat>,
    /// Origin of the cell value (e.g. "ai-generated", "user-input").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
    /// Validation rule identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<String>,
    /// External data connection identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    /// XLSX style palette index. See [`CellMetadata::style_id`].
    #[serde(rename = "s", skip_serializing_if = "Option::is_none")]
    pub style_id: Option<u32>,
    /// Cell-metadata-record index. See [`CellMetadata::cell_metadata_index`].
    #[serde(rename = "cm", skip_serializing_if = "Option::is_none")]
    pub cell_metadata_index: Option<u32>,
    /// Value-metadata-record index. See [`CellMetadata::vm`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vm: Option<u32>,
    /// Cell-level phonetic display flag (`ph`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub phonetic: bool,
    /// Original lexical value for OOXML date cells (`t="d"`).
    #[serde(rename = "dateLexicalValue", skip_serializing_if = "Option::is_none")]
    pub date_lexical_value: Option<String>,
    /// Formula-result type code. See [`CellMetadata::formula_result_type`].
    #[serde(rename = "formulaResultType", skip_serializing_if = "Option::is_none")]
    pub formula_result_type: Option<u8>,
    /// Explicit empty formula cached value marker. See
    /// [`CellMetadata::has_empty_cached_value`].
    #[serde(
        rename = "hasEmptyCachedValue",
        default,
        skip_serializing_if = "is_false"
    )]
    pub has_empty_cached_value: bool,
    /// Formula-cache metadata owner. See [`CellMetadata::formula_cache_provenance`].
    #[serde(
        rename = "formulaCacheProvenance",
        default,
        skip_serializing_if = "FormulaCacheProvenance::is_absent_or_unknown"
    )]
    pub formula_cache_provenance: FormulaCacheProvenance,
    /// Original SST index. See [`CellMetadata::original_sst_index`].
    #[serde(rename = "sstIndex", skip_serializing_if = "Option::is_none")]
    pub original_sst_index: Option<u32>,
    /// Original `<v>` text. See [`CellMetadata::original_value`].
    #[serde(rename = "originalValue", skip_serializing_if = "Option::is_none")]
    pub original_value: Option<String>,
    /// Whether this cell is part of an array formula. See
    /// [`CellMetadata::is_array_formula`].
    #[serde(rename = "isArrayFormula", default, skip_serializing_if = "is_false")]
    pub is_array_formula: bool,
    /// Whether this cell is the CSE anchor. See
    /// [`CellMetadata::is_cse_anchor`].
    #[serde(rename = "isCseAnchor", default, skip_serializing_if = "is_false")]
    pub is_cse_anchor: bool,
}

impl CellProperties {
    /// Returns true if every metadata field on this struct is empty
    /// (`None`, `false`, or empty). Used by callers that need to decide
    /// whether to drop the properties entry entirely when the format
    /// has been cleared.
    pub fn metadata_is_empty(&self) -> bool {
        self.provenance.is_none()
            && self.validation.is_none()
            && self.connection_id.is_none()
            && self.style_id.is_none()
            && self.cell_metadata_index.is_none()
            && self.vm.is_none()
            && !self.phonetic
            && self.date_lexical_value.is_none()
            && self.formula_result_type.is_none()
            && !self.has_empty_cached_value
            && self.formula_cache_provenance.is_absent_or_unknown()
            && self.original_sst_index.is_none()
            && self.original_value.is_none()
            && !self.is_array_formula
            && !self.is_cse_anchor
    }
}

impl CellMetadata {
    /// Returns true if every field is empty.
    pub fn is_empty(&self) -> bool {
        self.provenance.is_none()
            && self.validation.is_none()
            && self.connection_id.is_none()
            && self.style_id.is_none()
            && self.cell_metadata_index.is_none()
            && self.vm.is_none()
            && self.formula_result_type.is_none()
            && !self.has_empty_cached_value
            && self.formula_cache_provenance.is_absent_or_unknown()
            && self.original_sst_index.is_none()
            && self.original_value.is_none()
            && !self.is_array_formula
            && !self.is_cse_anchor
    }
}

#[inline]
fn is_false(b: &bool) -> bool {
    !*b
}
