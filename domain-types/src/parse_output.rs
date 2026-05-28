use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::domain::floating_object::FloatingObject;
use crate::domain::pivot::ParsedPivotTable;
use crate::domain::*;
use crate::format::DocumentFormat;
use crate::metadata::WorkbookMetadata;
use crate::properties::DocumentProperties;
use ooxml_types::slicers::{
    SlicerAnchor as OoxmlSlicerAnchor, SlicerCacheDef as OoxmlSlicerCacheDef,
    SlicerDef as OoxmlSlicerDef,
};
use ooxml_types::workbook::SheetState;
use value_types::CellValue;

/// Position-keyed parse output — the shared container for parser → writer data flow.
/// No UUIDs, no identity formulas — those are allocated by the hydration layer.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseOutput {
    pub sheets: Vec<SheetData>,
    pub style_palette: Vec<DocumentFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_stylesheet: Option<WorkbookStylesheet>,
    /// Typed import hints for shared-string entries that cannot be regenerated
    /// from plain cell text alone, such as rich text and phonetic metadata.
    ///
    /// This is deliberately sparse: canonical plain strings are generated from
    /// current modeled cells during export and do not need a workbook-level
    /// copy of the original SST.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_string_hints: Vec<SharedStringHint>,
    pub named_ranges: Vec<NamedRange>,
    pub pivot_tables: Vec<ParsedPivotTable>,
    /// Pivot cache record data for eval-only use (cache_id → rows of cell values).
    /// Not consumed by the snapshot/hydration path. Populated from the OOXML
    /// pivot cache records so formula-eval can feed compute-pivot with the same
    /// source data Excel used to produce the cached pivot output.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub pivot_cache_records: std::collections::HashMap<u32, Vec<Vec<CellValue>>>,
    pub data_table_regions: Vec<DataTableRegion>,
    pub slicer_caches: Vec<OoxmlSlicerCacheDef>,
    /// Workbook-level table style definitions from `xl/styles.xml`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_table_styles: Vec<ooxml_types::styles::TableStyleDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_table_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_pivot_style: Option<String>,
    pub theme: Option<ThemeData>,
    pub properties: Option<DocumentProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extended_properties: Option<crate::properties::ExtendedDocumentProperties>,
    pub protection: Option<WorkbookProtection>,
    pub calculation: CalculationProperties,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<WorkbookMetadata>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_views: Vec<WorkbookView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_properties: Option<WorkbookProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_version: Option<FileVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_sharing: Option<FileSharing>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_publishing: Option<WorkbookWebPublishing>,
    /// Workbook external-link definitions that should be emitted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub external_links: Vec<ExternalLink>,
    /// Person identity list for threaded comments.
    /// Referenced by `Comment.person_id` across all sheets.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub persons: Vec<PersonInfo>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookStylesheet {
    /// Legacy in-memory scaffold for tests/migration callers that still build a
    /// whole OOXML stylesheet. Production parser/Yrs/export paths lower into
    /// the explicit registries below instead of serializing this blob.
    #[serde(default, skip)]
    pub stylesheet: ooxml_types::styles::Stylesheet,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub number_formats: Vec<ooxml_types::styles::NumberFormatDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fonts: Vec<ooxml_types::styles::FontDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fills: Vec<ooxml_types::styles::FillDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub borders: Vec<ooxml_types::styles::BorderDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cell_style_xfs: Vec<ooxml_types::styles::CellXfDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cell_xfs: Vec<ooxml_types::styles::CellXfDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub named_cell_styles: Vec<ooxml_types::styles::CellStyleDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub differential_formats: Vec<ooxml_types::styles::DxfDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub table_styles: Vec<ooxml_types::styles::TableStyleDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexed_colors: Option<ooxml_types::styles::ColorsDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_table_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_pivot_style: Option<String>,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub known_fonts: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub root_namespace_attrs: Vec<(String, String)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<Vec<u8>>,
}

impl WorkbookStylesheet {
    #[must_use]
    pub fn from_stylesheet(
        stylesheet: ooxml_types::styles::Stylesheet,
        root_namespace_attrs: Vec<(String, String)>,
        ext_lst_xml: Option<Vec<u8>>,
    ) -> Self {
        Self {
            number_formats: stylesheet.num_fmts,
            fonts: stylesheet.fonts,
            known_fonts: stylesheet.known_fonts,
            fills: stylesheet.fills,
            borders: stylesheet.borders,
            cell_style_xfs: stylesheet.cell_style_xfs,
            cell_xfs: stylesheet.cell_xfs,
            named_cell_styles: stylesheet.cell_styles,
            differential_formats: stylesheet.dxfs,
            indexed_colors: stylesheet.colors,
            table_styles: stylesheet.table_styles,
            default_table_style: stylesheet.default_table_style,
            default_pivot_style: stylesheet.default_pivot_style,
            root_namespace_attrs,
            ext_lst_xml,
            stylesheet: ooxml_types::styles::Stylesheet::default(),
        }
    }

    #[must_use]
    pub fn to_stylesheet(&self) -> ooxml_types::styles::Stylesheet {
        if self.is_registry_empty()
            && self.stylesheet != ooxml_types::styles::Stylesheet::default()
        {
            return self.stylesheet.clone();
        }

        ooxml_types::styles::Stylesheet {
            num_fmts: self.number_formats.clone(),
            fonts: self.fonts.clone(),
            known_fonts: self.known_fonts,
            fills: self.fills.clone(),
            borders: self.borders.clone(),
            cell_style_xfs: self.cell_style_xfs.clone(),
            cell_xfs: self.cell_xfs.clone(),
            cell_styles: self.named_cell_styles.clone(),
            dxfs: self.differential_formats.clone(),
            colors: self.indexed_colors.clone(),
            table_styles: self.table_styles.clone(),
            default_table_style: self.default_table_style.clone(),
            default_pivot_style: self.default_pivot_style.clone(),
            ext_lst: None,
        }
    }

    #[must_use]
    pub fn normalized(&self) -> Self {
        if self.is_registry_empty()
            && self.stylesheet != ooxml_types::styles::Stylesheet::default()
        {
            return Self::from_stylesheet(
                self.stylesheet.clone(),
                self.root_namespace_attrs.clone(),
                self.ext_lst_xml.clone(),
            );
        }
        let mut normalized = self.clone();
        normalized.stylesheet = ooxml_types::styles::Stylesheet::default();
        normalized
    }

    fn is_registry_empty(&self) -> bool {
        self.number_formats.is_empty()
            && self.fonts.is_empty()
            && self.fills.is_empty()
            && self.borders.is_empty()
            && self.cell_style_xfs.is_empty()
            && self.cell_xfs.is_empty()
            && self.named_cell_styles.is_empty()
            && self.differential_formats.is_empty()
            && self.table_styles.is_empty()
            && self.indexed_colors.is_none()
            && self.default_table_style.is_none()
            && self.default_pivot_style.is_none()
            && !self.known_fonts
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedStringHint {
    /// Original SST index from `xl/sharedStrings.xml`.
    pub index: u32,
    /// Plain text content. Export uses this to reject stale hints after edits.
    pub text: String,
    /// Rich text runs for this SST entry, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_text: Option<Vec<RichTextRun>>,
    /// Raw typed phonetic XML children (`<rPh>` / `<phoneticPr>`) for this entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_xml: Option<Vec<u8>>,
}

/// Cell-owned rich shared-string content.
///
/// The plain text projection remains the behavioral cell value. Rich runs and
/// phonetic data are exported only when `plain_text` still matches the current
/// text value, so ordinary text edits cannot replay stale SST formatting.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichSharedString {
    pub plain_text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<RichTextRun>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub phonetic_runs: Vec<PhoneticRun>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_properties: Option<PhoneticProperties>,
    /// Source-compatible phonetic children for import compatibility.
    ///
    /// This is cell-owned state, not workbook-level preserved SST state. The
    /// typed fields above are the domain contract; this raw fallback keeps
    /// unsupported phonetic attributes from being discarded while the writer's
    /// typed phonetic surface remains intentionally small.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_xml: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneticRun {
    pub text: String,
    pub start_index: u32,
    pub end_index: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneticProperties {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<String>,
}

/// A named range definition (position-keyed, no CellIds).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedRange {
    pub name: String,
    /// The formula this name refers to (A1 notation).
    pub refers_to: String,
    /// Sheet index for sheet-scoped names (None = workbook scope).
    pub local_sheet_id: Option<u32>,
    pub hidden: bool,
    pub comment: Option<String>,
    /// Custom menu text (customMenu) for macro-oriented defined names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_menu: Option<String>,
    /// Description text (description) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Help topic text (help) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    /// Status bar text (statusBar) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_bar: Option<String>,
    /// Whether this is an XLM macro name (xlm="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub xlm: bool,
    /// Whether this name is a function (function="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub function: bool,
    /// Whether this is a VBA procedure name (vbProcedure="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub vb_procedure: bool,
    /// Whether this name should be published to the server (publishToServer="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub publish_to_server: bool,
    /// Whether this name is a workbook parameter (workbookParameter="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub workbook_parameter: bool,
    /// Whether xml:space="preserve" should be emitted on the value.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub xml_space_preserve: bool,
}

/// A data table region (position-keyed).
///
/// `row_input_ref` / `col_input_ref` are typed `Option<CellRef>` to keep the
/// parser -> lowering -> snapshot edge stateless, with no typed-to-string-to-
/// typed hop.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableOoxmlFlags {
    /// Authored `<f t="dataTable" r1="...">` attribute spelling, preserved for
    /// file round-trip. The typed `col_input_ref` remains the behavioral source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r1: Option<String>,
    /// Authored `<f t="dataTable" r2="...">` attribute spelling, preserved for
    /// file round-trip. The typed `row_input_ref` remains the behavioral source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r2: Option<String>,
    /// `<f t="dataTable" aca="1">`: always calculate array/data-table formula.
    #[serde(default)]
    pub aca: bool,
    /// `<f t="dataTable" ca="1">`: calculate this formula.
    #[serde(default)]
    pub ca: bool,
    /// `<f t="dataTable" bx="1">`: OOXML data-table input mode flag.
    #[serde(default)]
    pub bx: bool,
    /// `<f t="dataTable" dt2D="1">`: two-variable data table flag.
    #[serde(default)]
    pub dt2d: bool,
    /// `<f t="dataTable" dtr="1">`: data table uses row/column references.
    #[serde(default)]
    pub dtr: bool,
    /// `<f t="dataTable" del1="1">`: delete first input row flag.
    #[serde(default)]
    pub del1: bool,
    /// `<f t="dataTable" del2="1">`: delete second input row flag.
    #[serde(default)]
    pub del2: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableRegion {
    pub sheet_index: u32,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    /// Input cell that receives left-column header values (one per body row).
    /// Normalized from Excel's r2 attribute ("column input cell").
    pub row_input_ref: Option<formula_types::CellRef>,
    /// Input cell that receives top-row header values (one per body column).
    /// Normalized from Excel's r1 attribute ("row input cell").
    pub col_input_ref: Option<formula_types::CellRef>,
    /// OOXML `<f t="dataTable">` flags that Mog does not yet implement
    /// behaviorally but must preserve or normalize explicitly for round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_flags: Option<DataTableOoxmlFlags>,
}

/// All data for a single sheet, position-keyed.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetData {
    pub name: String,
    pub rows: u32,
    pub cols: u32,
    /// Original sheetId from workbook.xml (1-based). Preserved for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<u32>,
    /// Sheet visibility state from workbook.xml.
    #[serde(default)]
    pub visibility: SheetState,
    /// Stable sheet identity for co-authoring (xr:uid on `<worksheet>` root).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    pub cells: Vec<CellData>,
    /// Authored blank `<c>` cells with an explicit `s` attribute.
    ///
    /// These are runtime-visible cell-level style overlays, but they do not
    /// carry values/formulas and must not force dense `cells` entries.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authored_style_runs: Vec<AuthoredStyleRun>,
    pub dimensions: SheetDimensions,
    pub merges: Vec<MergeRegion>,
    pub frozen_pane: Option<FrozenPane>,
    pub view: SheetView,
    /// Additional `<sheetView>` elements beyond the primary one (index 1+).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_sheet_views: Vec<SheetView>,
    pub row_styles: Vec<RowStyleEntry>,
    pub col_styles: Vec<ColStyleEntry>,
    // Domain objects
    pub charts: Vec<ChartSpec>,
    pub conditional_formats: Vec<ConditionalFormat>,
    pub comments: Vec<Comment>,
    pub hyperlinks: Vec<Hyperlink>,
    pub data_validations: Vec<ValidationSpec>,
    /// Source count attribute on `<dataValidations>`, when imported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_validations_declared_count: Option<u32>,
    /// Container-level disablePrompts attribute on `<dataValidations>`.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub data_validations_disable_prompts: bool,
    /// Container-level xWindow attribute on `<dataValidations>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_validations_x_window: Option<u32>,
    /// Container-level yWindow attribute on `<dataValidations>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_validations_y_window: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub x14_data_validations: Vec<ValidationSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x14_data_validations_declared_count: Option<u32>,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub x14_data_validations_disable_prompts: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x14_data_validations_x_window: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x14_data_validations_y_window: Option<u32>,
    pub sparklines: Vec<Sparkline>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sparkline_groups: Vec<SparklineGroup>,
    pub tables: Vec<TableSpec>,
    pub slicers: Vec<OoxmlSlicerDef>,
    pub slicer_anchors: Vec<OoxmlSlicerAnchor>,
    pub floating_objects: Vec<FloatingObject>,
    // Print & Protection
    pub print_settings: Option<PrintSettings>,
    pub page_breaks: Option<PageBreaks>,
    /// Header/footer images parsed from VML drawings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hf_images: Vec<crate::domain::print::HeaderFooterImageInfo>,
    pub protection: Option<SheetProtection>,
    // Structure
    pub auto_filter: Option<AutoFilter>,
    /// Worksheet-level `<sortState>` element (not nested inside `<autoFilter>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<SortState>,
    /// Known worksheet semantic containers whose full OOXML model is not yet
    /// decomposed into smaller runtime objects.
    #[serde(default, skip_serializing_if = "WorksheetSemanticContainers::is_empty")]
    pub worksheet_semantic_containers: WorksheetSemanticContainers,
    pub outline_groups: Vec<OutlineGroup>,
    /// Worksheet-level `<sheetPr>` attributes and child properties.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_properties: Option<ooxml_types::worksheet::SheetProperties>,
    /// Outline (grouping) properties from `<sheetPr><outlinePr>`.
    /// Controls summary row/column placement and outline symbol visibility.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_properties: Option<ooxml_types::worksheet::OutlineProperties>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorksheetSemanticXml {
    pub raw_xml: String,
}

impl WorksheetSemanticXml {
    pub fn new(raw_xml: String) -> Self {
        Self { raw_xml }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorksheetSemanticContainers {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_sheet_views: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignored_errors: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_calc_pr: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protected_ranges: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenarios: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_consolidate: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_pr: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smart_tags: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_watches: Option<WorksheetSemanticXml>,
}

impl WorksheetSemanticContainers {
    pub fn is_empty(&self) -> bool {
        self.custom_sheet_views.is_none()
            && self.ignored_errors.is_none()
            && self.sheet_calc_pr.is_none()
            && self.protected_ranges.is_none()
            && self.scenarios.is_none()
            && self.data_consolidate.is_none()
            && self.phonetic_pr.is_none()
            && self.smart_tags.is_none()
            && self.cell_watches.is_none()
    }
}

/// Parser-owned classification for imported cells whose OOXML metadata affects
/// projection or spill behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportedCellProjectionRole {
    #[default]
    Normal,
    DynamicArraySource,
    DynamicArraySpillTarget,
    UnknownCellMetadata,
}

impl ImportedCellProjectionRole {
    pub fn is_normal(&self) -> bool {
        *self == Self::Normal
    }
}

/// A single cell's data, position-keyed (no UUID).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellData {
    pub row: u32,
    pub col: u32,
    pub value: CellValue,
    /// Rich/phonetic shared-string content owned by this cell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_string: Option<RichSharedString>,
    /// Formula in A1 notation (expanded text for all formula types).
    pub formula: Option<String>,
    /// Array formula master cell range.
    pub array_ref: Option<String>,
    /// Index into `ParseOutput.style_palette`.
    pub style_id: Option<u32>,
    /// Original OOXML formula metadata for round-trip preservation.
    /// When present, carries shared/array/dataTable formula attributes
    /// so the writer can emit the correct `<f>` element structure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_formula: Option<ooxml_types::worksheet::CellFormula>,
    /// Whether the `<c>` element has a `cm` attribute (cell metadata / dynamic arrays).
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub cm: bool,
    /// For formula cells with a string result, the OOXML `t` attribute value
    /// (e.g., `6` = "str", `4` = "e", `3` = "b"). Used for round-trip fidelity
    /// to emit the correct `t="str"` on cells whose formula evaluates to a string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula_result_type: Option<u8>,
    /// Whether the formula cell had an explicit empty `<v/>` element in the original XML.
    /// When true, the writer emits `<v/>` even though the cached value is null/empty.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub has_empty_cached_value: bool,
    /// Value metadata index from the `vm` attribute on the `<c>` element.
    /// Used for rich value types (linked data types, images-in-cells).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vm: Option<u32>,
    /// Original shared string table index for `t="s"` cells.
    /// Used for round-trip fidelity when the SST contains both plain and rich text
    /// entries for the same text content (they have different indices).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_sst_index: Option<u32>,
    /// Original raw value string from the `<v>` element for round-trip fidelity.
    /// Preserves the exact numeric representation (e.g., scientific notation)
    /// that Excel wrote, so the writer can emit it back unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_value: Option<String>,
    /// Parser-owned projection/spill role. Consumers must not infer deletion or
    /// storage omission from `cm` alone.
    #[serde(default, skip_serializing_if = "ImportedCellProjectionRole::is_normal")]
    pub projection_role: ImportedCellProjectionRole,
}

/// Compact coverage for authored style-only worksheet cells.
///
/// Bounds are zero-based and inclusive. `style_id` follows the same boundary
/// contract as [`CellData::style_id`]: an index into `ParseOutput.style_palette`.
/// A value of `0` is meaningful.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoredStyleRun {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    pub style_id: u32,
}

/// Row and column dimension information for a sheet.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetDimensions {
    pub default_row_height: Option<f64>,
    pub default_col_width: Option<f64>,
    /// Default row descent (x14ac:dyDescent on sheetFormatPr) — text baseline offset in points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_row_descent: Option<f64>,
    /// Base column width (baseColWidth on sheetFormatPr) — roundtrip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_col_width: Option<u32>,
    /// Whether the default row height is custom (customHeight="1" on sheetFormatPr).
    #[serde(default)]
    pub custom_height: bool,
    /// Whether zero-height rows are the default (zeroHeight="1" on sheetFormatPr).
    #[serde(default)]
    pub zero_height: bool,
    /// Outline level for rows (outlineLevelRow on sheetFormatPr) — roundtrip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_level_row: Option<u8>,
    /// Outline level for columns (outlineLevelCol on sheetFormatPr) — roundtrip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_level_col: Option<u8>,
    pub row_heights: Vec<RowDimension>,
    pub col_widths: Vec<ColDimension>,
    /// Column ranges that extend beyond the data region (typically `max=16384`).
    /// Preserved as-is for round-trip fidelity — these are not expanded into
    /// individual ColDimension entries because no ColIds are allocated for them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trailing_col_ranges: Vec<TrailingColRange>,
}

/// Dimension data for a single row.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowDimension {
    pub row: u32,
    pub height: f64,
    pub custom_height: bool,
    pub hidden: bool,
    /// Whether the row had an explicit hidden attribute. This distinguishes an
    /// authored `hidden="0"` from an omitted default.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub explicit_hidden: bool,
    /// Whether the row has customFormat="1" without an explicit style (s attribute).
    /// This preserves the flag for round-trip fidelity.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub custom_format: bool,
    /// Per-row outline level. `Some(0)` means the source authored
    /// `outlineLevel="0"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_level: Option<u8>,
    /// Whether the row had an authored `outlineLevel="0"` attribute.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub explicit_outline_level_zero: bool,
    /// Authored collapsed attribute. `Some(false)` preserves `collapsed="0"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub thick_top: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub thick_bot: bool,
    /// Per-row text baseline descent (x14ac:dyDescent attribute).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descent: Option<f64>,
    /// Typed lexical hints owned by this row.
    #[serde(default, skip_serializing_if = "RowXmlHints::is_empty")]
    pub xml_hints: RowXmlHints,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowXmlHints {
    /// Authored `spans` attribute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spans: Option<String>,
    /// Authored row element with no cells and no semantic attributes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bare_empty: bool,
}

impl RowXmlHints {
    pub fn is_empty(&self) -> bool {
        self.spans.is_none() && !self.bare_empty
    }
}

/// Dimension data for a single column.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColDimension {
    pub col: u32,
    pub width: f64,
    pub custom_width: bool,
    pub hidden: bool,
    pub best_fit: bool,
    /// Whether the outline group is collapsed at this column.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
}

/// A column range that extends beyond the data region, preserved for round-trip fidelity.
///
/// In OOXML, `<col max="16384">` means "apply this style/width to all columns
/// from `min` through XFD (the last column)". These ranges cannot be stored as
/// individual ColDimension entries because no ColIds are allocated beyond the
/// data region. Instead they are stored as opaque metadata through Yrs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrailingColRange {
    /// Start column (1-indexed, as in OOXML `<col min>`).
    pub min: u32,
    /// End column (1-indexed, as in OOXML `<col max>`). 16384 = XFD = last column.
    pub max: u32,
    pub width: f64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub custom_width: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub best_fit: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
    /// Column style index into `ParseOutput.style_palette`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<u32>,
}

/// Frozen pane configuration.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenPane {
    pub rows: u32,
    pub cols: u32,
    pub top_left_cell: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SheetPaneState {
    Frozen,
    FrozenSplit,
    Split,
}

impl SheetPaneState {
    pub fn from_ooxml(state: ooxml_types::worksheet::PaneState) -> Self {
        match state {
            ooxml_types::worksheet::PaneState::Frozen => Self::Frozen,
            ooxml_types::worksheet::PaneState::FrozenSplit => Self::FrozenSplit,
            ooxml_types::worksheet::PaneState::Split => Self::Split,
        }
    }

    pub fn to_ooxml(self) -> ooxml_types::worksheet::PaneState {
        match self {
            Self::Frozen => ooxml_types::worksheet::PaneState::Frozen,
            Self::FrozenSplit => ooxml_types::worksheet::PaneState::FrozenSplit,
            Self::Split => ooxml_types::worksheet::PaneState::Split,
        }
    }

    pub fn is_frozen(self) -> bool {
        matches!(self, Self::Frozen | Self::FrozenSplit)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SheetPaneId {
    BottomLeft,
    BottomRight,
    TopLeft,
    TopRight,
}

impl SheetPaneId {
    pub fn from_ooxml(pane: ooxml_types::worksheet::Pane) -> Self {
        match pane {
            ooxml_types::worksheet::Pane::BottomLeft => Self::BottomLeft,
            ooxml_types::worksheet::Pane::BottomRight => Self::BottomRight,
            ooxml_types::worksheet::Pane::TopLeft => Self::TopLeft,
            ooxml_types::worksheet::Pane::TopRight => Self::TopRight,
        }
    }

    pub fn to_ooxml(self) -> ooxml_types::worksheet::Pane {
        match self {
            Self::BottomLeft => ooxml_types::worksheet::Pane::BottomLeft,
            Self::BottomRight => ooxml_types::worksheet::Pane::BottomRight,
            Self::TopLeft => ooxml_types::worksheet::Pane::TopLeft,
            Self::TopRight => ooxml_types::worksheet::Pane::TopRight,
        }
    }
}

/// Typed OOXML pane metadata for the primary sheet view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetPaneConfig {
    pub state: SheetPaneState,
    pub x_split: f64,
    pub y_split: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_left_cell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_pane: Option<SheetPaneId>,
}

impl SheetPaneConfig {
    pub fn from_ooxml(pane: &ooxml_types::worksheet::SheetPane) -> Self {
        Self {
            state: SheetPaneState::from_ooxml(pane.effective_state()),
            x_split: pane.x_split,
            y_split: pane.y_split,
            top_left_cell: pane.top_left_cell.clone(),
            active_pane: pane.active_pane.map(SheetPaneId::from_ooxml),
        }
    }

    pub fn to_ooxml(&self) -> ooxml_types::worksheet::SheetPane {
        ooxml_types::worksheet::SheetPane {
            x_split: self.x_split,
            y_split: self.y_split,
            top_left_cell: self.top_left_cell.clone(),
            active_pane: self.active_pane.map(SheetPaneId::to_ooxml),
            state: Some(self.state.to_ooxml()),
        }
    }
}

/// Sheet view settings (zoom, visibility toggles, scroll position).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetView {
    pub show_gridlines: bool,
    pub show_row_col_headers: bool,
    pub show_zeros: bool,
    pub show_outline_symbols: bool,
    pub show_formulas: bool,
    pub right_to_left: bool,
    /// Whether to show ruler in page layout view (default: true).
    #[serde(default = "crate::default_true")]
    pub show_ruler: bool,
    /// Whether to show white space in page layout view (default: true).
    #[serde(default = "crate::default_true")]
    pub show_white_space: bool,
    /// Whether the default grid color is used (default: true).
    #[serde(default = "crate::default_true")]
    pub default_grid_color: bool,
    /// Whether the window is protected from resizing.
    #[serde(default)]
    pub window_protection: bool,
    /// Indexed color value for grid lines (legacy). None means default (64).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_id: Option<u32>,
    pub zoom_scale: Option<u32>,
    pub zoom_scale_normal: Option<u32>,
    /// View type: "normal" (default, omitted), "pageBreakPreview", or "pageLayout".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    /// Zoom scale for page layout view (zoomScalePageLayoutView).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom_scale_page_layout_view: Option<u32>,
    /// Zoom scale for page break preview (zoomScaleSheetLayoutView).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom_scale_sheet_layout_view: Option<u32>,
    #[serde(default, skip_serializing_if = "crate::is_zero_u32")]
    pub workbook_view_id: u32,
    pub scroll_row: u32,
    pub scroll_col: u32,
    /// Whether the original file had an explicit `topLeftCell` attribute on `<sheetView>`.
    /// When true, `topLeftCell` is emitted even if scroll_row/scroll_col are both 0
    /// (i.e., the attribute value is the default "A1").
    #[serde(default)]
    pub has_explicit_top_left_cell: bool,
    pub tab_selected: bool,
    /// Active cell reference from `<selection activeCell="...">` (e.g. "E16").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_cell: Option<String>,
    /// Selection range from `<selection sqref="...">` (e.g. "E16" or "A1:B5").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sqref: Option<String>,
    /// Typed pane configuration from this `<sheetView>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<SheetPaneConfig>,
    /// All selection elements for round-trip fidelity.
    /// When present, these are used instead of active_cell/sqref to preserve
    /// multi-pane selections (frozen pane sheets have up to 4 selection elements).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selections: Vec<ooxml_types::worksheet::Selection>,
}

impl Default for SheetView {
    fn default() -> Self {
        Self {
            show_gridlines: true,
            show_row_col_headers: true,
            show_zeros: true,
            show_outline_symbols: true,
            show_formulas: false,
            right_to_left: false,
            show_ruler: true,
            show_white_space: true,
            default_grid_color: true,
            window_protection: false,
            color_id: None,
            zoom_scale: None,
            zoom_scale_normal: None,
            view: None,
            zoom_scale_page_layout_view: None,
            zoom_scale_sheet_layout_view: None,
            workbook_view_id: 0,
            scroll_row: 0,
            scroll_col: 0,
            has_explicit_top_left_cell: false,
            tab_selected: false,
            active_cell: None,
            sqref: None,
            pane: None,
            selections: Vec::new(),
        }
    }
}

impl SheetView {
    pub fn from_ooxml(sv: &ooxml_types::worksheet::SheetView) -> Self {
        let (scroll_row, scroll_col) = sv
            .top_left_cell
            .as_deref()
            .and_then(parse_a1_cell_ref)
            .unwrap_or((0, 0));
        let primary_selection = sv.selections.last();
        Self {
            show_gridlines: sv.show_grid_lines,
            show_row_col_headers: sv.show_row_col_headers,
            show_zeros: sv.show_zeros,
            show_outline_symbols: sv.show_outline_symbols,
            show_formulas: sv.show_formulas,
            right_to_left: sv.right_to_left,
            show_ruler: sv.show_ruler,
            show_white_space: sv.show_white_space,
            default_grid_color: sv.default_grid_color,
            window_protection: sv.window_protection,
            color_id: if sv.color_id == 64 {
                None
            } else {
                Some(sv.color_id)
            },
            zoom_scale: if sv.zoom_scale == 100 {
                None
            } else {
                Some(sv.zoom_scale)
            },
            zoom_scale_normal: if sv.zoom_scale_normal == 0 {
                None
            } else {
                Some(sv.zoom_scale_normal)
            },
            view: if sv.view.is_default() {
                None
            } else {
                Some(sv.view.to_ooxml().to_string())
            },
            zoom_scale_page_layout_view: sv.zoom_scale_page_layout_view,
            zoom_scale_sheet_layout_view: sv.zoom_scale_sheet_layout_view,
            workbook_view_id: sv.workbook_view_id,
            scroll_row,
            scroll_col,
            has_explicit_top_left_cell: sv.top_left_cell.is_some(),
            tab_selected: sv.tab_selected,
            active_cell: primary_selection.and_then(|s| s.active_cell.clone()),
            sqref: primary_selection.and_then(|s| s.sqref.clone()),
            pane: sv.pane.as_ref().map(SheetPaneConfig::from_ooxml),
            selections: sv.selections.clone(),
        }
    }
}

fn parse_a1_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let mut col: u32 = 0;
    let mut row_start = 0;
    let bytes = cell_ref.as_bytes();
    let mut i = 0;
    if bytes.get(i) == Some(&b'$') {
        i += 1;
    }
    while let Some(&b) = bytes.get(i) {
        if b.is_ascii_alphabetic() {
            col = col * 26 + (b.to_ascii_uppercase() - b'A' + 1) as u32;
            row_start = i + 1;
            i += 1;
        } else {
            break;
        }
    }
    if bytes.get(row_start) == Some(&b'$') {
        row_start += 1;
    }
    if col == 0 || row_start >= cell_ref.len() {
        return None;
    }
    let row: u32 = cell_ref[row_start..].parse().ok()?;
    if row == 0 {
        return None;
    }
    Some((row - 1, col - 1))
}

// MergeRegion is defined in domain::merge and re-exported via `use crate::domain::*` above.

/// Style override for an entire row.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowStyleEntry {
    pub row: u32,
    pub style_id: u32,
}

/// Style override for an entire column.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColStyleEntry {
    pub col: u32,
    pub style_id: u32,
}
