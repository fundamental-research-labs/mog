use domain_types::SheetData;

use super::style_remap::StyleExportRemapper;
use crate::write::sheet::SheetWriter;

pub(super) fn apply_rows(
    writer: &mut SheetWriter,
    sheet_data: &SheetData,
    style_remapper: &StyleExportRemapper,
) {
    for row_dim in &sheet_data.dimensions.row_heights {
        let has_height = row_dim.custom_height || row_dim.height > 0.0;
        if has_height {
            if row_dim.custom_height {
                writer.set_row_height(row_dim.row, row_dim.height);
            } else {
                writer.set_row_height_no_custom(row_dim.row, row_dim.height);
            }
            if let Some(height_str) = &row_dim.height_str
                && height_str.parse::<f64>().ok() == Some(row_dim.height)
            {
                writer.set_row_height_str(row_dim.row, height_str.clone());
            }
        }
        if row_dim.hidden || row_dim.explicit_hidden {
            writer.set_row_hidden(row_dim.row, row_dim.hidden);
        }
        if let Some(d) = row_dim.descent {
            writer.set_row_descent(row_dim.row, d);
        }
        if row_dim.custom_format {
            writer.set_row_custom_format(row_dim.row, true);
        }
        if let Some(level) = row_dim.outline_level {
            writer.set_row_outline_level(row_dim.row, level);
        } else if row_dim.explicit_outline_level_zero {
            writer.set_row_outline_level(row_dim.row, 0);
        }
        if let Some(collapsed) = row_dim.collapsed {
            writer.set_row_collapsed(row_dim.row, collapsed);
        }
        if row_dim.thick_top {
            writer.set_row_thick_top(row_dim.row, true);
        }
        if row_dim.thick_bot {
            writer.set_row_thick_bot(row_dim.row, true);
        }
        if row_dim.phonetic {
            writer.set_row_phonetic(row_dim.row, true);
        }
        if let Some(spans) = &row_dim.xml_hints.spans {
            writer.set_row_spans(row_dim.row, spans.clone());
        }
        if row_dim.xml_hints.bare_empty {
            writer.mark_bare_empty_row(row_dim.row);
        }
    }
    for rs in &sheet_data.row_styles {
        if let Some(style_id) = style_remapper.emitted_cell_xf_id(rs.style_id) {
            writer.set_row_style(rs.row, style_id);
        }
    }
}
