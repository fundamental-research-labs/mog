use super::*;

pub type RawVmlDrawing = (String, Vec<u8>, Option<(String, Vec<u8>)>);

/// Imported binary package part used as an owner-scoped hydration input.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBinaryPart {
    /// Normalized ZIP package path, e.g. `xl/media/image1.png`.
    pub path: String,
    /// Source package content type when declared in `[Content_Types].xml`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// Verbatim package bytes.
    pub bytes: Vec<u8>,
}

/// Hyperlink output for parse result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HyperlinkOutput {
    #[serde(rename = "ref")]
    pub cell_ref: String,
    pub location: String,
    pub display: String,
    pub tooltip: String,
    /// Resolved target from a relationship-backed hyperlink when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Relationship ID for external hyperlinks (r:id), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r_id: Option<String>,
    /// Extension UID for revision tracking (xr:uid), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_kind: Option<domain_types::domain::hyperlink::HyperlinkTargetKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
}

/// Sheet protection output for parse result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionOutput {
    /// Legacy OOXML `password` hash.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// OOXML `algorithmName` for modern sheet protection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub algorithm_name: Option<String>,
    /// OOXML `hashValue` for modern sheet protection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash_value: Option<String>,
    /// OOXML `saltValue` for modern sheet protection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salt_value: Option<String>,
    /// OOXML `spinCount` for modern sheet protection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spin_count: Option<u32>,
    pub sheet: bool,
    pub objects: bool,
    pub scenarios: bool,
    pub format_cells: bool,
    pub format_columns: bool,
    pub format_rows: bool,
    pub insert_columns: bool,
    pub insert_rows: bool,
    pub insert_hyperlinks: bool,
    pub delete_columns: bool,
    pub delete_rows: bool,
    pub sort: bool,
    pub auto_filter: bool,
    pub pivot_tables: bool,
    pub select_locked_cells: bool,
    pub select_unlocked_cells: bool,
}

/// Sparkline summary for parse output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineSummary {
    #[serde(rename = "type")]
    pub sparkline_type: String,
    pub sparklines_count: usize,
}

/// Defined name output for parse result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinedNameOutput {
    pub name: String,
    pub refers_to: String,
    pub local_sheet_id: Option<u32>,
    pub hidden: bool,
    /// Comment/description for the name (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Description text (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Help topic text (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    /// Status bar text (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_bar: Option<String>,
    /// Custom menu text (optional, for XLM macros)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_menu: Option<String>,
    /// Whether this name is a function (XLM macro function)
    #[serde(skip_serializing_if = "is_false")]
    pub function: bool,
    /// Whether this is a VBA procedure name
    #[serde(skip_serializing_if = "is_false")]
    pub vb_procedure: bool,
    /// Whether this is an XLM macro
    #[serde(skip_serializing_if = "is_false")]
    pub xlm: bool,
    /// Function group ID for macro/function names
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_group_id: Option<u32>,
    /// Shortcut key for macro/function names
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcut_key: Option<String>,
    /// Whether to publish this name to the server (SharePoint)
    #[serde(skip_serializing_if = "is_false")]
    pub publish_to_server: bool,
    /// Whether this name is a workbook parameter (for web queries)
    #[serde(skip_serializing_if = "is_false")]
    pub workbook_parameter: bool,
    /// Whether xml:space="preserve" should be emitted
    #[serde(skip_serializing_if = "is_false")]
    pub xml_space_preserve: bool,
}

/// Raw XML parts for a single SmartArt diagram, serialized for TypeScript.
///
/// Each field contains the raw XML content of the corresponding diagram part.
/// The TypeScript side will parse these XML blobs to build the SmartArt rendering model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartArtPartsOutput {
    /// Index of the graphicFrame anchor in the drawing (for position correlation)
    pub anchor_index: usize,
    /// `xl/diagrams/data{N}.xml` — `<dgm:dataModel>` (node tree, text, connections)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_xml: Option<String>,
    /// `xl/diagrams/layout{N}.xml` — `<dgm:layoutDef>` (layout algorithm definition)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_xml: Option<String>,
    /// `xl/diagrams/colors{N}.xml` — `<dgm:colorsDef>` (color transform)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colors_xml: Option<String>,
    /// `xl/diagrams/quickStyles{N}.xml` — `<dgm:styleDef>` (style definition)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_xml: Option<String>,
    /// `xl/diagrams/drawing{N}.xml` — `<dsp:drawing>` (pre-rendered drawing cache, MS extension)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drawing_xml: Option<String>,
}

// FullParsedSheet
// =============================================================================

/// A fully parsed sheet with all features
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullParsedSheet {
    /// Sheet name
    pub name: String,
    /// 0-based sheet index
    pub index: usize,
    /// Actual worksheet package part path that owns this sheet, for resolving
    /// sheet-scoped relationships without assuming workbook order matches
    /// `xl/worksheets/sheetN.xml`.
    #[serde(skip)]
    pub owner_part_path: Option<String>,
    /// Original sheetId from workbook.xml (preserved for round-trip fidelity).
    #[serde(skip)]
    pub sheet_id: Option<u32>,
    /// Sheet visibility state from workbook.xml (preserved for round-trip fidelity).
    #[serde(skip)]
    pub state: crate::domain::workbook::types::SheetState,
    /// All cells in the sheet
    pub cells: Vec<FullCellData>,
    /// Compact authored blank cells with explicit `s` attributes.
    #[serde(skip)]
    pub authored_style_runs: Vec<domain_types::AuthoredStyleRun>,
    /// 0-based coordinates of explicit style-less blank `<c/>` nodes skipped by semantic parsing.
    /// Kept for round-trip fidelity without allocating empty compute cells.
    #[serde(skip)]
    pub explicit_blank_cells: Vec<(u32, u32)>,
    /// Merge ranges
    pub merges: Vec<MergeRange>,
    /// Conditional formatting rules (summary for JSON/WASM output)
    pub conditional_formats: Vec<CfSummary>,
    /// Full conditional formatting data for domain conversion (not serialized to JSON/WASM).
    /// Contains complete rule definitions (color scales, data bars, icon sets, cell-is conditions, etc.).
    #[serde(skip)]
    pub conditional_formatting_full: Vec<ooxml_types::cond_format::ConditionalFormatting>,
    /// Data validations
    pub data_validations: Vec<DvSummary>,
    /// Declared count attribute on the `<dataValidations>` container.
    #[serde(skip)]
    pub data_validations_declared_count: Option<u32>,
    /// Whether the `<dataValidations>` container had `disablePrompts="1"`.
    #[serde(skip)]
    pub data_validations_disable_prompts: bool,
    /// X window position for the data validation prompt dialog.
    #[serde(skip)]
    pub data_validations_x_window: Option<u32>,
    /// Y window position for the data validation prompt dialog.
    #[serde(skip)]
    pub data_validations_y_window: Option<u32>,
    /// Data validations from the worksheet x14 extension list.
    #[serde(skip)]
    pub x14_data_validations: Vec<DvSummary>,
    /// Declared count attribute on the `<x14:dataValidations>` container.
    #[serde(skip)]
    pub x14_data_validations_declared_count: Option<u32>,
    /// Whether the `<x14:dataValidations>` container had `disablePrompts="1"`.
    #[serde(skip)]
    pub x14_data_validations_disable_prompts: bool,
    /// X window position for the x14 data validation prompt dialog.
    #[serde(skip)]
    pub x14_data_validations_x_window: Option<u32>,
    /// Y window position for the x14 data validation prompt dialog.
    #[serde(skip)]
    pub x14_data_validations_y_window: Option<u32>,
    /// Tables (structured objects matching TypeScript Table interface)
    pub tables: Vec<ParsedTable>,
    /// Parsed pivot tables with compute-ready config + OOXML sidecar.
    #[serde(skip)]
    pub parsed_pivot_configs: Vec<domain_types::domain::pivot::ParsedPivotTable>,
    /// Data table regions in this sheet
    pub data_tables: Vec<DataTableInfo>,
    /// Sparkline groups (summary for JSON/WASM output)
    pub sparklines: Vec<SparklineSummary>,
    /// Full sparkline group data for domain conversion (not serialized to JSON/WASM).
    #[serde(skip)]
    pub sparkline_groups: Vec<ooxml_types::sparklines::SparklineGroup>,
    /// Comments
    pub comments: Vec<CommentOutput>,
    /// Comment author names (indexed by CommentOutput::author_id)
    pub comment_authors: Vec<String>,
    /// Original root element namespace declarations from the comments XML file.
    /// Preserved for round-trip fidelity (xmlns:mc, mc:Ignorable, xmlns:xr, etc.).
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub comments_root_namespace_attrs: Vec<(String, String)>,
    /// Safe root-level `<extLst>` from comments XML.
    #[serde(skip)]
    pub comments_ext_lst_xml: Option<String>,
    /// Hyperlinks
    pub hyperlinks: Vec<HyperlinkOutput>,
    /// Sheet protection settings
    pub protection: Option<ProtectionOutput>,
    /// Typed worksheet semantic containers that are not runtime-decomposed yet.
    #[serde(skip)]
    pub worksheet_semantic_containers: domain_types::WorksheetSemanticContainers,
    /// Authored worksheet `<dimension ref>` value.
    #[serde(skip)]
    pub worksheet_dimension_ref: Option<String>,
    /// Typed worksheet calculation properties.
    #[serde(skip)]
    pub sheet_calc_pr: Option<ooxml_types::worksheet::SheetCalcPr>,
    /// Print settings (structured output)
    pub print_settings: Option<PrintSettingsOutput>,
    /// Raw `<headerFooter>...</headerFooter>` XML for verbatim round-trip passthrough.
    #[serde(skip)]
    pub header_footer_xml: Option<String>,
    /// Page breaks
    pub page_breaks: Option<PageBreaksOutput>,
    pub default_row_height: Option<f64>,
    pub default_col_width: Option<f64>,
    /// Base column width (baseColWidth on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_col_width: Option<u32>,
    /// Default row descent (x14ac:dyDescent on sheetFormatPr) — text baseline offset in points.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_row_descent: Option<f64>,
    /// Outline level for rows (outlineLevelRow on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_level_row: Option<u8>,
    /// Outline level for columns (outlineLevelCol on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_level_col: Option<u8>,
    /// Whether the default row height is custom (customHeight on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "is_false")]
    pub custom_height: bool,
    /// Whether zero-height rows are the default (zeroHeight on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "is_false")]
    pub zero_height: bool,
    /// Whether default rows use thick top borders (thickTop on sheetFormatPr).
    #[serde(skip_serializing_if = "is_false")]
    pub thick_top: bool,
    /// Whether default rows use thick bottom borders (thickBottom on sheetFormatPr).
    #[serde(skip_serializing_if = "is_false")]
    pub thick_bottom: bool,
    /// Stable sheet identity for co-authoring (xr:uid on <worksheet> root).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    /// Per-row descent values (x14ac:dyDescent on <row>) — all original values preserved.
    /// Write-only roundtrip data, not serialized to TypeScript.
    #[serde(skip)]
    pub row_descents: HashMap<u32, f64>,
    /// Per-row spans attribute values — preserved from the original XML for roundtrip fidelity.
    /// Write-only roundtrip data, not serialized to TypeScript.
    #[serde(skip)]
    pub row_spans: HashMap<u32, String>,
    /// 0-based row indices for bare empty rows (`<row r="N"/>` with no attributes or cells).
    /// Write-only roundtrip data, not serialized to TypeScript.
    #[serde(skip)]
    pub bare_empty_rows: Vec<u32>,
    /// Column widths
    pub col_widths: Vec<ColWidth>,
    /// Row heights
    pub row_heights: Vec<RowHeight>,
    /// Frozen pane settings
    pub frozen_pane: Option<SheetPane>,
    /// Sheet view options (gridlines, headers visibility).
    /// Multiple `<sheetView>` elements are preserved for round-trip fidelity.
    pub view_options: Vec<SheetViewOutput>,
    /// Direct-child `<extLst>` XML under `<sheetViews>`.
    #[serde(skip)]
    pub sheet_views_ext_lst_xml: Option<String>,
    /// Worksheet properties from `<sheetPr>`.
    #[serde(skip)]
    pub sheet_properties: Option<ooxml_types::worksheet::SheetProperties>,
    /// Outline properties from `<sheetPr><outlinePr>`.
    #[serde(skip)]
    pub outline_properties: Option<ooxml_types::worksheet::OutlineProperties>,
    /// Charts embedded in this sheet
    pub charts: Vec<domain_types::ChartSpec>,
    /// SmartArt diagrams embedded in this sheet (raw XML parts for TS-side rendering)
    pub smartart_diagrams: Vec<SmartArtPartsOutput>,
    /// Slicer definitions parsed from this sheet's slicer parts
    pub slicers: Vec<ooxml_types::slicers::SlicerDef>,
    /// Slicer anchors (positions in the drawing layer) for this sheet
    pub slicer_anchors: Vec<ooxml_types::slicers::SlicerAnchor>,
    /// Timeline definitions parsed from this sheet's timeline parts.
    pub timelines: Vec<ooxml_types::timelines::TimelineDef>,
    /// Timeline anchors (positions in the drawing layer) for this sheet.
    pub timeline_anchors: Vec<ooxml_types::timelines::TimelineAnchor>,
    /// Form controls (checkboxes, dropdowns, buttons, scroll bars, etc.)
    pub form_controls: Vec<FormControlOutput>,
    /// Raw worksheet-level controls XML for verbatim round-trip passthrough.
    ///
    /// This is usually an `mc:AlternateContent` block containing `<controls>`.
    /// It is intentionally separate from parsed `form_controls`, which are the
    /// editable semantic representation.
    #[serde(skip)]
    pub worksheet_controls_xml: Option<String>,
    /// OLE embedded objects
    pub ole_objects: Vec<OleObjectOutput>,
    /// Connector lines between shapes
    pub connectors: Vec<ConnectorOutput>,
    /// Raw `<extLst>...</extLst>` XML from the worksheet for round-trip passthrough.
    /// Captures extension elements (x14:dataValidations, x14:conditionalFormattings, etc.)
    /// that live inside `<extLst>` in the post-sheetData region.
    #[serde(skip)]
    pub ext_lst_xml: Option<String>,
    /// Original OPC relationships from `xl/worksheets/_rels/sheetN.xml.rels`, preserved for
    /// round-trip fidelity. When present, the writer replays these instead of regenerating them.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub sheet_opc_rels: Vec<ooxml_types::shared::OpcRelationship>,
    /// Raw table XML bytes for round-trip passthrough.
    ///
    /// Each entry is `(zip_path, raw_xml_bytes)`, e.g.,
    /// `("xl/tables/table1.xml", <bytes>)`.  Populated during parse from the
    /// source archive; replayed verbatim into the output ZIP during write.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub table_xml_passthroughs: Vec<(String, Vec<u8>)>,
    /// Worksheet-level `<autoFilter>` element, parsed into typed form.
    ///
    /// Typed OOXML preservation: replaced the prior raw-XML passthrough
    /// (`auto_filter_xml: Option<String>`) with a typed
    /// [`domain_types::AutoFilter`] covering the closed CT_AutoFilter XSD
    /// losslessly. Written after `</sheetData>` and before `<mergeCells>`.
    #[serde(skip)]
    pub auto_filter: Option<domain_types::AutoFilter>,
    /// Standalone worksheet-level `<sortState>` element, parsed into typed form.
    ///
    /// Typed OOXML preservation: replaced the prior raw-XML passthrough
    /// (`sort_state_xml: Option<String>`) so sort state survives the parse →
    /// domain → write path losslessly even when no raw blob is present.
    #[serde(skip)]
    pub sort_state: Option<domain_types::SortState>,
    /// Raw `<customProperties>` XML for verbatim round-trip passthrough.
    ///
    /// Stores the complete `<customProperties>...</customProperties>` element
    /// from the original worksheet XML. These are worksheet-level custom property
    /// references (with r:id links to binary parts).
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub custom_properties_xml: Option<String>,
    /// Raw VML drawing files for verbatim round-trip passthrough.
    ///
    /// Populated during parse from the source archive.  A sheet can have
    /// multiple VML drawings — one for comment shapes and another for
    /// embedded images referenced by those comments.  Each entry stores
    /// the ZIP path, raw bytes, and an optional `.rels` file.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub raw_vml_drawings: Vec<RawVmlDrawing>,
    /// Relationship ID of the `<legacyDrawing r:id="..."/>` element in the sheet XML.
    /// Points to the VML drawing part that contains comment shapes, form controls, etc.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub legacy_drawing_r_id: Option<String>,
    /// Relationship ID of the `<legacyDrawingHF r:id="..."/>` element in the sheet XML.
    /// Points to the VML drawing part that contains header/footer images.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub legacy_drawing_hf_r_id: Option<String>,
    /// Rich parsed drawing with all anchored objects (pictures, shapes, charts, connectors, etc.).
    /// Used by the structured write path to regenerate `xl/drawings/drawingN.xml` from domain types.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub parsed_drawing: Option<crate::domain::drawings::Drawing>,
    /// Rich parsed chart data for each chart embedded in this sheet.
    /// Used by the structured write path to regenerate `xl/charts/chartN.xml` via
    /// `Chart::to_chart_writer()`. Ordered to match chart GraphicFrame anchors in `parsed_drawing`.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub parsed_charts: Vec<crate::domain::charts::Chart>,
    /// Parsed ChartEx parts (modern chart types: Waterfall, Treemap, etc.).
    /// Each entry holds the structured ChartExSpace plus auxiliary files for round-trip.
    /// Not serialized to TypeScript -- internal round-trip data only.
    #[serde(skip)]
    pub parsed_chart_ex: Vec<ParsedChartEx>,
}

/// A parsed ChartEx part with its auxiliary files.
#[derive(Debug, Clone)]
pub struct ParsedChartEx {
    /// The parsed ChartEx model.
    pub chart_space: ooxml_types::chart_ex::ChartExSpace,
    /// Original ZIP entry name (e.g., "xl/charts/chartEx1.xml").
    pub original_path: String,
    /// Original chartEx XML bytes for unmodified opaque preservation.
    pub original_xml: Vec<u8>,
    /// Raw bytes of the .rels file for this chartEx part.
    pub chart_rels_bytes: Option<(String, Vec<u8>)>,
    /// Auxiliary files referenced by the chartEx .rels (style, colors).
    pub auxiliary_files: Vec<(String, Vec<u8>)>,
}

/// Connector output for the import pipeline.
///
/// Extracted from `<cxnSp>` elements within drawing anchors.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorOutput {
    /// Display name (from cNvPr/@name).
    pub name: Option<String>,
    /// Start connection (shape ID + site index).
    pub start_connection: Option<ConnectorEndpointOutput>,
    /// End connection (shape ID + site index).
    pub end_connection: Option<ConnectorEndpointOutput>,
    /// Preset geometry type (e.g., "line", "bentConnector3").
    pub preset_geometry: Option<String>,
    /// Anchor row (0-based).
    pub anchor_row: Option<u32>,
    /// Anchor column (0-based).
    pub anchor_col: Option<u32>,
    /// Anchor row offset in EMU.
    pub anchor_row_offset: i64,
    /// Anchor column offset in EMU.
    pub anchor_col_offset: i64,
    /// End anchor row (for two-cell anchors).
    pub end_row: Option<u32>,
    /// End anchor column (for two-cell anchors).
    pub end_col: Option<u32>,
    /// End anchor row offset in EMU (for two-cell anchors).
    pub end_row_offset: Option<i64>,
    /// End anchor column offset in EMU (for two-cell anchors).
    pub end_col_offset: Option<i64>,
    /// Width in EMU.
    pub width: Option<i64>,
    /// Height in EMU.
    pub height: Option<i64>,
    /// Full connector data as JSON for roundtrip fidelity.
    pub raw_json: Option<String>,
}

/// Connector endpoint referencing a shape and connection site.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorEndpointOutput {
    /// Target shape ID.
    pub shape_id: u32,
    /// Connection site index.
    pub idx: u32,
}

/// Data table region metadata extracted from `<f t="dataTable">` elements.
///
/// Propagated through to the snapshot for TABLE formula evaluation.
///
/// Typed data-table input refs: input refs are typed `Option<CellRef>` end-to-end (parser
/// → lowering → snapshot) so the lowering step is stateless. The
/// `r1 -> col` / `r2 -> row` swap (Excel's inverted naming) happens at the
/// parser → domain boundary in `convert_data_tables`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableInfo {
    /// 0-based start row of the data table region.
    pub start_row: u32,
    /// 0-based start column of the data table region.
    pub start_col: u32,
    /// 0-based end row (inclusive) of the data table region.
    pub end_row: u32,
    /// 0-based end column (inclusive) of the data table region.
    pub end_col: u32,
    /// Typed reference from the r1 attribute (single cell, sheet-local).
    /// `None` for a missing or `#REF!` r1 attribute.
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
    /// OOXML formula flags preserved from `<f t="dataTable">`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_flags: Option<domain_types::DataTableOoxmlFlags>,
}

// =============================================================================
// FullParseResult
// =============================================================================

/// Complete parsed workbook result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullParseResult {
    /// All parsed sheets
    pub sheets: Vec<FullParsedSheet>,
    /// Shared strings table (plain text, concatenated for rich text entries).
    pub shared_strings: Vec<String>,
    /// Rich text runs for SST entries that have formatting.
    /// Index-aligned with `shared_strings`. `None` = plain text, `Some` = rich text runs.
    #[serde(skip)]
    pub shared_strings_rich_runs: Vec<Option<Vec<domain_types::RichTextRun>>>,
    /// Raw phonetic XML (`<rPh>...</rPh>` + `<phoneticPr .../>`) per SST entry.
    /// Index-aligned with `shared_strings`. `None` = no phonetic data.
    #[serde(skip)]
    pub shared_strings_phonetic_xml: Vec<Option<Vec<u8>>>,
    /// Imported `<sst count="...">` value from `xl/sharedStrings.xml`, when present.
    #[serde(skip)]
    pub shared_strings_declared_count: Option<u32>,
    /// Imported `<sst uniqueCount="...">` value from `xl/sharedStrings.xml`, when present.
    #[serde(skip)]
    pub shared_strings_declared_unique_count: Option<u32>,
    /// Safe root-level `<extLst>` XML from `xl/sharedStrings.xml`.
    #[serde(skip)]
    pub shared_strings_ext_lst_xml: Option<Vec<u8>>,
    /// Parsed styles (structured camelCase output)
    pub styles: StylesOutput,
    /// Theme (as JSON string for flexibility)
    pub theme: Option<String>,
    /// Defined names
    #[serde(default)]
    pub defined_names: Vec<DefinedNameOutput>,
    /// Workbook protection
    pub workbook_protection: Option<domain_types::WorkbookProtection>,
    /// Parse errors
    #[serde(default)]
    pub errors: Vec<FullParseError>,
    /// Parse statistics
    #[serde(default)]
    pub stats: ParseStats,
    /// The calcId from `<calcPr calcId="..."/>` — identifies the calculation engine version.
    /// Preserved for round-trip fidelity so the output file matches the original.
    #[serde(skip)]
    pub calc_id: Option<u32>,
    /// Whether iterative calculation is enabled (from `<calcPr iterate="1"/>`)
    pub iterative_calc: bool,
    /// Maximum iterations for iterative calculation (from `<calcPr iterateCount="..."/>`)
    pub max_iterations: Option<u32>,
    /// Maximum change threshold for convergence (from `<calcPr iterateDelta="..."/>`)
    pub max_change: Option<f64>,
    /// Full calculation settings from `<calcPr>` for round-trip fidelity.
    /// Contains all CT_CalcPr attributes (calcOnSave, concurrentCalc, etc.).
    #[serde(skip)]
    pub calc_pr_settings: Option<crate::domain::workbook::types::CalcSettings>,
    /// Number of entries found in imported `xl/calcChain.xml`.
    ///
    /// Calc chains are Excel engine caches, not workbook semantics. Mog never
    /// replays imported calcChain data into `ParseOutput` or XLSX export; this
    /// count exists only so import diagnostics can explain the intentional drop.
    #[serde(skip)]
    pub imported_calc_chain_entry_count: usize,
    /// Full pivot cache definitions for structured round-trip writing.
    /// Keyed by cache_id. Contains source, fields, shared items — everything
    /// needed to reconstruct pivotCacheDefinition XML.
    /// Not serialized to TypeScript/WASM (internal round-trip data only).
    #[serde(skip)]
    pub pivot_caches: std::collections::HashMap<u32, crate::domain::pivot::types::ParsedPivotCache>,
    /// Pivot-owned imported cache package facts for writer-only no-edit
    /// preservation. Not serialized to TypeScript/WASM.
    #[serde(skip)]
    pub pivot_cache_packages: Vec<domain_types::PivotCachePackageFidelity>,
    /// Slicer cache definitions (workbook-level, shared across sheets)
    pub slicer_caches: Vec<ooxml_types::slicers::SlicerCacheDef>,
    /// Timeline cache definitions (workbook-level, shared across sheets)
    pub timeline_caches: Vec<ooxml_types::timelines::TimelineCacheDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_part_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_relationship_id_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_relationship_type: Option<String>,
    /// Parsed theme name (e.g., "Office Theme")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_name: Option<String>,
    /// Parsed theme color scheme (preserves DrawingColor variants for faithful roundtrip)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_color_scheme: Option<ooxml_types::themes::ColorScheme>,
    /// Parsed theme font scheme (preserves font definitions with panose, script fonts, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_font_scheme: Option<ooxml_types::themes::FontScheme>,
    /// Parsed theme format scheme (fill, line, and effect styles for round-trip fidelity)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_format_scheme: Option<ooxml_types::themes::FormatScheme>,
    /// Raw XML content inside <a:objectDefaults>...</a:objectDefaults> for round-trip fidelity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_object_defaults_xml: Option<Vec<u8>>,
    /// Raw XML content inside <a:extraClrSchemeLst>...</a:extraClrSchemeLst> for round-trip fidelity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_extra_clr_scheme_lst_xml: Option<Vec<u8>>,
    /// Raw XML of <a:extLst>...</a:extLst> (full element) for round-trip fidelity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_ext_lst_xml: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_cust_clr_lst_xml: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_root_sibling_order: Option<Vec<String>>,
    /// Raw XML of <extLst>...</extLst> from xl/styles.xml for round-trip fidelity
    #[serde(skip)]
    pub styles_ext_lst_xml: Option<Vec<u8>>,
    /// Namespace declarations from the `<styleSheet>` root element, owned by
    /// the parsed stylesheet contract instead of generic extension context.
    #[serde(skip)]
    pub styles_root_namespace_attrs: Vec<(String, String)>,
    /// Full parsed OOXML stylesheet for lossless style round-tripping.
    /// Preserves theme/indexed color references, cellStyleXfs, dxfs, etc.
    #[serde(skip)]
    pub parsed_stylesheet: Option<crate::domain::styles::types::Stylesheet>,
    /// Core document properties (docProps/core.xml)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_props_core: Option<DocPropsCore>,
    /// Extended document properties (docProps/app.xml)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_props_app: Option<DocPropsApp>,
    /// Custom document properties (docProps/custom.xml)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_props_custom: Option<DocPropsCustom>,
    /// Raw bytes of `docProps/core.xml` for verbatim round-trip passthrough.
    /// Avoids element reordering and formatting differences.
    #[serde(skip)]
    pub raw_doc_props_core_xml: Option<Vec<u8>>,
    /// Raw bytes of `docProps/app.xml` for verbatim round-trip passthrough.
    /// Avoids element reordering and loss of uncommon properties (e.g., Pages, Words).
    #[serde(skip)]
    pub raw_doc_props_app_xml: Option<Vec<u8>>,
    /// Raw bytes of `docProps/custom.xml` for verbatim round-trip passthrough.
    #[serde(skip)]
    pub raw_doc_props_custom_xml: Option<Vec<u8>>,
    /// Metadata from `xl/metadata.xml` (cell metadata for dynamic arrays, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<MetadataOutput>,
    /// Typed richData package parts referenced by value metadata (`vm`) cells.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rich_data: Option<domain_types::WorkbookRichData>,
    /// Original content type default mappings from `[Content_Types].xml`.
    /// Preserves the exact extension-to-MIME mappings (e.g., `"jpg" -> "image/jpg"`)
    /// from the source file so that round-trip writing maintains fidelity.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content_type_defaults: Vec<(String, String)>,
    /// Original content type override mappings from `[Content_Types].xml`.
    /// Preserves the exact part-name-to-MIME mappings in their original order
    /// from the source file so that round-trip writing maintains fidelity.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content_type_overrides: Vec<(String, String)>,
    /// Complete import-time OPC package inventory used to project durable,
    /// policy-filtered package fidelity into ParseOutput.
    #[serde(skip)]
    pub package_inventory: Option<crate::infra::opc_inventory::OpcPackageInventory>,
    /// Original OPC relationships from `_rels/.rels`, preserved for round-trip fidelity.
    /// When present, the writer replays these instead of regenerating relationship IDs.
    #[serde(skip)]
    pub root_relationships: Vec<ooxml_types::shared::OpcRelationship>,
    /// Original OPC relationships from `xl/_rels/workbook.xml.rels`, preserved for round-trip fidelity.
    #[serde(skip)]
    pub workbook_relationships: Vec<ooxml_types::shared::OpcRelationship>,
    /// Original workbook-level relationship IDs per sheet, in document order.
    /// Extracted from `<sheet r:id="rIdN"/>` in workbook.xml.
    #[serde(skip)]
    pub sheet_workbook_r_ids: Vec<String>,
    /// Workbook-order sheet/package inventory resolved from workbook.xml,
    /// workbook relationships, content types, and package membership before
    /// worksheet parsing.
    #[serde(skip)]
    pub workbook_sheet_inventory: Vec<domain_types::WorkbookSheetPackageInfo>,
    /// Imported `xl/media/*` bytes used only to hydrate current picture and
    /// OLE-preview owners before parser state is dropped.
    #[serde(skip)]
    pub imported_media_parts: Vec<ImportedBinaryPart>,
    /// Imported `xl/embeddings/*` bytes used only to hydrate current OLE owners
    /// before parser state is dropped.
    #[serde(skip)]
    pub imported_ole_parts: Vec<ImportedBinaryPart>,
    /// Tier 2 extension preservation: captured namespace declarations, unknown elements,
    /// and binary passthrough entries for round-trip fidelity. Internal only — not sent to TypeScript.
    #[serde(skip)]
    pub extensions: Option<crate::pipeline::import_extensions::ImportExtensionParts>,
    /// Raw bytes of `xl/metadata.xml` for verbatim round-trip passthrough.
    /// Avoids namespace rewriting issues (e.g., `xda` vs `xlrd`).
    #[serde(skip)]
    pub raw_metadata_xml: Option<Vec<u8>>,
    /// Raw bytes of `docMetadata/LabelInfo.xml` for inert package-part export.
    /// This part has no semantic model, so export may emit it only through inert package policy.
    #[serde(skip)]
    pub raw_doc_metadata_label_info: Option<Vec<u8>>,
    /// Parsed external link definitions for domain-based round-tripping.
    #[serde(skip)]
    pub external_links: Vec<domain_types::domain::external_link::ExternalLink>,
    /// Parsed workbook data connections from `xl/connections.xml`.
    #[serde(skip)]
    pub connections: domain_types::domain::connections::WorkbookConnectionSet,
    /// Typed workbook feature-property bags from `xl/featurePropertyBag/*`.
    #[serde(skip)]
    pub feature_properties: domain_types::WorkbookFeatureProperties,
    /// Raw `customXml/` parts for verbatim round-trip passthrough.
    /// Stores all `customXml/item*.xml`, `customXml/itemProps*.xml`, and
    /// `customXml/_rels/item*.xml.rels` entries keyed by their ZIP path.
    #[serde(skip)]
    pub custom_xml_parts: Vec<(String, Vec<u8>)>,
    /// Raw bytes of `xl/persons/person.xml` for verbatim round-trip passthrough.
    /// This file stores person metadata for threaded comments (modern comments).
    #[serde(skip)]
    pub raw_persons_xml: Option<Vec<u8>>,
    /// Raw `xl/threadedComments/threadedComment*.xml` parts for verbatim round-trip passthrough.
    /// These are the companion files to person.xml for modern threaded comments.
    #[serde(skip)]
    pub raw_threaded_comments: Vec<(String, Vec<u8>)>,
    /// Parsed workbook views (window position/size/active tab) for round-trip fidelity.
    /// Multiple `<workbookView>` elements are preserved.
    #[serde(skip)]
    pub workbook_views: Vec<ooxml_types::workbook::BookView>,
    /// Raw workbook-level `<customWorkbookViews>` XML.
    #[serde(skip)]
    pub custom_workbook_views_xml: Option<Vec<u8>>,
    /// Workbook direct-child slot/payload fidelity captured from `xl/workbook.xml`.
    #[serde(skip)]
    pub workbook_xml_fidelity: domain_types::WorkbookXmlFidelity,
    /// Parsed workbook properties from `<workbookPr>` for domain output.
    #[serde(skip)]
    pub workbook_properties: Option<domain_types::domain::workbook::WorkbookProperties>,
    /// Parsed file version from `<fileVersion>` for domain output.
    #[serde(skip)]
    pub file_version: Option<domain_types::domain::workbook::FileVersion>,
    /// Parsed file sharing settings from `<fileSharing>` for domain output.
    #[serde(skip)]
    pub file_sharing: Option<domain_types::domain::workbook::FileSharing>,
    /// Parsed workbook web publishing settings from `<webPublishing>`.
    #[serde(skip)]
    pub web_publishing: Option<domain_types::domain::workbook::WorkbookWebPublishing>,
    /// Parsed workbook root `conformance` attribute.
    #[serde(skip)]
    pub workbook_conformance: Option<String>,
    /// Workbook-level schema-known containers with no production ParseOutput owner.
    #[serde(skip)]
    pub unsupported_workbook_elements: Vec<String>,
    /// Workbook-level MCE constructs that are not production-processed.
    #[serde(skip)]
    pub unsupported_workbook_mce: Vec<String>,
    /// Valid workbook-owned volatile dependency part captured for safe passive export.
    #[serde(skip)]
    pub volatile_dependency_part: Option<domain_types::VolatileDependencyPackagePart>,
}
