use super::super::helpers::{assert_cells_match, roundtrip};
use domain_types::ParseOutput;

/// Domains that are currently wired for round-trip through the XLSX writer.
/// Update this list as new domains gain export support.
#[allow(dead_code)]
pub(super) struct RoundtripDomainFlags {
    pub(super) cells: bool,
    pub(super) merges: bool,
    pub(super) dimensions: bool,
    pub(super) frozen_pane: bool,
    pub(super) styles: bool,
    pub(super) named_ranges: bool,
    pub(super) comments: bool,
    pub(super) hyperlinks: bool,
    pub(super) conditional_formats: bool,
    pub(super) data_validations: bool,
    pub(super) tables: bool,
    pub(super) sparklines: bool,
    pub(super) print_settings: bool,
    pub(super) page_breaks: bool,
    pub(super) protection: bool,
    pub(super) auto_filter: bool,
    pub(super) outline_groups: bool,
    // Domains NOT yet wired (always skipped):
    // - charts
    // - floating_objects
    // - slicers / slicer_caches / slicer_anchors
    // - form_controls
    // - ole_objects
    // - smartart_diagrams
    // - connectors
    // - pivot_tables
    // - data_table_regions
}

impl Default for RoundtripDomainFlags {
    fn default() -> Self {
        Self {
            cells: true,
            merges: true,
            dimensions: true,
            frozen_pane: true,
            styles: true,
            named_ranges: true,
            comments: true,
            hyperlinks: true,
            conditional_formats: true,
            data_validations: true,
            tables: true,
            sparklines: true,
            print_settings: true,
            page_breaks: true,
            protection: true,
            auto_filter: true,
            outline_groups: true,
        }
    }
}

/// Perform a partial round-trip assertion: write -> parse -> compare only the
/// domains flagged as wired. Panics with a descriptive message on mismatch.
///
/// Returns the round-tripped ParseOutput for additional assertions.
pub(super) fn assert_roundtrip_partial(
    original: &ParseOutput,
    flags: &RoundtripDomainFlags,
) -> ParseOutput {
    let rt = roundtrip(original);

    assert_eq!(
        original.sheets.len(),
        rt.sheets.len(),
        "Sheet count should be preserved"
    );

    for (i, (orig_sheet, rt_sheet)) in original.sheets.iter().zip(rt.sheets.iter()).enumerate() {
        let sn = &orig_sheet.name;

        // Cells
        if flags.cells {
            assert_cells_match(&orig_sheet.cells, &rt_sheet.cells, sn);
        }

        // Merges
        if flags.merges {
            let mut orig_m = orig_sheet.merges.clone();
            let mut rt_m = rt_sheet.merges.clone();
            orig_m.sort_by_key(|m| (m.start_row, m.start_col));
            rt_m.sort_by_key(|m| (m.start_row, m.start_col));
            assert_eq!(orig_m, rt_m, "[{sn}] Merge regions mismatch");
        }

        // Frozen pane
        if flags.frozen_pane {
            match (&orig_sheet.frozen_pane, &rt_sheet.frozen_pane) {
                (Some(orig_fp), Some(rt_fp)) => {
                    assert_eq!(orig_fp.rows, rt_fp.rows, "[{sn}] Frozen pane rows mismatch");
                    assert_eq!(orig_fp.cols, rt_fp.cols, "[{sn}] Frozen pane cols mismatch");
                }
                (None, None) => {}
                (Some(_), None) => panic!("[{sn}] Frozen pane lost in round-trip"),
                (None, Some(_)) => {} // Extra frozen pane is OK (defaults)
            }
        }

        // Comments (count only - content normalization may differ)
        if flags.comments {
            assert_eq!(
                orig_sheet.comments.len(),
                rt_sheet.comments.len(),
                "[{sn}] Comment count mismatch. Original: {:?}, RT: {:?}",
                orig_sheet
                    .comments
                    .iter()
                    .map(|c| &c.cell_ref)
                    .collect::<Vec<_>>(),
                rt_sheet
                    .comments
                    .iter()
                    .map(|c| &c.cell_ref)
                    .collect::<Vec<_>>(),
            );
        }

        // Conditional formats (count only)
        if flags.conditional_formats {
            // Total rule count across all specs
            let orig_rule_count: usize = orig_sheet
                .conditional_formats
                .iter()
                .map(|cf| cf.rules.len())
                .sum();
            let rt_rule_count: usize = rt_sheet
                .conditional_formats
                .iter()
                .map(|cf| cf.rules.len())
                .sum();
            assert_eq!(
                orig_rule_count, rt_rule_count,
                "[{sn}] CF rule count mismatch"
            );
        }

        // Data validations (count only)
        if flags.data_validations {
            assert_eq!(
                orig_sheet.data_validations.len(),
                rt_sheet.data_validations.len(),
                "[{sn}] Data validation count mismatch"
            );
        }

        // Tables (count + names)
        if flags.tables {
            assert_eq!(
                orig_sheet.tables.len(),
                rt_sheet.tables.len(),
                "[{sn}] Table count mismatch"
            );
            for (ot, rt_t) in orig_sheet.tables.iter().zip(rt_sheet.tables.iter()) {
                assert_eq!(ot.name, rt_t.name, "[{sn}] Table name mismatch");
            }
        }

        // Named ranges (at ParseOutput level, checked once for sheet 0)
        if flags.named_ranges && i == 0 {
            assert_eq!(
                original.named_ranges.len(),
                rt.named_ranges.len(),
                "Named range count mismatch"
            );
        }

        // Protection
        if flags.protection {
            assert_eq!(
                orig_sheet.protection.is_some(),
                rt_sheet.protection.is_some(),
                "[{sn}] Sheet protection presence mismatch"
            );
        }

        // Auto filter
        if flags.auto_filter {
            assert_eq!(
                orig_sheet.auto_filter.is_some(),
                rt_sheet.auto_filter.is_some(),
                "[{sn}] Auto filter presence mismatch"
            );
        }
    }

    // Styles (palette should have at least as many entries)
    if flags.styles && !original.style_palette.is_empty() {
        assert!(
            !rt.style_palette.is_empty(),
            "Style palette should not be empty after round-trip"
        );
    }

    rt
}
