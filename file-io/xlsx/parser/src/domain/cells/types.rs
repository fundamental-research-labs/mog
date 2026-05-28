//! Cell type definitions and constants for the cell parser.

/// Cell type enumeration
pub const CELL_TYPE_EMPTY: u8 = 0;
pub const CELL_TYPE_NUMBER: u8 = 1;
pub const CELL_TYPE_STRING: u8 = 2;
pub const CELL_TYPE_BOOL: u8 = 3;
pub const CELL_TYPE_ERROR: u8 = 4;
pub const CELL_TYPE_FORMULA: u8 = 5;
/// Inline formula string result (t="str"). The <v> contains the literal string,
/// NOT a shared string index. Distinct from CELL_TYPE_STRING (t="s").
pub const CELL_TYPE_FORMULA_STRING: u8 = 6;
/// OOXML date lexical cell (`t="d"`). The <v> contains an ISO/date string.
pub const CELL_TYPE_DATE: u8 = 7;

/// Value type enumeration (for value_type field)
pub const VALUE_TYPE_NONE: u8 = 0;
pub const VALUE_TYPE_INLINE: u8 = 1;
pub const VALUE_TYPE_SHARED_STRING: u8 = 2;
pub const VALUE_TYPE_FORMULA: u8 = 3;
/// Cached formula: cell has a formula element (e.g., self-closing `<f .../>` shared formula
/// reference) but the value bytes contain the cached `<v>` value, not formula text.
/// The binary path treats this identically to VALUE_TYPE_INLINE since it doesn't check
/// value_type. The full path uses this to detect formula cells and extract their cached values.
pub const VALUE_TYPE_CACHED_FORMULA: u8 = 4;

/// Cell data layout in shared buffer (20 bytes per cell)
///
/// This struct is designed for zero-copy transfer between WASM and JavaScript
/// via SharedArrayBuffer. The packed representation ensures consistent memory
/// layout across platforms.
#[repr(C, packed)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CellData {
    /// Row index (0-indexed), supports up to 1,048,576 rows
    pub row: u32,
    /// Column index (0-indexed), supports up to 16,384 columns (A-XFD)
    pub col: u32,
    /// Cell type: 0=empty, 1=number, 2=string, 3=bool, 4=error, 5=formula
    pub cell_type: u8,
    /// Style index from the cell's 's' attribute
    pub style_idx: u16,
    /// Value type: 0=none, 1=inline, 2=shared_string, 3=formula
    pub value_type: u8,
    /// Offset into the string buffer where the value starts
    pub value_offset: u32,
    /// Length of the value in the string buffer
    pub value_len: u32,
}

// Compile-time assertion for struct size
const _: () = assert!(core::mem::size_of::<CellData>() == 20);

/// Authored blank cell with an explicit `s` attribute.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthoredStyleOnlyCell {
    pub row: u32,
    pub col: u32,
    pub style_idx: u32,
}

/// Shared formula metadata extracted during cell parsing.
///
/// This is stored separately from `CellData` to avoid changing the 20-byte
/// binary layout. The full parse path collects these entries alongside cells,
/// then uses them to expand shared formula references in a post-processing pass.
#[derive(Debug, Clone)]
pub struct SharedFormulaInfo {
    /// The `si` attribute value from `<f t="shared" si="N" ...>`
    pub si: u32,
    /// Row of this cell (0-indexed)
    pub row: u32,
    /// Column of this cell (0-indexed)
    pub col: u32,
    /// Index into the cells buffer where this cell is stored
    pub cell_index: usize,
    /// True if this cell defines the shared formula (master cell with `ref=` and formula text).
    /// False if this cell is a reference cell (self-closing `<f t="shared" si="N"/>`).
    pub is_master: bool,
    /// For master cells: the formula text. For reference cells: None.
    pub formula_text: Option<String>,
}

/// A data table entry extracted from `<f t="dataTable">` elements.
///
/// Captures the region bounds and the typed r1/r2 input cell references for
/// propagation to the snapshot. The `TABLE(r2, r1)` formula written into the
/// body cells is regenerated from the typed refs at write time — no
/// `formula: String` field exists, by design (typed data-table input refs boundaries 1.5–1.7).
///
/// `row_input_ref` and `col_input_ref` carry the *raw* r1/r2 semantics; the
/// `r1 -> col` / `r2 -> row` swap (Excel's inverted naming) happens at the
/// parser → domain boundary in `convert_data_tables`.
#[derive(Debug, Clone)]
pub struct DataTableEntry {
    /// 0-based start row of the data table region.
    pub start_row: u32,
    /// 0-based start column of the data table region.
    pub start_col: u32,
    /// 0-based end row (inclusive) of the data table region.
    pub end_row: u32,
    /// 0-based end column (inclusive) of the data table region.
    pub end_col: u32,
    /// Typed reference from the r1 attribute (single cell, sheet-local).
    /// `None` for a missing or `#REF!` r1 attribute (broken-ref semantics
    /// preserved by the snapshot's `find_data_table_at` consumer).
    /// WARNING: Excel's naming is inverted — r1 ("row input cell") actually
    /// receives top-row (column-varying) values. Normalized at the parser→domain
    /// boundary in `convert_data_tables`.
    pub row_input_ref: Option<formula_types::CellRef>,
    /// Typed reference from the r2 attribute (single cell, sheet-local).
    /// `None` for a missing or `#REF!` r2 attribute.
    /// WARNING: Excel's naming is inverted — r2 ("column input cell") actually
    /// receives left-column (row-varying) values. Normalized at the parser→domain
    /// boundary in `convert_data_tables`.
    pub col_input_ref: Option<formula_types::CellRef>,
    /// Raw authored `r1` attribute, if present and non-broken.
    pub r1: Option<String>,
    /// Raw authored `r2` attribute, if present and non-broken.
    pub r2: Option<String>,
    /// Whether this is a 2D data table (dt2D attribute).
    pub dt2d: bool,
    /// Whether to always calculate this data table (aca attribute).
    pub aca: bool,
    /// Whether to calculate this data table (ca attribute).
    pub ca: bool,
    /// OOXML data-table input mode flag (bx attribute).
    pub bx: bool,
    /// Whether data table uses references (dtr attribute).
    pub dtr: bool,
    /// Whether to delete row 1 of the data table (del1 attribute).
    pub del1: bool,
    /// Whether to delete row 2 of the data table (del2 attribute).
    pub del2: bool,
}

/// Shared formula master cell metadata collected during parsing.
#[derive(Debug, Clone)]
pub struct SharedFormulaMaster {
    pub formula_text: String,
    pub master_row: u32,
    pub master_col: u32,
    /// The `ref="..."` attribute value (e.g., "A1:A10").
    pub ref_range: String,
}

/// Side-channel data collected during `parse_worksheet_fast_with_extras`.
///
/// When passed to the parse function, shared formula info, cached formula values,
/// and data table info are collected during the single parse pass, eliminating the
/// need for a separate XML rescan in `postprocess_worksheet`.
#[derive(Debug, Default)]
pub struct ParseExtras {
    /// Shared formula masters: si -> SharedFormulaMaster
    pub sf_masters: std::collections::HashMap<u32, SharedFormulaMaster>,
    /// Shared formula references: (si, row, col)
    pub sf_refs: Vec<(u32, u32, u32)>,
    /// Cached `<v>` values for formula cells: (cell_index, offset_in_strings_buffer, len)
    pub cached_values: Vec<(usize, u32, u32)>,
    /// Data table entries with region bounds and input cell references.
    pub data_tables: Vec<DataTableEntry>,
    /// Cell indices where the `<f>` element has `ca="1"` (needs recalculation).
    /// The cached `<v>` value in these cells may be stale or a placeholder.
    pub force_recalc_indices: Vec<usize>,
    /// Array formula ranges: (cell_index, ref_string).
    /// Used to identify spill ranges from `<f t="array" ref="A1:C5">`.
    /// The source cell has this entry; phantom cells within the range have cached
    /// values but no formula and should be excluded from the snapshot.
    pub array_refs: Vec<(usize, String)>,
    /// Cell indices where the `<f>` element has `aca="1"` (always calculate array).
    /// This attribute appears on array formula master cells.
    pub aca_indices: Vec<usize>,
    /// Cell indices and effective metadata indexes from the `<c cm="N">` attribute.
    /// `cm="0"` is the OOXML default and is treated as no effective metadata
    /// reference.
    pub cm_cells: Vec<(usize, u32)>,
    /// Cell indices where the `<c>` element has a `vm` attribute (value metadata index).
    /// The `vm` attribute is a 1-based index into the value metadata (`xl/richData/`)
    /// parts, used for rich value types like linked data types and images-in-cells.
    /// Stored as (cell_index, vm_value).
    pub vm_cells: Vec<(usize, u32)>,
    /// Cell indices where the `<c>` element has `ph="1"`.
    pub phonetic_cells: Vec<usize>,
    /// Cell indices and lexical values for OOXML date cells (`t="d"`).
    pub date_cells: Vec<(usize, String)>,
    /// Per-row x14ac:dyDescent values: (0-based row index, descent value).
    /// Collected during row parsing for roundtrip fidelity.
    pub row_descents: Vec<(u32, f64)>,
    /// Per-row spans attribute values: (0-based row index, spans string e.g. "1:55").
    /// Collected during row parsing for roundtrip fidelity.
    pub row_spans: Vec<(u32, String)>,
    /// Cell indices where the `<f>` element has `xml:space="preserve"`.
    pub xml_space_formula_indices: Vec<usize>,
    /// Cell indices where the `<v>` element has `xml:space="preserve"`.
    pub xml_space_value_indices: Vec<usize>,
    /// 0-based row indices for empty rows that have no attributes and no cells
    /// but are explicitly present in the source XML (e.g., `<row r="97"/>`).
    pub bare_empty_rows: Vec<u32>,
    /// Original SST indices for shared-string cells: (cell_index, sst_index).
    /// Preserves the original `<v>N</v>` value so the writer can emit the exact
    /// same index when doing raw SST passthrough, avoiding the lossy text-based
    /// reverse lookup that fails for duplicate SST entries.
    pub sst_indices: Vec<(usize, u32)>,
    /// Cell indices where the `<c>` element had an explicit `s` attribute
    /// (including `s="0"`). Needed for round-trip fidelity: `s="0"` vs absent
    /// `s` are semantically equivalent but must be preserved byte-for-byte.
    pub explicit_style_cells: Vec<usize>,
    /// Authored blank cells with an explicit `s` attribute, captured before
    /// row/column-default redundancy filtering can drop the `<c>` node.
    pub authored_style_only_cells: Vec<AuthoredStyleOnlyCell>,
}
