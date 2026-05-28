//! Round-trip preservation types.
//!
//! Field ownership and deprecation policy is recorded in
//! `round_trip_field_inventory.md` next to this module.

use ooxml_types::styles::Stylesheet;
use ooxml_types::themes::{ColorScheme, FontScheme, FormatScheme};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Opaque XLSX preservation data for import/export round-tripping.
///
/// Hard invariant: this context is only for OOXML/package data that the Mog
/// engine cannot interpret or mutate. If Mog has a domain type for a concept,
/// import must lower it into that domain type and export must regenerate the
/// OOXML/package graph from domain state.
///
/// This context must never be the source of truth for engine-mutated workbook
/// semantics, modeled XML parts, content types, or relationships. Preserved
/// blobs are valid only for opaque subgraphs whose owner parts are also outside
/// Mog's mutation surface.
///
/// Relationship IDs, part names, and ordering from imported XLSX files may be
/// kept as non-authoritative hints only. They must not decide whether modeled
/// parts exist in the exported package.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundTripContext {
    pub sheets: Vec<SheetRoundTripContext>,

    /// Full parsed stylesheet for lossless style reconstruction.
    /// Contains all OOXML style components (fonts, fills, borders, cellXfs,
    /// cellStyleXfs, cellStyles, dxfs, colors, tableStyles, numFmts) with
    /// original theme/indexed color references preserved.
    /// When present, the writer uses this directly instead of the lossy
    /// DocumentFormat palette.
    /// The `x14ac:knownFonts="1"` flag lives on `Stylesheet.known_fonts`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parsed_stylesheet: Option<Stylesheet>,

    /// Raw XML of `<extLst>...</extLst>` from `xl/styles.xml` for round-trip fidelity.
    /// Extension lists contain vendor-specific data that Stylesheet doesn't model.
    #[serde(default, with = "option_bytes")]
    pub styles_ext_lst_xml: Option<Vec<u8>>,

    /// Namespace declarations from the `<styleSheet>` root element.
    /// Each entry is (prefix, uri). Used to reconstruct `mc:Ignorable`, `xmlns:x14ac`,
    /// and other namespace attrs for round-trip fidelity.
    #[serde(default)]
    pub styles_namespace_attrs: Vec<(String, String)>,

    /// Deprecated compatibility-only input for legacy snapshots.
    ///
    /// Broad package content-type defaults must not be package authority. New
    /// export paths derive content types from modeled parts plus explicit clean
    /// `opaque_package_subgraphs`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_type_defaults: Vec<(String, String)>,
    /// Deprecated compatibility-only input for legacy snapshots.
    ///
    /// Broad package content-type overrides must not be package authority. New
    /// export paths derive content types from modeled parts plus explicit clean
    /// `opaque_package_subgraphs`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_type_overrides: Vec<(String, String)>,
    /// Deprecated compatibility-only input for legacy snapshots.
    ///
    /// Root relationships must not be replayed as package authority. New export
    /// paths derive relationships from modeled parts plus explicit clean
    /// `opaque_package_subgraphs`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub root_relationships: Vec<OpcRelationship>,
    /// Deprecated compatibility-only input for legacy snapshots.
    ///
    /// Workbook relationships must not be replayed as package authority. New
    /// export paths derive relationships from modeled parts plus explicit clean
    /// `opaque_package_subgraphs`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_relationships: Vec<OpcRelationship>,

    /// Original relationship IDs per sheet from workbook.xml, in document order.
    ///
    /// Non-authoritative hint only. Sheet relationships for modeled worksheets
    /// must be generated from the exported workbook graph.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_workbook_r_ids: Vec<String>,

    // Workbook-level preserved blobs
    /// Original `count` attribute from the `<sst>` element in the parsed XLSX.
    ///
    /// AUDIT WARNING: shared strings are part of the modeled cell graph. This
    /// may not override the count implied by generated sharedStrings.xml.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_sst_count: Option<usize>,

    /// Parsed shared strings list (index-aligned with the raw SST XML).
    ///
    /// AUDIT WARNING: shared strings are cell data, so this may only be used as
    /// an index hint for cells that still prove they reference the same text.
    /// It must not make the imported SST authoritative.
    #[serde(default)]
    pub shared_strings_list: Vec<String>,

    /// Rich text runs for SST entries with formatting.
    /// Index-aligned with `shared_strings_list`. `None` = plain text, `Some` = rich text runs.
    /// Used to preserve rich text formatting during round-trip.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_strings_rich_runs: Vec<Option<Vec<crate::domain::comment::RichTextRun>>>,

    /// Raw phonetic XML (`<rPh>...</rPh>` + `<phoneticPr .../>`) per SST entry.
    /// Index-aligned with `shared_strings_list`. `None` = no phonetic data.
    /// Used to preserve Japanese/CJK phonetic annotations during round-trip.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_strings_phonetic_xml: Vec<Option<Vec<u8>>>,

    /// AUDIT WARNING: sharedStrings.xml is generated from modeled cells and
    /// must not be replayed verbatim once cells can change.
    #[serde(
        default,
        with = "option_bytes",
        skip_serializing_if = "Option::is_none"
    )]
    pub raw_shared_strings_xml: Option<Vec<u8>>,
    /// Compatibility input only. Document properties are modeled through
    /// `ParseOutput.properties` and must be regenerated from that state.
    #[serde(
        default,
        with = "option_bytes",
        skip_serializing_if = "Option::is_none"
    )]
    pub raw_doc_props_core_xml: Option<Vec<u8>>,
    /// Compatibility input only. Unsupported extended properties are dropped
    /// unless they are promoted to modeled document property state.
    #[serde(
        default,
        with = "option_bytes",
        skip_serializing_if = "Option::is_none"
    )]
    pub raw_doc_props_app_xml: Option<Vec<u8>>,
    /// Compatibility input only. Modeled custom properties live on
    /// `DocumentProperties.typed_custom` with `DocumentProperties.custom` kept
    /// as a legacy string projection.
    #[serde(
        default,
        with = "option_bytes",
        skip_serializing_if = "Option::is_none"
    )]
    pub raw_doc_props_custom_xml: Option<Vec<u8>>,
    /// Compatibility input only. Raw `xl/metadata.xml` may seed export only
    /// while current modeled cells still reference cell/value metadata (`cm`
    /// or `vm`); stale metadata must not force package parts by itself.
    #[serde(
        default,
        with = "option_bytes",
        skip_serializing_if = "Option::is_none"
    )]
    pub raw_metadata_xml: Option<Vec<u8>>,
    /// Compatibility input only. Person identity export is modeled through
    /// `ParseOutput.persons`; stale raw person.xml must not be replayed when
    /// modeled persons are absent.
    #[serde(
        default,
        with = "option_bytes",
        skip_serializing_if = "Option::is_none"
    )]
    pub raw_persons_xml: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_xml_parts: Vec<BlobPart>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub web_extension_parts: Vec<BlobPart>,
    /// Explicit clean opaque package subgraphs that may be emitted verbatim.
    ///
    /// Legacy raw fields such as `custom_xml_parts`, `web_extension_parts`, and
    /// `binary_blobs` are compatibility inputs only. Exporters should preserve
    /// opaque package data through these typed records once import can prove a
    /// closed clean subgraph.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opaque_package_subgraphs: Vec<OpaquePackageSubgraph>,
    /// General-purpose binary blob passthrough for ZIP entries not modeled
    /// in the domain (printerSettings, vbaProject, richData, featurePropertyBag,
    /// customProperty, media, timelines, timelineCaches,
    /// queryTables, connections, volatileDependencies, thumbnails, etc.).
    ///
    /// Deprecated compatibility-only input. New exporters must use typed
    /// feature sidecars or explicit clean `OpaquePackageSubgraph` records
    /// instead of blanket binary passthrough.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub binary_blobs: Vec<BlobPart>,
    /// Deprecated compatibility-only input for legacy snapshots.
    ///
    /// Pivots are modeled features. Fresh imports must lower pivot state into
    /// domain pivot storage and regenerate package parts from modeled state,
    /// rather than replaying clean imported pivot package bytes.
    #[serde(default, skip_serializing_if = "PivotPackageRoundTrip::is_empty")]
    pub pivot_package: PivotPackageRoundTrip,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<ExtensionPreservation>,

    /// Namespace declarations from the `<workbook>` root element.
    /// Each entry is (prefix, uri). Used to reconstruct `mc:Ignorable` and
    /// other extension namespace attrs for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_namespace_attrs: Vec<(String, String)>,
    /// Preserved unknown XML elements from `workbook.xml` as raw XML strings.
    /// Each entry is (position_key, raw_xml) where position_key encodes
    /// the insertion point (e.g., "first:workbook", "after:workbook:fileVersion").
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_preserved_elements: Vec<(String, String)>,

    /// Compatibility input only. Hidden and opaque defined names are modeled in
    /// workbook named-range storage with `raw_refers_to` when needed; exporters
    /// must not merge this list back into workbook XML.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped_named_ranges: Vec<crate::parse_output::NamedRange>,

    /// Compatibility input only. Modeled named ranges carry their own order in
    /// workbook named-range storage; exporters must not use this list as an
    /// authority to resurrect deleted or unsupported names.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub original_named_ranges_order: Vec<crate::parse_output::NamedRange>,

    // Theme preservation for lossless round-tripping.
    // When present, the writer uses these instead of the lossy ThemeData reconstruction.
    /// Original theme name (e.g., "Office Theme 2007 - 2010"). Localized names
    /// must survive round-trip without being clobbered by defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_name: Option<String>,
    /// Full DrawingML color scheme (preserves sysClr/srgbClr variants, transforms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_color_scheme: Option<ColorScheme>,
    /// Full font scheme with script-specific font mappings (Jpan, Hang, Hans, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_font_scheme: Option<FontScheme>,
    /// Full format scheme (fill, line, and effect style lists).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_format_scheme: Option<FormatScheme>,
    /// Raw inner XML of `<a:objectDefaults>` (inner content only, no wrapper tags).
    #[serde(default, with = "option_bytes")]
    pub theme_object_defaults_xml: Option<Vec<u8>>,
    /// Raw inner XML of `<a:extraClrSchemeLst>` (inner content only).
    #[serde(default, with = "option_bytes")]
    pub theme_extra_clr_scheme_lst_xml: Option<Vec<u8>>,
    /// Raw XML of `<a:extLst>` (full element including tags).
    #[serde(default, with = "option_bytes")]
    pub theme_ext_lst_xml: Option<Vec<u8>>,
    /// Compatibility input only. `docMetadata/LabelInfo.xml` is unsupported
    /// classification-label package data and must not be replayed as a raw
    /// standalone sidecar outside an explicit clean opaque subgraph.
    #[serde(
        default,
        with = "option_bytes",
        skip_serializing_if = "Option::is_none"
    )]
    pub doc_metadata_label_info: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetRoundTripContext {
    /// Deprecated compatibility-only input for legacy snapshots.
    ///
    /// Sheet relationships must not be replayed as package authority. New export
    /// paths derive relationships from modeled parts plus explicit clean
    /// `opaque_package_subgraphs`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_opc_rels: Vec<OpcRelationship>,
    /// Compatibility input only. Comment VML and header/footer image VML may
    /// seed modeled/owned outputs, but stale raw VML must not emit by itself.
    #[serde(default)]
    pub raw_vml_drawings: Vec<VmlDrawingPart>,
    pub legacy_drawing_r_id: Option<String>,
    pub legacy_drawing_hf_r_id: Option<String>,
    #[serde(default)]
    pub comments_root_namespace_attrs: Vec<(String, String)>,
    /// Original comment author list from the parsed comments XML.
    /// Preserved for round-trip fidelity — the reconstruction from domain types
    /// only includes authors referenced by actual comments, dropping unused authors.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comment_authors: Vec<String>,
    #[serde(default)]
    pub row_descents: HashMap<u32, f64>,
    /// Compatibility identity hints for lexical row attributes.
    /// Export may use them only to decorate rows that still exist in modeled
    /// worksheet state; these hints must not create deleted rows by themselves.
    #[serde(default)]
    pub row_spans: HashMap<u32, String>,
    #[serde(default)]
    pub bare_empty_rows: Vec<u32>,
    /// Rows with thickBot="1" attribute for round-trip fidelity.
    /// Compatibility identity hint; does not create rows by itself.
    #[serde(default)]
    pub row_thick_bot: Vec<u32>,
    /// Rows with thickTop="1" attribute for round-trip fidelity.
    /// Compatibility identity hint; does not create rows by itself.
    #[serde(default)]
    pub row_thick_top: Vec<u32>,
    /// Rows with an explicit `collapsed` attribute for round-trip fidelity.
    /// Maps row index → collapsed value. Preserves both `collapsed="0"` and `collapsed="1"`.
    /// Compatibility identity hint; does not create rows by itself.
    #[serde(default)]
    pub row_collapsed: HashMap<u32, bool>,
    /// Rows with explicit `hidden="0"` for round-trip fidelity.
    /// Normally `hidden="0"` (the default) is omitted; these rows had it explicitly.
    /// Compatibility identity hint; does not create rows by itself.
    #[serde(default)]
    pub row_hidden_explicit_false: Vec<u32>,
    /// Rows with explicit `outlineLevel="0"` for round-trip fidelity.
    /// Normally `outlineLevel="0"` (the default) is omitted; these rows had it explicitly.
    /// Compatibility identity hint; does not create rows by itself.
    #[serde(default)]
    pub row_outline_level_zero: Vec<u32>,
    /// Compatibility identity hint for the imported `<dimension ref="..."/>`.
    /// Export may use it only when it matches current modeled worksheet bounds;
    /// stale imported dimensions must not override generated sheet state.
    pub original_dimension: Option<String>,
    /// Whether the original worksheet had an empty `<extLst/>` element.
    /// Compatibility input only; emitted only when no modeled worksheet
    /// extension owner is present.
    #[serde(default)]
    pub has_empty_ext_lst: bool,
    /// Raw `<extLst>...</extLst>` XML from the worksheet.
    /// Compatibility input only. Known modeled extension owners such as
    /// x14 data validations, conditional formatting, and sparklines are not
    /// replayed from this raw sidecar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
    /// Preserved namespace declarations from the `<worksheet>` root element.
    /// Each entry is (prefix, uri). Used to reconstruct `mc:Ignorable` and
    /// other non-standard namespace attrs for round-trip fidelity.
    #[serde(default)]
    pub preserved_namespace_attrs: Vec<(String, String)>,
    /// Preserved OOXML cell formula metadata (shared, array, dataTable) for round-trip.
    /// Each entry is ((row, col), CellFormula). Stored here because Yrs doesn't track
    /// shared formula grouping — it expands all formulas to individual A1 text.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cell_formulas: Vec<((u32, u32), ooxml_types::worksheet::CellFormula)>,
    /// Raw `<customProperties>...</customProperties>` element from the worksheet.
    /// These are worksheet-level custom property references (with r:id links to binary parts).
    pub custom_properties_xml: Option<String>,
    /// Cells where the `<v>` element had `xml:space="preserve"`.
    /// Stored as (row, col) pairs for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub xml_space_value_cells: Vec<(u32, u32)>,
    /// Explicit blank `<c r="..."/>` cells from the source worksheet.
    ///
    /// The production Yrs store intentionally does not allocate persistent cells
    /// for style-less blanks, but OOXML authors can include explicit blank cell
    /// elements for row span/fidelity reasons. Preserve their positions here so
    /// L2 export can replay them without making sparse Yrs storage dense.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub explicit_blank_cells: Vec<(u32, u32)>,
    /// Imported cells intentionally not materialized into editable storage.
    ///
    /// Dynamic-array spill targets are parser-proven projection outputs, not
    /// user-editable source cells. L2 import may omit them from Yrs storage, but
    /// export must still replay the original cached `<c>` element until a later
    /// edit or recalculation produces a real cell at the same position.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped_storage_cells: Vec<crate::parse_output::CellData>,
    /// Cells where the `<f>` element had `xml:space="preserve"`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub xml_space_formula_cells: Vec<(u32, u32)>,
    /// Cells with `ca="1"` (force recalc / volatile formula flag).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub force_recalc_cells: Vec<(u32, u32)>,
    /// Preserved unknown XML elements from the worksheet as raw XML strings.
    /// Each entry is (position_key, raw_xml) — same format as `workbook_preserved_elements`.
    /// Captures elements like `<sheetPr>` with `<tabColor>` that the parser doesn't model.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_preserved_elements: Vec<(String, String)>,
    /// Raw XML of drawing anchors with content-level `mc:AlternateContent` (e.g., ChartEx).
    /// Each entry is (original_anchor_index, raw_xml) where the index is the position within
    /// the original drawing's anchor list. Used to preserve anchor ordering during round-trip.
    /// The raw_xml is the entire `<xdr:twoCellAnchor>...</xdr:twoCellAnchor>` element.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drawing_anchor_passthroughs: Vec<(usize, String)>,
    /// Clean-imported DrawingML package part and optional relationship sidecar.
    ///
    /// Relationship topology alone is not enough: preserving the sheet
    /// relationship requires preserving or regenerating the target drawing part
    /// as well.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_drawing: Option<ImportedDrawingPart>,
    /// Original drawing root namespace declarations from `<xdr:wsDr>`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drawing_root_namespace_attrs: Vec<(String, String)>,
    /// Original drawing ZIP path when the worksheet relationship identifies it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_drawing_path: Option<String>,
    /// Original OPC relationships from the drawing .rels file.
    /// Used with `add_with_id` to preserve original relationship IDs for chart/chartEx references.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drawing_opc_rels: Vec<OpcRelationship>,
    /// Whether a drawing .rels file existed in the original archive (even if empty).
    /// Some XLSX files contain empty `<Relationships/>` rels files that must be preserved.
    #[serde(default)]
    pub has_drawing_rels_file: bool,
    /// Whether the original `<mergeCells>` element had a `count` attribute.
    /// The attribute is optional per OOXML spec; this preserves the original choice.
    #[serde(default)]
    pub merge_cells_has_count: bool,
}

/// A named binary blob part (path + bytes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlobPart {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpaquePackageOwner {
    #[default]
    Root,
    Workbook,
    Worksheet {
        index: usize,
        path: String,
    },
    Part {
        path: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpaquePackageOwnership {
    #[default]
    CleanImported,
    DirtyImported,
    Generated,
    Deleted,
    OrphanCleanPackageData,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpaqueRelationshipTarget {
    InternalPart { path: String },
    InternalPath { target: String },
    External { target: String },
}

impl Default for OpaqueRelationshipTarget {
    fn default() -> Self {
        Self::InternalPath {
            target: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackageRelationship {
    pub owner: OpaquePackageOwner,
    pub relationship_type: String,
    pub target: OpaqueRelationshipTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackagePart {
    pub part: BlobPart,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_extension: Option<(String, String)>,
    #[serde(default)]
    pub ownership: OpaquePackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackageSubgraph {
    pub owner: OpaquePackageOwner,
    pub owner_relationship: OpaquePackageRelationship,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<OpaquePackagePart>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<OpaquePackageRelationship>,
    #[serde(default)]
    pub ownership: OpaquePackageOwnership,
}

/// A clean-imported worksheet DrawingML part with its optional `.rels` sidecar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImportedDrawingPart {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rels: Option<BlobPart>,
}

/// Typed package sidecar for pivot table/cache round-trip preservation.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotPackageRoundTrip {
    /// Original workbook `<pivotCaches>` entries in document order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_cache_entries: Vec<PivotWorkbookCacheEntry>,
    /// Cache definition packages keyed by cache id/path.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cache_definitions: Vec<PivotCacheDefinitionPackage>,
    /// Sheet-owned pivot table packages.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pivot_tables: Vec<PivotTablePackage>,
    /// Exact content type overrides for pivot package parts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_type_overrides: Vec<PivotPackageContentType>,
    /// Pivot package blobs not claimed by a cache/table graph edge.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub orphan_parts: Vec<PivotOrphanPackagePart>,
}

impl PivotPackageRoundTrip {
    pub fn is_empty(&self) -> bool {
        self.workbook_cache_entries.is_empty()
            && self.cache_definitions.is_empty()
            && self.pivot_tables.is_empty()
            && self.content_type_overrides.is_empty()
            && self.orphan_parts.is_empty()
    }
}

/// Ownership state for a pivot package component.
///
/// State transitions:
/// - API-created pivots are `Generated`.
/// - Imported pivots start as `CleanImported` and stay there through open/save.
/// - Edits to an imported pivot table layout/style/filter make the table package
///   at least `DirtyImported`; cache refresh makes the cache dirty/generated.
/// - Deletion marks the exact imported table package `Deleted`; cache deletion is
///   valid only when no remaining table references the cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotPackageOwnership {
    #[default]
    CleanImported,
    DirtyImported,
    Generated,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotCacheSourceKind {
    #[default]
    Unknown,
    Worksheet,
    External,
    Consolidation,
    Scenario,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotWorkbookCacheEntry {
    pub cache_id: u32,
    pub relationship_id: String,
    pub relationship_target: String,
    pub definition_path: String,
    pub order: usize,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCacheDefinitionPackage {
    pub cache_id: u32,
    pub definition_path: String,
    pub definition_rels_path: Option<String>,
    #[serde(default)]
    pub source_kind: PivotCacheSourceKind,
    #[serde(with = "bytes_serde")]
    pub raw_definition_xml: Vec<u8>,
    #[serde(default)]
    pub raw_relationships: Vec<OpcRelationship>,
    pub records_relationship_id: Option<String>,
    pub records_relationship_target: Option<String>,
    pub records_path: Option<String>,
    #[serde(default, with = "option_bytes")]
    pub raw_records_xml: Option<Vec<u8>>,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTablePackage {
    pub sheet_index: usize,
    pub sheet_name: String,
    pub sheet_relationship_id: String,
    pub sheet_relationship_target: String,
    pub table_path: String,
    pub table_rels_path: Option<String>,
    pub pivot_name: Option<String>,
    #[serde(with = "bytes_serde")]
    pub raw_table_xml: Vec<u8>,
    #[serde(default)]
    pub raw_relationships: Vec<OpcRelationship>,
    pub referenced_cache_id: u32,
    pub order: usize,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotPackageContentType {
    pub part_name: String,
    pub content_type: String,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotOrphanPackagePart {
    pub part: BlobPart,
    pub content_type: Option<String>,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

/// VML drawing part with optional relationships file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VmlDrawingPart {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
    pub rels: Option<VmlRels>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VmlRels {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
}

/// OPC relationship entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpcRelationship {
    pub id: String,
    pub rel_type: String,
    pub target: String,
    pub target_mode: Option<String>,
}

// WorkbookView has moved to domain::workbook (strongly-typed, with From<BookView>).

/// Extension list preservation for forward compatibility.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPreservation {
    pub namespaces: Vec<(String, String)>,
    pub elements: Vec<String>,
}

// Helper modules for Vec<u8> serialization as base64
mod bytes_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(bytes: &Vec<u8>, s: S) -> Result<S::Ok, S::Error> {
        // Serialize as array of numbers for JSON compatibility
        bytes.serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        Vec::<u8>::deserialize(d)
    }
}

mod option_bytes {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(val: &Option<Vec<u8>>, s: S) -> Result<S::Ok, S::Error> {
        val.serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<u8>>, D::Error> {
        Option::<Vec<u8>>::deserialize(d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_context_defaults_missing_pivot_package() {
        let ctx: RoundTripContext = serde_json::from_str(r#"{"sheets":[]}"#).unwrap();
        assert!(ctx.pivot_package.is_empty());
        assert!(ctx.binary_blobs.is_empty());
    }

    #[test]
    fn round_trip_context_serializes_typed_pivot_package() {
        let ctx = RoundTripContext {
            pivot_package: PivotPackageRoundTrip {
                workbook_cache_entries: vec![PivotWorkbookCacheEntry {
                    cache_id: 42,
                    relationship_id: "rId42".to_string(),
                    relationship_target: "pivotCache/pivotCacheDefinition42.xml".to_string(),
                    definition_path: "xl/pivotCache/pivotCacheDefinition42.xml".to_string(),
                    order: 0,
                    ownership: PivotPackageOwnership::CleanImported,
                }],
                ..Default::default()
            },
            ..Default::default()
        };

        let json = serde_json::to_string(&ctx).unwrap();
        let round_tripped: RoundTripContext = serde_json::from_str(&json).unwrap();
        assert_eq!(
            round_tripped.pivot_package.workbook_cache_entries[0].cache_id,
            42
        );
        assert_eq!(
            round_tripped.pivot_package.workbook_cache_entries[0].ownership,
            PivotPackageOwnership::CleanImported
        );
    }

    #[test]
    fn deprecated_package_authority_fields_deserialize_from_legacy_snapshot() {
        let ctx: RoundTripContext = serde_json::from_str(
            r#"{
                "sheets": [{
                    "sheetOpcRels": [{
                        "id": "rIdSheetLegacy",
                        "relType": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
                        "target": "../drawings/drawing99.xml",
                        "targetMode": null
                    }]
                }],
                "contentTypeDefaults": [["bin", "application/octet-stream"]],
                "contentTypeOverrides": [["/xl/legacy.xml", "application/vnd.legacy+xml"]],
                "rootRelationships": [{
                    "id": "rIdRootLegacy",
                    "relType": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
                    "target": "xl/workbook.xml",
                    "targetMode": null
                }],
                "workbookRelationships": [{
                    "id": "rIdWorkbookLegacy",
                    "relType": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
                    "target": "worksheets/sheet99.xml",
                    "targetMode": null
                }],
                "sheetWorkbookRIds": ["rIdWorkbookLegacy"]
            }"#,
        )
        .unwrap();

        assert_eq!(ctx.content_type_defaults.len(), 1);
        assert_eq!(ctx.content_type_overrides.len(), 1);
        assert_eq!(ctx.root_relationships[0].id, "rIdRootLegacy");
        assert_eq!(ctx.workbook_relationships[0].id, "rIdWorkbookLegacy");
        assert_eq!(ctx.sheet_workbook_r_ids, ["rIdWorkbookLegacy"]);
        assert_eq!(ctx.sheets[0].sheet_opc_rels[0].id, "rIdSheetLegacy");
    }

    #[test]
    fn empty_deprecated_package_authority_fields_are_not_serialized() {
        let json = serde_json::to_value(RoundTripContext {
            sheets: vec![SheetRoundTripContext::default()],
            ..Default::default()
        })
        .unwrap();

        let object = json.as_object().unwrap();
        assert!(!object.contains_key("contentTypeDefaults"));
        assert!(!object.contains_key("contentTypeOverrides"));
        assert!(!object.contains_key("rootRelationships"));
        assert!(!object.contains_key("workbookRelationships"));
        assert!(!object.contains_key("sheetWorkbookRIds"));
        assert!(!object.contains_key("rawSharedStringsXml"));
        assert!(!object.contains_key("rawDocPropsCoreXml"));
        assert!(!object.contains_key("rawDocPropsAppXml"));
        assert!(!object.contains_key("rawDocPropsCustomXml"));
        assert!(!object.contains_key("rawMetadataXml"));
        assert!(!object.contains_key("rawPersonsXml"));
        assert!(!object.contains_key("externalLinks"));
        assert!(!object.contains_key("customXmlParts"));
        assert!(!object.contains_key("webExtensionParts"));
        assert!(!object.contains_key("binaryBlobs"));
        assert!(!object.contains_key("extensions"));
        assert!(!object.contains_key("workbookNamespaceAttrs"));
        assert!(!object.contains_key("workbookPreservedElements"));
        assert!(!object.contains_key("docMetadataLabelInfo"));
        let sheet = object["sheets"].as_array().unwrap()[0].as_object().unwrap();
        assert!(!sheet.contains_key("sheetOpcRels"));
    }
}
