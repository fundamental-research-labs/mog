use crate::write::xml_writer::XmlWriter;

use super::borders::write_borders;
use super::cell_styles::write_cell_styles;
use super::colors::write_colors;
use super::dxfs::write_dxfs;
use super::fills::write_fills;
use super::fonts::write_fonts;
use super::number_formats::write_num_fmts;
use super::table_styles::write_table_styles;
use super::writer::StylesWriter;
use super::xfs::{write_cell_style_xfs, write_cell_xfs};

/// Spreadsheet ML namespace
const SPREADSHEET_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const MC_NS: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const X14AC_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac";

pub(super) fn write_stylesheet(styles: &StylesWriter) -> Vec<u8> {
    let mut w = XmlWriter::new();

    w.write_declaration();

    use crate::write::mc_builder::McIgnorableBuilder;
    let mut mc_builder = McIgnorableBuilder::new();
    if let Some(ref ignorable) = styles.root_namespaces.mce_attributes().ignorable {
        mc_builder.add_preserved_ignorable(ignorable, None);
    }
    if styles.known_fonts {
        mc_builder.add("x14ac");
    }
    if styles.root_namespaces.mce_attributes().ignorable.is_none() {
        for prefix in styles.root_namespaces.ignorable_prefixes() {
            mc_builder.add(prefix);
        }
    }

    w.start_element("styleSheet").attr("xmlns", SPREADSHEET_NS);

    let ignorable_value = mc_builder.build();
    let root_has_mc = styles.root_namespaces.has_prefix("mc");
    let root_has_x14ac = styles.root_namespaces.has_prefix("x14ac");

    if !mc_builder.is_empty() && !root_has_mc {
        w.attr("xmlns:mc", MC_NS);
    }

    if styles.known_fonts && !root_has_x14ac {
        w.attr("xmlns:x14ac", X14AC_NS);
    }

    for (prefix, uri) in styles.root_namespaces.prefixed_attrs() {
        if prefix == "mc" {
            w.attr("xmlns:mc", uri);
            if !mc_builder.is_empty() {
                if let Some(ref ignorable) = ignorable_value {
                    w.attr("mc:Ignorable", ignorable);
                }
            }
            continue;
        }
        if prefix == "x14ac" && styles.known_fonts && !root_has_x14ac {
            continue;
        }
        w.attr(&format!("xmlns:{}", prefix), uri);
    }

    if !root_has_mc {
        if let Some(ref ignorable) = ignorable_value {
            w.attr("mc:Ignorable", ignorable);
        }
    }

    w.end_attrs();

    if !styles.num_fmts.is_empty() {
        write_num_fmts(&mut w, &styles.num_fmts);
    }

    write_fonts(&mut w, &styles.fonts, styles.known_fonts);
    write_fills(&mut w, &styles.fills);
    write_borders(&mut w, &styles.borders);
    write_cell_style_xfs(&mut w, &styles.cell_style_xfs);
    write_cell_xfs(&mut w, &styles.cell_xfs);
    write_cell_styles(&mut w, &styles.cell_styles);
    write_dxfs(&mut w, &styles.dxfs);
    write_table_styles(
        &mut w,
        &styles.table_styles,
        styles.default_table_style.as_deref(),
        styles.default_pivot_style.as_deref(),
    );

    if let Some(ref colors) = styles.colors {
        if !colors.indexed_colors.is_empty() || !colors.mru_colors.is_empty() {
            write_colors(&mut w, colors);
        }
    }

    w.end_element("styleSheet");

    w.finish()
}
