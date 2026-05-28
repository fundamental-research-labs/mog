use crate::infra::scanner::{find_closing_tag, find_tag_simd};

use super::super::types::*;
use super::{
    borders::parse_borders,
    cell_formats::{parse_cell_styles, parse_cell_xfs},
    colors::parse_colors,
    dxfs::parse_dxfs,
    fills::parse_fills,
    fonts::parse_fonts,
    number_formats::parse_num_fmts,
    table_styles::parse_table_styles,
};

/// Parse styles.xml content
///
/// # Arguments
/// * `xml` - Raw bytes of the styles.xml file
///
/// # Returns
/// Parsed Stylesheet
pub fn parse_styles(xml: &[u8]) -> Stylesheet {
    let mut styles = Stylesheet::default();

    // Parse <numFmts> section for custom number formats
    if let Some(numfmts_start) = find_tag_simd(xml, b"numFmts", 0) {
        let numfmts_end = find_closing_tag(xml, b"numFmts", numfmts_start).unwrap_or(xml.len());

        parse_num_fmts(&mut styles.num_fmts, &xml[numfmts_start..numfmts_end]);
    }

    // Parse <fonts> section
    if let Some(fonts_start) = find_tag_simd(xml, b"fonts", 0) {
        let fonts_end = find_closing_tag(xml, b"fonts", fonts_start).unwrap_or(xml.len());

        parse_fonts(&mut styles.fonts, &xml[fonts_start..fonts_end]);
    }

    // Parse <fills> section
    if let Some(fills_start) = find_tag_simd(xml, b"fills", 0) {
        let fills_end = find_closing_tag(xml, b"fills", fills_start).unwrap_or(xml.len());

        parse_fills(&mut styles.fills, &xml[fills_start..fills_end]);
    }

    // Parse <borders> section
    if let Some(borders_start) = find_tag_simd(xml, b"borders", 0) {
        let borders_end = find_closing_tag(xml, b"borders", borders_start).unwrap_or(xml.len());

        parse_borders(&mut styles.borders, &xml[borders_start..borders_end]);
    }

    // Parse <cellStyleXfs> section (base styles referenced by named styles)
    if let Some(csxfs_start) = find_tag_simd(xml, b"cellStyleXfs", 0) {
        let csxfs_end = find_closing_tag(xml, b"cellStyleXfs", csxfs_start).unwrap_or(xml.len());
        parse_cell_xfs(&mut styles.cell_style_xfs, &xml[csxfs_start..csxfs_end]);
    }

    // Parse <cellXfs> section for cell styles
    if let Some(cellxfs_start) = find_tag_simd(xml, b"cellXfs", 0) {
        let cellxfs_end = find_closing_tag(xml, b"cellXfs", cellxfs_start).unwrap_or(xml.len());
        parse_cell_xfs(&mut styles.cell_xfs, &xml[cellxfs_start..cellxfs_end]);
    }

    // Parse <cellStyles> section (named styles like "Normal", "Percent")
    if let Some(cs_start) = find_tag_simd(xml, b"cellStyles", 0) {
        let cs_end = find_closing_tag(xml, b"cellStyles", cs_start).unwrap_or(xml.len());
        styles.cell_styles = parse_cell_styles(&xml[cs_start..cs_end]);
    }

    // Parse <dxfs> section (differential formatting records)
    if let Some(dxfs_start) = find_tag_simd(xml, b"dxfs", 0) {
        let dxfs_end = find_closing_tag(xml, b"dxfs", dxfs_start).unwrap_or(xml.len());
        styles.dxfs = parse_dxfs(&xml[dxfs_start..dxfs_end]);
    }

    // Parse <colors> section (custom color palette and MRU colors)
    if let Some(colors_start) = find_tag_simd(xml, b"colors", 0) {
        let colors_end = find_closing_tag(xml, b"colors", colors_start).unwrap_or(xml.len());
        let colors = parse_colors(&xml[colors_start..colors_end]);
        if !colors.indexed_colors.is_empty() || !colors.mru_colors.is_empty() {
            styles.colors = Some(colors);
        }
    }

    // Parse <tableStyles> section
    if let Some(ts_start) = find_tag_simd(xml, b"tableStyles", 0) {
        let ts_end = find_closing_tag(xml, b"tableStyles", ts_start).unwrap_or(xml.len());
        let (table_styles, default_table, default_pivot) =
            parse_table_styles(&xml[ts_start..ts_end]);
        styles.table_styles = table_styles;
        styles.default_table_style = default_table;
        styles.default_pivot_style = default_pivot;
    }

    styles
}
