// ParseTimings (for profiled parsing)
// =============================================================================

/// Detailed phase timings from a profiled parse operation.
///
/// Each field records the time in microseconds spent in that parsing phase.
/// This struct is returned alongside the parse result when using profiled
/// parse functions, enabling performance analysis of the parser.
///
/// **Important:** `zip_index_us` measures only the ZIP central directory
/// parsing (`XlsxArchive::new()`). Actual DEFLATE decompression happens
/// lazily inside `read_file()` / `read_entry()`, so the real decompression
/// cost is distributed across `shared_strings_us`, `styles_us`,
/// `metadata_us`, and `worksheet_parse_us`.
///
/// All timing fields use `f64` to avoid silent truncation on phases
/// exceeding ~4.3 seconds (the u32 microsecond limit).
///
/// The TypeScript side converts these timings into a `RustPhaseTimings`
/// interface for consumption by `ProfileContext.recordRustTimings()`.
#[derive(Debug, Clone)]
pub struct ParseTimings {
    /// Time spent parsing ZIP central directory index (us).
    /// Does NOT include actual DEFLATE decompression of entries - that cost
    /// is included in the phase that reads each entry (shared_strings_us,
    /// styles_us, metadata_us, worksheet_parse_us).
    pub(crate) zip_index_us: f64,
    /// Time spent on shared strings (us).
    /// Includes ZIP decompression of sharedStrings.xml + XML parsing.
    pub(crate) shared_strings_us: f64,
    /// Time spent on styles (us).
    /// Includes ZIP decompression of styles.xml + XML parsing.
    pub(crate) styles_us: f64,
    /// Time spent on metadata: theme, workbook, defined names, and protection (us).
    /// Includes ZIP decompression of theme1.xml, workbook.xml, etc. + XML parsing.
    pub(crate) metadata_us: f64,
    /// Total time spent parsing all worksheets (us).
    /// Includes ZIP decompression of each sheet's XML + cell/feature parsing.
    pub(crate) worksheet_parse_us: f64,
    /// Time spent in serialization (us)
    pub(crate) serde_serialize_us: f64,
    /// Total parse time including all phases (us)
    pub(crate) total_us: f64,

    // --- Shared strings sub-phase breakdown ---
    /// Sub-phase: ZIP decompression of sharedStrings.xml (us)
    pub(crate) ss_zip_us: f64,
    /// Sub-phase: offset parsing — SharedStrings::parse() builds Vec<StringRef> (us)
    pub(crate) ss_parse_refs_us: f64,
    /// Sub-phase: string materialization — get() + String allocation loop (us)
    pub(crate) ss_materialize_us: f64,
    /// Uncompressed size of sharedStrings.xml in bytes
    pub(crate) ss_xml_bytes: f64,
    /// Total shared string count
    pub(crate) ss_count_total: f64,
    /// Strings that are zero-copy (plain, no decoding needed)
    pub(crate) ss_count_plain: f64,
    /// Strings that need XML entity decoding only
    pub(crate) ss_count_entities: f64,
    /// Rich text strings (need <t> extraction + concatenation)
    pub(crate) ss_count_rich_text: f64,

    // --- Worksheet sub-phase breakdown (cumulative across all sheets) ---
    /// Sub-phase: ZIP decompression of worksheet XMLs (us)
    pub(crate) ws_zip_decompress_us: f64,
    /// Sub-phase: parse_worksheet_fast() core cell parsing (us)
    pub(crate) ws_cell_parse_us: f64,
    /// Sub-phase: CellData → FullCellData conversion (us)
    pub(crate) ws_cell_convert_us: f64,
    /// Sub-phase: postprocessing — shared formulas, cached values, data tables (us)
    pub(crate) ws_postprocess_us: f64,
    /// Sub-phase: auxiliary parsers — merges, CF, DV, hyperlinks, dimensions, etc. (us)
    pub(crate) ws_auxiliary_us: f64,
    /// Sub-phase: auxiliary ZIP I/O — comments + tables (requires ZIP reads) (us)
    pub(crate) ws_aux_zip_io_us: f64,

    // --- Auxiliary parser individual breakdown (cumulative across all sheets) ---
    /// Auxiliary: parse_merge_cells (us)
    pub(crate) ws_aux_merge_us: f64,
    /// Auxiliary: parse_conditional_formats (us)
    pub(crate) ws_aux_cond_fmt_us: f64,
    /// Auxiliary: parse_data_validations (us)
    pub(crate) ws_aux_data_val_us: f64,
    /// Auxiliary: hyperlinks parsing (us)
    pub(crate) ws_aux_hyperlinks_us: f64,
    /// Auxiliary: sheet protection parsing (us)
    pub(crate) ws_aux_protection_us: f64,
    /// Auxiliary: print settings parsing (us)
    pub(crate) ws_aux_print_us: f64,
    /// Auxiliary: frozen pane parsing (us)
    pub(crate) ws_aux_frozen_pane_us: f64,
    /// Auxiliary: dimensions — col widths + row heights (us)
    pub(crate) ws_aux_dimensions_us: f64,
    /// Auxiliary: sparklines parsing (us)
    pub(crate) ws_aux_sparklines_us: f64,

    // --- Aux ZIP I/O sub-phase breakdown (cumulative across all sheets) ---
    /// Aux ZIP: comments parsing (us)
    pub(crate) aux_zip_comments_us: f64,
    /// Aux ZIP: tables parsing (us)
    pub(crate) aux_zip_tables_us: f64,
    /// Aux ZIP: pivot tables parsing (us)
    pub(crate) aux_zip_pivots_us: f64,
    /// Aux ZIP: charts parsing (us)
    pub(crate) aux_zip_charts_us: f64,
    /// Aux ZIP: SmartArt parsing (us)
    pub(crate) aux_zip_smartart_us: f64,
    /// Aux ZIP: slicers parsing (us)
    pub(crate) aux_zip_slicers_us: f64,
    /// Aux ZIP: form controls parsing (us)
    pub(crate) aux_zip_form_controls_us: f64,
    /// Aux ZIP: OLE objects parsing (us)
    pub(crate) aux_zip_ole_us: f64,
    /// Aux ZIP: connectors parsing (us)
    pub(crate) aux_zip_connectors_us: f64,
    /// Aux ZIP: OPC rels + VML drawings (us)
    pub(crate) aux_zip_rels_vml_us: f64,
}

impl ParseTimings {
    /// Time spent parsing ZIP central directory index (us).
    /// Does NOT include actual DEFLATE decompression of entries.
    pub fn zip_index_us(&self) -> f64 {
        self.zip_index_us
    }

    /// Time spent on shared strings (us).
    /// Includes ZIP decompression of sharedStrings.xml + XML parsing.
    pub fn shared_strings_us(&self) -> f64 {
        self.shared_strings_us
    }

    /// Time spent on styles (us).
    /// Includes ZIP decompression of styles.xml + XML parsing.
    pub fn styles_us(&self) -> f64 {
        self.styles_us
    }

    /// Time spent on metadata: theme, workbook, defined names, and protection (us).
    /// Includes ZIP decompression of respective XML entries.
    pub fn metadata_us(&self) -> f64 {
        self.metadata_us
    }

    /// Total time spent parsing all worksheets (us).
    /// Includes ZIP decompression of each sheet's XML.
    pub fn worksheet_parse_us(&self) -> f64 {
        self.worksheet_parse_us
    }

    /// Time spent in serialization (us)
    pub fn serde_serialize_us(&self) -> f64 {
        self.serde_serialize_us
    }

    /// Total parse time including all phases (us)
    pub fn total_us(&self) -> f64 {
        self.total_us
    }

    // --- Shared strings sub-phase getters ---

    /// Sub-phase: ZIP decompression of sharedStrings.xml (us)
    pub fn ss_zip_us(&self) -> f64 {
        self.ss_zip_us
    }

    /// Sub-phase: offset parsing — SharedStrings::parse() (us)
    pub fn ss_parse_refs_us(&self) -> f64 {
        self.ss_parse_refs_us
    }

    /// Sub-phase: string materialization loop (us)
    pub fn ss_materialize_us(&self) -> f64 {
        self.ss_materialize_us
    }

    /// Uncompressed size of sharedStrings.xml in bytes
    pub fn ss_xml_bytes(&self) -> f64 {
        self.ss_xml_bytes
    }

    /// Total shared string count
    pub fn ss_count_total(&self) -> f64 {
        self.ss_count_total
    }

    /// Zero-copy plain strings count
    pub fn ss_count_plain(&self) -> f64 {
        self.ss_count_plain
    }

    /// Entity-decoded strings count
    pub fn ss_count_entities(&self) -> f64 {
        self.ss_count_entities
    }

    /// Rich text strings count
    pub fn ss_count_rich_text(&self) -> f64 {
        self.ss_count_rich_text
    }

    // --- Worksheet sub-phase getters ---

    /// Sub-phase: ZIP decompression of worksheet XMLs (us)
    pub fn ws_zip_decompress_us(&self) -> f64 {
        self.ws_zip_decompress_us
    }

    /// Sub-phase: parse_worksheet_fast() core cell parsing (us)
    pub fn ws_cell_parse_us(&self) -> f64 {
        self.ws_cell_parse_us
    }

    /// Sub-phase: CellData → FullCellData conversion (us)
    pub fn ws_cell_convert_us(&self) -> f64 {
        self.ws_cell_convert_us
    }

    /// Sub-phase: postprocessing — shared formulas, cached values, data tables (us)
    pub fn ws_postprocess_us(&self) -> f64 {
        self.ws_postprocess_us
    }

    /// Sub-phase: auxiliary parsers — merges, CF, DV, hyperlinks, dimensions, etc. (us)
    pub fn ws_auxiliary_us(&self) -> f64 {
        self.ws_auxiliary_us
    }

    /// Sub-phase: auxiliary ZIP I/O — comments + tables (us)
    pub fn ws_aux_zip_io_us(&self) -> f64 {
        self.ws_aux_zip_io_us
    }

    // --- Auxiliary parser individual getters ---

    pub fn ws_aux_merge_us(&self) -> f64 {
        self.ws_aux_merge_us
    }

    pub fn ws_aux_cond_fmt_us(&self) -> f64 {
        self.ws_aux_cond_fmt_us
    }

    pub fn ws_aux_data_val_us(&self) -> f64 {
        self.ws_aux_data_val_us
    }

    pub fn ws_aux_hyperlinks_us(&self) -> f64 {
        self.ws_aux_hyperlinks_us
    }

    pub fn ws_aux_protection_us(&self) -> f64 {
        self.ws_aux_protection_us
    }

    pub fn ws_aux_print_us(&self) -> f64 {
        self.ws_aux_print_us
    }

    pub fn ws_aux_frozen_pane_us(&self) -> f64 {
        self.ws_aux_frozen_pane_us
    }

    pub fn ws_aux_dimensions_us(&self) -> f64 {
        self.ws_aux_dimensions_us
    }

    pub fn ws_aux_sparklines_us(&self) -> f64 {
        self.ws_aux_sparklines_us
    }

    // --- Aux ZIP I/O sub-phase getters ---

    pub fn aux_zip_comments_us(&self) -> f64 {
        self.aux_zip_comments_us
    }
    pub fn aux_zip_tables_us(&self) -> f64 {
        self.aux_zip_tables_us
    }
    pub fn aux_zip_pivots_us(&self) -> f64 {
        self.aux_zip_pivots_us
    }
    pub fn aux_zip_charts_us(&self) -> f64 {
        self.aux_zip_charts_us
    }
    pub fn aux_zip_smartart_us(&self) -> f64 {
        self.aux_zip_smartart_us
    }
    pub fn aux_zip_slicers_us(&self) -> f64 {
        self.aux_zip_slicers_us
    }
    pub fn aux_zip_form_controls_us(&self) -> f64 {
        self.aux_zip_form_controls_us
    }
    pub fn aux_zip_ole_us(&self) -> f64 {
        self.aux_zip_ole_us
    }
    pub fn aux_zip_connectors_us(&self) -> f64 {
        self.aux_zip_connectors_us
    }
    pub fn aux_zip_rels_vml_us(&self) -> f64 {
        self.aux_zip_rels_vml_us
    }
}

impl ParseTimings {
    /// Create a new ParseTimings with all zeroes
    pub fn zero() -> Self {
        Self {
            zip_index_us: 0.0,
            shared_strings_us: 0.0,
            styles_us: 0.0,
            metadata_us: 0.0,
            worksheet_parse_us: 0.0,
            serde_serialize_us: 0.0,
            total_us: 0.0,
            ss_zip_us: 0.0,
            ss_parse_refs_us: 0.0,
            ss_materialize_us: 0.0,
            ss_xml_bytes: 0.0,
            ss_count_total: 0.0,
            ss_count_plain: 0.0,
            ss_count_entities: 0.0,
            ss_count_rich_text: 0.0,
            ws_zip_decompress_us: 0.0,
            ws_cell_parse_us: 0.0,
            ws_cell_convert_us: 0.0,
            ws_postprocess_us: 0.0,
            ws_auxiliary_us: 0.0,
            ws_aux_zip_io_us: 0.0,
            ws_aux_merge_us: 0.0,
            ws_aux_cond_fmt_us: 0.0,
            ws_aux_data_val_us: 0.0,
            ws_aux_hyperlinks_us: 0.0,
            ws_aux_protection_us: 0.0,
            ws_aux_print_us: 0.0,
            ws_aux_frozen_pane_us: 0.0,
            ws_aux_dimensions_us: 0.0,
            ws_aux_sparklines_us: 0.0,
            aux_zip_comments_us: 0.0,
            aux_zip_tables_us: 0.0,
            aux_zip_pivots_us: 0.0,
            aux_zip_charts_us: 0.0,
            aux_zip_smartart_us: 0.0,
            aux_zip_slicers_us: 0.0,
            aux_zip_form_controls_us: 0.0,
            aux_zip_ole_us: 0.0,
            aux_zip_connectors_us: 0.0,
            aux_zip_rels_vml_us: 0.0,
        }
    }

    /// Create a new ParseTimings with top-level phase values (sub-phases zeroed)
    pub fn new(
        zip_index_us: f64,
        shared_strings_us: f64,
        styles_us: f64,
        metadata_us: f64,
        worksheet_parse_us: f64,
        serde_serialize_us: f64,
        total_us: f64,
    ) -> Self {
        Self {
            zip_index_us,
            shared_strings_us,
            styles_us,
            metadata_us,
            worksheet_parse_us,
            serde_serialize_us,
            total_us,
            ss_zip_us: 0.0,
            ss_parse_refs_us: 0.0,
            ss_materialize_us: 0.0,
            ss_xml_bytes: 0.0,
            ss_count_total: 0.0,
            ss_count_plain: 0.0,
            ss_count_entities: 0.0,
            ss_count_rich_text: 0.0,
            ws_zip_decompress_us: 0.0,
            ws_cell_parse_us: 0.0,
            ws_cell_convert_us: 0.0,
            ws_postprocess_us: 0.0,
            ws_auxiliary_us: 0.0,
            ws_aux_zip_io_us: 0.0,
            ws_aux_merge_us: 0.0,
            ws_aux_cond_fmt_us: 0.0,
            ws_aux_data_val_us: 0.0,
            ws_aux_hyperlinks_us: 0.0,
            ws_aux_protection_us: 0.0,
            ws_aux_print_us: 0.0,
            ws_aux_frozen_pane_us: 0.0,
            ws_aux_dimensions_us: 0.0,
            ws_aux_sparklines_us: 0.0,
            aux_zip_comments_us: 0.0,
            aux_zip_tables_us: 0.0,
            aux_zip_pivots_us: 0.0,
            aux_zip_charts_us: 0.0,
            aux_zip_smartart_us: 0.0,
            aux_zip_slicers_us: 0.0,
            aux_zip_form_controls_us: 0.0,
            aux_zip_ole_us: 0.0,
            aux_zip_connectors_us: 0.0,
            aux_zip_rels_vml_us: 0.0,
        }
    }
}

// =============================================================================
// LazyParseResult
// =============================================================================
