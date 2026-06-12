use super::form_control_export_plan::FormControlExportDiagnostic;
use super::ole_objects::OleObjectExport;
use super::worksheet_custom_properties;

/// Per-sheet extra data needed for ZIP assembly (comments, tables, rels).
pub(super) struct SheetExtras {
    /// (comments_xml, vml_xml) if the sheet has comments.
    pub(super) comments: Option<(Vec<u8>, Vec<u8>)>,
    /// Threaded comment XML (xl/threadedComments/threadedComment{N}.xml) if this sheet
    /// has comments with thread_id set.
    pub(super) threaded_comments: Option<Vec<u8>>,
    /// Table XML bytes, one per table. Index is local to this sheet.
    pub(super) tables: Vec<Vec<u8>>,
    /// Source table specs corresponding to `tables`.
    pub(super) source_tables: Vec<domain_types::TableSpec>,
    /// Whether this sheet has external hyperlinks (needs rels).
    pub(super) has_external_hyperlinks: bool,
    /// Whether this sheet has standard charts that need drawing.
    pub(super) has_charts: bool,
    /// Whether this sheet has ChartEx (modern) charts that need drawing.
    pub(super) has_chart_ex: bool,
    /// Whether this sheet has floating objects (images, shapes, etc.) that need drawing.
    pub(super) has_floating_objects: bool,
    /// Original comment ZIP path from round-trip context (e.g. "xl/comments6.xml").
    /// When set, this path is used instead of sequential numbering.
    pub(super) original_comment_path: Option<String>,
    pub(super) original_comment_relationship_id: Option<String>,
    /// Original VML drawing ZIP path from round-trip context.
    pub(super) original_vml_path: Option<String>,
    pub(super) original_vml_relationship_id: Option<String>,
    pub(super) original_threaded_comments_path: Option<String>,
    pub(super) original_threaded_comments_relationship_id: Option<String>,
    /// Original drawing ZIP path from round-trip context (e.g. "xl/drawings/drawing1.xml").
    /// When set, this path is used instead of sequential numbering.
    pub(super) original_drawing_path: Option<String>,
    pub(super) original_drawing_relationship_id: Option<String>,
    /// Parsed header/footer image VML data (from legacyDrawingHF).
    /// Stored as domain types — the writer generates VML XML from these.
    pub(super) hf_vml: Option<crate::domain::print::hf_images::ParsedHfVml>,
    /// Whether this sheet references a printer settings binary (pageSetup r:id).
    pub(super) has_printer_settings: bool,
    /// Form controls for this sheet (converted from domain types).
    pub(super) form_controls: Vec<crate::domain::controls::types::FormControl>,
    /// Shape-ID planning diagnostics for form-control package artifacts.
    #[allow(dead_code)]
    pub(super) form_control_diagnostics: Vec<FormControlExportDiagnostic>,
    /// OLE objects for this sheet (converted from floating-object state).
    pub(super) ole_objects: Vec<OleObjectExport>,
    /// Clean imported worksheet custom property sidecars.
    pub(super) custom_properties: Option<worksheet_custom_properties::WorksheetCustomProperties>,
}

/// Per-chart data needed during ZIP assembly. Includes the original ChartSpec
/// reference index so we can retrieve position/size for drawing anchors.
pub(super) struct ChartEntry {
    /// Global 1-based chart index (for xl/charts/chart{N}.xml path).
    pub(super) global_idx: usize,
    /// Index into the original `sheet_data.charts` Vec.
    pub(super) source_idx: usize,
    /// Serialized chart XML bytes.
    pub(super) xml: Vec<u8>,
}

/// Per-ChartEx data needed during ZIP assembly.
pub(super) struct ChartExEntry {
    /// Global 1-based chart-ex index (for xl/charts/chartEx{N}.xml path).
    pub(super) global_idx: usize,
    /// Index into the original `sheet_data.charts` Vec.
    pub(super) source_idx: usize,
    /// Serialized ChartEx XML bytes.
    pub(super) xml: Vec<u8>,
}
pub(super) struct WorksheetCommentsGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) comments_path: String,
    pub(super) comments_target: String,
    pub(super) comments_relationship_id_hint: Option<String>,
    pub(super) vml_path: String,
    pub(super) vml_target: String,
    pub(super) vml_relationship_id_hint: Option<String>,
}

pub(super) struct WorksheetHyperlinkGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) hyperlink_idx: usize,
    pub(super) target: String,
    pub(super) target_mode: Option<String>,
    pub(super) relationship_id_hint: Option<String>,
}

pub(super) struct WorksheetTableGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) path: String,
    pub(super) target: String,
    pub(super) relationship_id_hint: Option<String>,
}

pub(super) struct WorksheetControlPropertyGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) global_idx: usize,
    pub(super) target: String,
    pub(super) relationship_id_hint: String,
}

pub(super) struct WorksheetCustomPropertyGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) path: String,
    pub(super) target: String,
    pub(super) relationship_id_hint: String,
}

pub(super) struct WorksheetHeaderFooterVmlGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) path: String,
    pub(super) target: String,
    pub(super) relationship_id_hint: Option<String>,
}

pub(super) struct WorksheetFormControlVmlGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) path: String,
    pub(super) target: String,
    pub(super) relationship_id_hint: Option<String>,
}

pub(super) struct WorksheetOleObjectGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) ole_idx: usize,
    pub(super) embedding_path: String,
    pub(super) embedding_content_type: String,
    pub(super) embedding_relationship_type: String,
    pub(super) target: String,
    pub(super) relationship_id_hint: Option<String>,
}

pub(super) struct WorksheetOleVmlGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) path: String,
    pub(super) target: String,
    pub(super) relationship_id_hint: Option<String>,
}

pub(super) struct VmlPreviewRelationshipGraphEntry {
    pub(super) vml_path: String,
    pub(super) preview_path: String,
    pub(super) relationship_id_hint: String,
}

pub(super) struct WorksheetDrawingGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) path: String,
    pub(super) target: String,
    pub(super) relationship_id_hint: Option<String>,
}

pub(super) struct DrawingRelationshipGraphEntry {
    pub(super) drawing_path: String,
    pub(super) rel_type: String,
    pub(super) target_path: String,
    pub(super) target_mode: Option<String>,
    pub(super) relationship_id_hint: String,
}

pub(super) struct ChartAuxiliaryRelationshipGraphEntry {
    pub(super) chart_path: String,
    pub(super) rel_type: String,
    pub(super) target_path: String,
    pub(super) relationship_id_hint: String,
}

pub(super) struct WorksheetPrinterSettingsGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) path: String,
    pub(super) target: String,
    pub(super) relationship_id_hint: String,
    pub(super) bytes: Vec<u8>,
    pub(super) content_type: String,
}

pub(super) struct WorksheetThreadedCommentsGraphEntry {
    pub(super) sheet_idx: usize,
    pub(super) path: String,
    pub(super) target: String,
    pub(super) relationship_id_hint: Option<String>,
}
