use super::*;

/// Empty cell type value
pub const CELL_TYPE_VAL_EMPTY: u8 = 0;
/// Number cell type value
pub const CELL_TYPE_VAL_NUMBER: u8 = 1;
/// String cell type value
pub const CELL_TYPE_VAL_STRING: u8 = 2;
/// Boolean cell type value
pub const CELL_TYPE_VAL_BOOL: u8 = 3;
/// Error cell type value
pub const CELL_TYPE_VAL_ERROR: u8 = 4;
/// Formula cell type value
pub const CELL_TYPE_VAL_FORMULA: u8 = 5;
/// OOXML date lexical cell (`t="d"`)
pub const CELL_TYPE_VAL_DATE: u8 = 7;

/// Cell data for full parse result (serializable version)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullCellData {
    /// Row index (0-based)
    pub row: u32,
    /// Column index (0-based)
    pub col: u32,
    /// Cell type: 0=empty, 1=number, 2=string, 3=bool, 4=error, 5=formula
    #[serde(rename = "type")]
    pub cell_type: u8,
    /// Style index
    #[serde(rename = "styleIndex")]
    pub style_idx: u16,
    /// The cell value (number as string, actual string, bool as "true"/"false", error code)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Formula if present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    /// Whether the formula has `ca="1"` (calculate always / needs recalculation).
    /// When true, the cached `<v>` value may be stale or a placeholder (e.g., `0`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub force_recalc: bool,
    /// For array formula source cells, the `ref` attribute from `<f t="array" ref="A1:C5">`.
    /// Indicates this cell is a dynamic array source and the ref gives the spill range.
    /// Phantom cells within this range should be excluded from snapshots.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub array_ref: Option<String>,
    /// Effective cell metadata index from the `cm` attribute on the `<c>` element.
    /// `None` means no metadata reference; `Some(0)` preserves an authored
    /// zero index exactly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_metadata_index: Option<u32>,
    /// Whether the `<c>` element has `ph="1"` (phonetic display enabled).
    #[serde(default, skip_serializing_if = "is_false")]
    pub phonetic: bool,
    /// Value metadata index from the `vm` attribute on the `<c>` element.
    /// A 1-based index into `xl/richData/` parts (linked data types, images-in-cells).
    /// `None` means no `vm` attribute was present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vm: Option<u32>,
    /// Original lexical value for OOXML date cells (`t="d"`).
    #[serde(skip)]
    pub date_lexical_value: Option<String>,
    /// For formula cells (cell_type == 5), the original XLSX `t` attribute that
    /// indicates the cached value type. Uses the internal cell-parser type codes:
    ///   6 = CELL_TYPE_FORMULA_STRING (t="str", cached value is a literal string)
    ///   4 = CELL_TYPE_ERROR          (t="e",   cached value is an error)
    ///   3 = CELL_TYPE_BOOL           (t="b",   cached value is boolean)
    ///   0 = unset / default (infer from value string)
    /// This lets downstream consumers distinguish e.g. a formula returning the
    /// *string* "#N/A" (t="str") from a formula returning the *error* #N/A (t="e").
    #[serde(default, skip_serializing_if = "is_zero")]
    pub cached_value_type: u8,
    /// Original OOXML formula metadata for round-trip preservation.
    /// The `formula` field continues to hold the expanded text for WASM consumers.
    /// This field is NOT serialized to JSON (WASM doesn't need it).
    #[serde(skip)]
    pub cell_formula: Option<ooxml_types::worksheet::CellFormula>,
    /// Whether the `<f>` element had `xml:space="preserve"`, for round-trip fidelity.
    #[serde(default, skip_serializing_if = "is_false")]
    pub preserve_space_formula: bool,
    /// Whether the `<v>` element had `xml:space="preserve"`, for round-trip fidelity.
    #[serde(default, skip_serializing_if = "is_false")]
    pub preserve_space_value: bool,
    /// Original SST index from `<v>N</v>` for `t="s"` cells.
    /// Preserved for raw SST passthrough to avoid lossy text-based reverse lookup.
    #[serde(skip)]
    pub sst_index: Option<u32>,
    /// Whether the cell had an explicit `s` attribute in the original XML.
    /// Needed for round-trip fidelity: `s="0"` vs absent `s` are semantically
    /// equivalent but must be preserved for byte-fidelity.
    #[serde(skip)]
    pub has_explicit_style: bool,
}
