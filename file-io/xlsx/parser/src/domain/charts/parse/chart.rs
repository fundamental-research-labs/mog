//! Chart-level child parsing: pivot formats, legend, and display options.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

use super::super::*;
use super::attrs;
use super::layout;

/// Parse a single `<c:pivotFmt>` element.
///
/// OOXML CT_PivotFmt element order: idx, spPr, txPr, marker, dLbl, extLst.
/// Elements like spPr and txPr also appear nested inside dLbl, so we must
/// parse dLbl first to find its boundary, then only search for direct-child
/// spPr/txPr/marker in the region BEFORE dLbl starts.
pub(super) fn parse_pivot_fmt(xml: &[u8]) -> ooxml_types::charts::PivotFmt {
    let mut pf = ooxml_types::charts::PivotFmt::default();

    if let Some(idx_start) = find_tag_simd(xml, b"idx", 0) {
        pf.idx = parse_val_attr_u32(&xml[idx_start..]);
    }

    // Find dLbl boundary first — spPr/txPr/marker that appear after dLbl
    // are nested children of dLbl, not direct children of pivotFmt.
    let dl_start = find_tag_simd(xml, b"dLbl", 0);
    let direct_end = dl_start.unwrap_or(xml.len());
    let direct_region = &xml[..direct_end];

    if let Some(sp_start) = find_tag_simd(direct_region, b"spPr", 0) {
        let sp_end =
            find_closing_tag(direct_region, b"spPr", sp_start).unwrap_or(direct_region.len());
        pf.sp_pr = Some(parse_shape_properties(&direct_region[sp_start..sp_end]));
    }
    if let Some(txpr_start) = find_tag_simd(direct_region, b"txPr", 0) {
        let txpr_end =
            find_closing_tag(direct_region, b"txPr", txpr_start).unwrap_or(direct_region.len());
        pf.tx_pr = Some(parse_text_body(&direct_region[txpr_start..txpr_end]));
    }
    if let Some(m_start) = find_tag_simd(direct_region, b"marker", 0) {
        let m_end =
            find_closing_tag(direct_region, b"marker", m_start).unwrap_or(direct_region.len());
        pf.marker = Some(parse_marker(&direct_region[m_start..m_end]));
    }
    if let Some(dl_pos) = dl_start {
        let dl_end = find_closing_tag(xml, b"dLbl", dl_pos)
            .and_then(|lt| find_gt_simd(xml, lt).map(|gt| gt + 1))
            .unwrap_or(xml.len());
        pf.d_lbl = Some(parse_individual_data_label(&xml[dl_pos..dl_end]));
    }
    pf.extensions = parse_chart_ext_lst(xml);

    pf
}

/// Parse legend into the canonical `Legend` type from ooxml-types.
pub(super) fn parse_legend(xml: &[u8]) -> Legend {
    let mut legend = Legend::default();

    // Parse position
    if let Some(pos_start) = find_tag_simd(xml, b"legendPos", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[pos_start..], b"val=\"") {
            legend.legend_pos = Some(LegendPosition::from_ooxml(&val));
        }
    }

    // Parse overlay
    if let Some(overlay_start) = find_tag_simd(xml, b"overlay", 0) {
        let val = attrs::parse_bool_attr(&xml[overlay_start..], b"val=\"");
        legend.overlay = Some(val);
    }

    // Parse legend entries
    let mut pos = 0;
    while let Some(entry_start) = find_tag_simd(xml, b"legendEntry", pos) {
        let entry_end = find_closing_tag(xml, b"legendEntry", entry_start).unwrap_or(xml.len());
        let entry_bytes = &xml[entry_start..entry_end];

        let mut entry = LegendEntry::default();

        if let Some(idx_start) = find_tag_simd(entry_bytes, b"idx", 0) {
            if let Some(val) = attrs::parse_u32_attr(&entry_bytes[idx_start..], b"val=\"") {
                entry.idx = val;
            }
        }

        if let Some(delete_start) = find_tag_simd(entry_bytes, b"delete", 0) {
            let val = attrs::parse_bool_attr(&entry_bytes[delete_start..], b"val=\"");
            entry.delete = Some(val);
        }

        if let Some(txpr_start) = find_tag_simd(entry_bytes, b"txPr", 0) {
            let txpr_end =
                find_closing_tag(entry_bytes, b"txPr", txpr_start).unwrap_or(entry_bytes.len());
            entry.tx_pr = Some(parse_text_body(&entry_bytes[txpr_start..txpr_end]));
        }

        legend.legend_entry.push(entry);
        pos = entry_end;
    }

    // Parse layout > manualLayout
    if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
        let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
        let layout = layout::parse_layout(&xml[layout_start..layout_end]);
        // Only store if there's actual content (not an empty <c:layout/>)
        if layout.x.is_some()
            || layout.y.is_some()
            || layout.w.is_some()
            || layout.h.is_some()
            || layout.layout_target.is_some()
            || layout.x_mode.is_some()
            || layout.y_mode.is_some()
            || layout.w_mode.is_some()
            || layout.h_mode.is_some()
        {
            legend.layout = Some(layout);
        }
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", pos) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        legend.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse txPr
    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", pos) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start).unwrap_or(xml.len());
        legend.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    legend
}

/// Parse display options.
pub(super) fn parse_display_options(xml: &[u8], chart_start: usize) -> DisplayOptions {
    let mut opts = DisplayOptions::default();

    if let Some(start) = find_tag_simd(xml, b"plotVisOnly", chart_start) {
        opts.plot_vis_only = Some(attrs::parse_bool_attr_with_default(
            &xml[start..],
            b"val=\"",
            true,
        ));
    }

    if let Some(start) = find_tag_simd(xml, b"dispBlanksAs", chart_start) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            opts.disp_blanks_as = Some(DisplayBlanksAs::from_ooxml(&val));
        }
    }

    if let Some(start) = find_tag_simd(xml, b"showDLblsOverMax", chart_start) {
        opts.show_data_lbls_over_max = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }

    opts
}

#[cfg(test)]
mod tests {
    use super::{parse_display_options, parse_legend};

    #[test]
    fn parse_display_options_preserves_show_data_labels_over_max_absence() {
        let opts = parse_display_options(b"<c:chart></c:chart>", 0);
        assert_eq!(opts.show_data_lbls_over_max, None);
    }

    #[test]
    fn parse_display_options_preserves_plot_visible_only_absence() {
        let opts = parse_display_options(b"<c:chart></c:chart>", 0);
        assert_eq!(opts.plot_vis_only, None);
    }

    #[test]
    fn parse_display_options_preserves_plot_visible_only_explicit_false() {
        let opts = parse_display_options(br#"<c:chart><c:plotVisOnly val="0"/></c:chart>"#, 0);
        assert_eq!(opts.plot_vis_only, Some(false));
    }

    #[test]
    fn parse_display_options_preserves_plot_visible_only_explicit_true() {
        let opts = parse_display_options(br#"<c:chart><c:plotVisOnly val="1"/></c:chart>"#, 0);
        assert_eq!(opts.plot_vis_only, Some(true));
    }

    #[test]
    fn parse_display_options_preserves_plot_visible_only_implicit_true() {
        let opts = parse_display_options(br#"<c:chart><c:plotVisOnly/></c:chart>"#, 0);
        assert_eq!(opts.plot_vis_only, Some(true));
    }

    #[test]
    fn parse_display_options_accepts_plot_visible_only_on_literal() {
        let opts = parse_display_options(br#"<c:chart><c:plotVisOnly val="on"/></c:chart>"#, 0);
        assert_eq!(opts.plot_vis_only, Some(true));
    }

    #[test]
    fn parse_display_options_preserves_show_data_labels_over_max_explicit_false() {
        let opts = parse_display_options(br#"<c:chart><c:showDLblsOverMax val="0"/></c:chart>"#, 0);
        assert_eq!(opts.show_data_lbls_over_max, Some(false));
    }

    #[test]
    fn parse_legend_entry_preserves_text_properties() {
        let legend = parse_legend(
            br#"<c:legend xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <c:legendEntry>
                    <c:idx val="1"/>
                    <c:txPr>
                        <a:bodyPr rot="2520000"/>
                        <a:lstStyle/>
                        <a:p>
                            <a:pPr>
                                <a:defRPr b="1" i="1" sz="4200" u="sng" strike="sngStrike">
                                    <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
                                    <a:latin typeface="Mog chart contract"/>
                                </a:defRPr>
                            </a:pPr>
                        </a:p>
                    </c:txPr>
                </c:legendEntry>
            </c:legend>"#,
        );

        assert_eq!(legend.legend_entry.len(), 1);
        assert_eq!(legend.legend_entry[0].idx, 1);
        assert!(legend.legend_entry[0].delete.is_none());
        assert!(legend.tx_pr.is_none());
        let tx_pr = legend.legend_entry[0].tx_pr.as_ref().unwrap();
        assert_eq!(
            tx_pr.body_props.rot,
            Some(ooxml_types::drawings::StAngle::new(2520000))
        );
        let default_run = tx_pr.paragraphs[0].props.def_run_props.as_ref().unwrap();
        assert_eq!(default_run.size.map(|size| size.value()), Some(4200));
        assert_eq!(default_run.bold, Some(true));
        assert_eq!(default_run.italic, Some(true));
    }
}
