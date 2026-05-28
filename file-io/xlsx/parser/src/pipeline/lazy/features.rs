use crate::domain::cond_format::read::parse_conditional_formats;
use crate::domain::validation::read::parse_data_validations;
use crate::domain::worksheet::read::{
    parse_dimensions, parse_frozen_pane, parse_merge_cells, parse_sheet_views,
};
use crate::zip::constants::{MAX_MERGES, MAX_VALIDATIONS};

use super::format::{format_hyperlinks, format_print_settings, format_protection};
use super::limits::ensure_lazy_limit;
use super::{ParseError, ParsedSheet};

pub(super) fn hydrate_sheet_features(
    parsed: &mut ParsedSheet,
    worksheet_xml: &[u8],
) -> Result<(), ParseError> {
    parsed.merges = parse_merge_cells(worksheet_xml);
    ensure_lazy_limit("merge", parsed.merges.len(), MAX_MERGES)?;

    parsed.conditional_formats = parse_conditional_formats(worksheet_xml).0;

    let (dvs, _disable_prompts) = parse_data_validations(worksheet_xml);
    ensure_lazy_limit("data validation", dvs.len(), MAX_VALIDATIONS)?;
    parsed.data_validations = dvs;

    parsed.hyperlinks = format_hyperlinks(worksheet_xml);
    parsed.protection = format_protection(worksheet_xml);

    let (ps, pb) = format_print_settings(worksheet_xml);
    parsed.print_settings = ps;
    parsed.page_breaks = pb;

    parsed.frozen_pane = parse_frozen_pane(worksheet_xml);
    parsed.view_options = parse_sheet_views(worksheet_xml);

    let (col_widths, row_heights) = parse_dimensions(worksheet_xml);
    parsed.col_widths = col_widths;
    parsed.row_heights = row_heights;

    Ok(())
}
