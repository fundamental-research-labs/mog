//! Cell properties and metadata types.
//!
//! `CellFormat` lives in the `domain-types` crate —
//! import from there directly.

use domain_types::{CellFormat, FormulaCacheProvenance};
use serde::{Deserialize, Serialize};

/// Discriminant for region-membership kinds on the wire surface.
///
/// Mirrors `crate::projection::RegionKind` (the render-side type) plus
/// the projection-side kinds that flow through the same wire field.
/// Serialized as camelCase strings (`"arraySpill"`, `"cseArray"`,
/// `"dataTable"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RegionKind {
    /// Modern dynamic-array spill (e.g., `=SEQUENCE(5)`). The formula bar
    /// does NOT brace-wrap members.
    ArraySpill,
    /// Legacy Ctrl+Shift+Enter array formula. The formula bar DOES
    /// brace-wrap members (`{=…}`).
    CseArray,
    /// XLSX `<f t="dataTable">`. Excel parity: the formula bar brace-wraps
    /// (`{=TABLE(…)}`).
    DataTable,
}

/// Region rectangle dimensions in cells. Together with `anchor_row` /
/// `anchor_col` describes the full region rectangle, so consumers (e.g.,
/// canvas region outline) need no parallel mirror lookup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct RegionBounds {
    pub rows: u32,
    pub cols: u32,
}

/// Region membership shape carried on `CellMetadata.region`.
///
/// **No `source` field.** Formula text lives on `cellData.formula` for
/// every region cell — duplicating it on `region.source` would be a
/// parallel data path on the wire, exactly the bug class this plan
/// exists to close at the Rust layer. The formula bar reads
/// `cellData.formula`; brace policy is a per-`kind` switch (D5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionMeta {
    pub kind: RegionKind,
    pub is_anchor: bool,
    pub anchor_row: u32,
    pub anchor_col: u32,
    pub bounds: RegionBounds,
}

/// Cell metadata (non-format properties: provenance, validation, etc.)
///
/// Mirrors [`domain_types::CellMetadata`]. Typed OOXML preservation: promoted the former
/// `extra: HashMap<String, serde_json::Value>` bag to typed named
/// fields (`style_id`, `cm`, `vm`, `formula_result_type`,
/// `has_empty_cached_value`, `original_sst_index`, `original_value`).
///
/// **D3 (projection-family unification):** `region` is the unified
/// region-membership shape; `is_array_formula`, `is_cse_anchor`, and
/// `is_array_member` are back-compat flags derived from `region`.
/// They continue to flow on the wire so the formula bar / canvas keep
/// working without touching consumers in lockstep — D5 deprecates the
/// flags in favor of `region.kind`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CellMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(rename = "s", skip_serializing_if = "Option::is_none")]
    pub style_id: Option<u32>,
    #[serde(rename = "cm", skip_serializing_if = "Option::is_none")]
    pub cell_metadata_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vm: Option<u32>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub phonetic: bool,
    #[serde(rename = "dateLexicalValue", skip_serializing_if = "Option::is_none")]
    pub date_lexical_value: Option<String>,
    #[serde(rename = "formulaResultType", skip_serializing_if = "Option::is_none")]
    pub formula_result_type: Option<u8>,
    #[serde(
        rename = "hasEmptyCachedValue",
        default,
        skip_serializing_if = "is_false"
    )]
    pub has_empty_cached_value: bool,
    #[serde(
        rename = "formulaCacheProvenance",
        default,
        skip_serializing_if = "FormulaCacheProvenance::is_absent_or_unknown"
    )]
    pub formula_cache_provenance: FormulaCacheProvenance,
    #[serde(rename = "sstIndex", skip_serializing_if = "Option::is_none")]
    pub original_sst_index: Option<u32>,
    #[serde(rename = "originalValue", skip_serializing_if = "Option::is_none")]
    pub original_value: Option<String>,
    #[serde(rename = "isArrayFormula", default, skip_serializing_if = "is_false")]
    pub is_array_formula: bool,
    #[serde(rename = "isCseAnchor", default, skip_serializing_if = "is_false")]
    pub is_cse_anchor: bool,
    /// True when the cell belongs to a region but is NOT the region's
    /// anchor (the formula-owning master cell). NEW in D3 — derived as
    /// `region.is_some() && !region.is_anchor`.
    #[serde(rename = "isArrayMember", default, skip_serializing_if = "is_false")]
    pub is_array_member: bool,
    /// Region-membership shape for cells that belong to a non-trivial
    /// region (CSE array, dynamic-array spill, Data Table; future
    /// pivot / table column / etc.). `None` for plain cells outside
    /// any region.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<RegionMeta>,
}

/// Full cell properties (format + metadata combined).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CellProperties {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<CellFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(rename = "s", skip_serializing_if = "Option::is_none")]
    pub style_id: Option<u32>,
    #[serde(rename = "cm", skip_serializing_if = "Option::is_none")]
    pub cell_metadata_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vm: Option<u32>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub phonetic: bool,
    #[serde(rename = "dateLexicalValue", skip_serializing_if = "Option::is_none")]
    pub date_lexical_value: Option<String>,
    #[serde(rename = "formulaResultType", skip_serializing_if = "Option::is_none")]
    pub formula_result_type: Option<u8>,
    #[serde(
        rename = "hasEmptyCachedValue",
        default,
        skip_serializing_if = "is_false"
    )]
    pub has_empty_cached_value: bool,
    #[serde(
        rename = "formulaCacheProvenance",
        default,
        skip_serializing_if = "FormulaCacheProvenance::is_absent_or_unknown"
    )]
    pub formula_cache_provenance: FormulaCacheProvenance,
    #[serde(rename = "sstIndex", skip_serializing_if = "Option::is_none")]
    pub original_sst_index: Option<u32>,
    #[serde(rename = "originalValue", skip_serializing_if = "Option::is_none")]
    pub original_value: Option<String>,
    #[serde(rename = "isArrayFormula", default, skip_serializing_if = "is_false")]
    pub is_array_formula: bool,
    #[serde(rename = "isCseAnchor", default, skip_serializing_if = "is_false")]
    pub is_cse_anchor: bool,
}

impl CellProperties {
    /// Returns true if every metadata field on this struct is empty.
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
            && !self.is_array_member
            && self.region.is_none()
    }
}

impl From<domain_types::CellProperties> for CellProperties {
    fn from(d: domain_types::CellProperties) -> Self {
        Self {
            format: d.format,
            provenance: d.provenance,
            validation: d.validation,
            connection_id: d.connection_id,
            style_id: d.style_id,
            cell_metadata_index: d.cell_metadata_index,
            vm: d.vm,
            phonetic: d.phonetic,
            date_lexical_value: d.date_lexical_value,
            formula_result_type: d.formula_result_type,
            has_empty_cached_value: d.has_empty_cached_value,
            formula_cache_provenance: d.formula_cache_provenance,
            original_sst_index: d.original_sst_index,
            original_value: d.original_value,
            is_array_formula: d.is_array_formula,
            is_cse_anchor: d.is_cse_anchor,
        }
    }
}

impl From<CellProperties> for domain_types::CellProperties {
    fn from(s: CellProperties) -> Self {
        Self {
            format: s.format,
            provenance: s.provenance,
            validation: s.validation,
            connection_id: s.connection_id,
            style_id: s.style_id,
            cell_metadata_index: s.cell_metadata_index,
            vm: s.vm,
            phonetic: s.phonetic,
            date_lexical_value: s.date_lexical_value,
            formula_result_type: s.formula_result_type,
            has_empty_cached_value: s.has_empty_cached_value,
            formula_cache_provenance: s.formula_cache_provenance,
            original_sst_index: s.original_sst_index,
            original_value: s.original_value,
            is_array_formula: s.is_array_formula,
            is_cse_anchor: s.is_cse_anchor,
        }
    }
}

#[inline]
fn is_false(b: &bool) -> bool {
    !*b
}
