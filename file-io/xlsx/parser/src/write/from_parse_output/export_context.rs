use domain_types::ParseOutput;

use super::assembly::{
    ChartEntry, ChartExEntry, DrawingRelationshipGraphEntry, SheetExtras,
    VmlPreviewRelationshipGraphEntry, WorksheetCommentsGraphEntry,
    WorksheetControlPropertyGraphEntry, WorksheetDrawingGraphEntry,
    WorksheetFormControlVmlGraphEntry, WorksheetHeaderFooterVmlGraphEntry,
    WorksheetHyperlinkGraphEntry, WorksheetOleObjectGraphEntry, WorksheetOleVmlGraphEntry,
    WorksheetPrinterSettingsGraphEntry, WorksheetThreadedCommentsGraphEntry,
};
use crate::domain::drawings::write::DrawingWriter;
use crate::domain::styles::write::StylesWriter;
use crate::write::pivot_writer::PivotWriteData;
use crate::write::{SharedStringsWriter, SheetWriter};

pub(super) struct WorkbookPreflight {
    pub(super) output: ParseOutput,
    pub(super) styles_writer: StylesWriter,
    pub(super) shared_strings: SharedStringsWriter,
    pub(super) sheet_writers: Vec<SheetWriter>,
    pub(super) sheet_extras: Vec<SheetExtras>,
    pub(super) all_chart_entries: Vec<Vec<ChartEntry>>,
    pub(super) all_chart_ex_entries: Vec<Vec<ChartExEntry>>,
    pub(super) pivot_data: PivotWriteData,
    pub(super) all_image_blobs: Vec<(String, Vec<u8>)>,
}

pub(super) struct WorksheetRelationshipPlan {
    pub(super) sheet_hyperlink_outputs: Vec<Option<Vec<crate::output::results::HyperlinkOutput>>>,
    pub(super) worksheet_hyperlink_relationships: Vec<WorksheetHyperlinkGraphEntry>,
    pub(super) worksheet_control_property_relationships: Vec<WorksheetControlPropertyGraphEntry>,
    pub(super) worksheet_header_footer_vml_relationships: Vec<WorksheetHeaderFooterVmlGraphEntry>,
    pub(super) worksheet_form_control_vml_relationships: Vec<WorksheetFormControlVmlGraphEntry>,
    pub(super) worksheet_ole_object_relationships: Vec<WorksheetOleObjectGraphEntry>,
    pub(super) worksheet_ole_vml_relationships: Vec<WorksheetOleVmlGraphEntry>,
    pub(super) vml_preview_relationships: Vec<VmlPreviewRelationshipGraphEntry>,
    pub(super) worksheet_drawing_relationships: Vec<WorksheetDrawingGraphEntry>,
    pub(super) drawing_relationships: Vec<DrawingRelationshipGraphEntry>,
    pub(super) chart_auxiliary_relationships:
        Vec<super::assembly::ChartAuxiliaryRelationshipGraphEntry>,
    pub(super) worksheet_printer_settings_relationships: Vec<WorksheetPrinterSettingsGraphEntry>,
    pub(super) worksheet_comments_relationships: Vec<WorksheetCommentsGraphEntry>,
    pub(super) worksheet_threaded_comments_relationships: Vec<WorksheetThreadedCommentsGraphEntry>,
    pub(super) worksheet_table_relationships: Vec<(usize, usize, Option<String>)>,
    pub(super) worksheet_pivot_table_relationships: Vec<(usize, String, String)>,
    pub(super) worksheet_slicer_relationships: Vec<(usize, usize)>,
    pub(super) drawing_xml_data: Vec<Option<Vec<u8>>>,
    pub(super) drawing_writer_data: Vec<Option<DrawingWriter>>,
}
