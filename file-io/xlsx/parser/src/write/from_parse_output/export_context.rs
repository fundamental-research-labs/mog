use domain_types::ParseOutput;

use super::assembly::{ChartEntry, ChartExEntry, SheetExtras};
use crate::domain::styles::write::StylesWriter;
use crate::write::pivot_writer::PivotWriteData;
use crate::write::{SharedStringsWriter, SheetWriter};

pub(super) struct WorkbookPreflight {
    pub(super) output: ParseOutput,
    pub(super) styles_writer: StylesWriter,
    pub(super) shared_strings: SharedStringsWriter,
    pub(super) style_remapper: super::style_remap::StyleExportRemapper,
    pub(super) sheet_writers: Vec<SheetWriter>,
    pub(super) sheet_extras: Vec<SheetExtras>,
    pub(super) all_chart_entries: Vec<Vec<ChartEntry>>,
    pub(super) all_chart_ex_entries: Vec<Vec<ChartExEntry>>,
    pub(super) pivot_data: PivotWriteData,
    pub(super) all_image_blobs: Vec<(String, Vec<u8>)>,
}
