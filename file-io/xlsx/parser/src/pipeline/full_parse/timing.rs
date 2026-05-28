use crate::output::results::ParseTimings;

#[derive(Default)]
pub(super) struct WorksheetTimingAccumulators {
    pub(super) zip_decompress_us: f64,
    pub(super) cell_parse_us: f64,
    pub(super) cell_convert_us: f64,
    pub(super) postprocess_us: f64,
    pub(super) auxiliary_us: f64,
    pub(super) auxiliary_zip_io_us: f64,
    pub(super) merge_us: f64,
    pub(super) conditional_format_us: f64,
    pub(super) data_validation_us: f64,
    pub(super) hyperlinks_us: f64,
    pub(super) protection_us: f64,
    pub(super) print_us: f64,
    pub(super) frozen_pane_us: f64,
    pub(super) dimensions_us: f64,
    pub(super) sparklines_us: f64,
    pub(super) comments_zip_us: f64,
    pub(super) tables_zip_us: f64,
    pub(super) pivots_zip_us: f64,
    pub(super) charts_zip_us: f64,
    pub(super) smartart_zip_us: f64,
    pub(super) slicers_zip_us: f64,
    pub(super) form_controls_zip_us: f64,
    pub(super) ole_zip_us: f64,
    pub(super) connectors_zip_us: f64,
    pub(super) rels_vml_zip_us: f64,
}

impl WorksheetTimingAccumulators {
    pub(super) fn write_to(self, timings: &mut ParseTimings) {
        timings.ws_zip_decompress_us = self.zip_decompress_us;
        timings.ws_cell_parse_us = self.cell_parse_us;
        timings.ws_cell_convert_us = self.cell_convert_us;
        timings.ws_postprocess_us = self.postprocess_us;
        timings.ws_auxiliary_us = self.auxiliary_us;
        timings.ws_aux_zip_io_us = self.auxiliary_zip_io_us;
        timings.ws_aux_merge_us = self.merge_us;
        timings.ws_aux_cond_fmt_us = self.conditional_format_us;
        timings.ws_aux_data_val_us = self.data_validation_us;
        timings.ws_aux_hyperlinks_us = self.hyperlinks_us;
        timings.ws_aux_protection_us = self.protection_us;
        timings.ws_aux_print_us = self.print_us;
        timings.ws_aux_frozen_pane_us = self.frozen_pane_us;
        timings.ws_aux_dimensions_us = self.dimensions_us;
        timings.ws_aux_sparklines_us = self.sparklines_us;
        timings.aux_zip_comments_us = self.comments_zip_us;
        timings.aux_zip_tables_us = self.tables_zip_us;
        timings.aux_zip_pivots_us = self.pivots_zip_us;
        timings.aux_zip_charts_us = self.charts_zip_us;
        timings.aux_zip_smartart_us = self.smartart_zip_us;
        timings.aux_zip_slicers_us = self.slicers_zip_us;
        timings.aux_zip_form_controls_us = self.form_controls_zip_us;
        timings.aux_zip_ole_us = self.ole_zip_us;
        timings.aux_zip_connectors_us = self.connectors_zip_us;
        timings.aux_zip_rels_vml_us = self.rels_vml_zip_us;
    }
}
