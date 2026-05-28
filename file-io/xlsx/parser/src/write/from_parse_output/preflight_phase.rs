use domain_types::ParseOutput;

use super::differential_formats;
use super::export_context::WorkbookPreflight;
use super::sheet_parts;
use super::styles::{build_styles, output_references_style_ids};
use crate::write::pivot_writer;

pub(super) fn run(output: &ParseOutput) -> WorkbookPreflight {
    let (remapped_output, registry_dxfs) = differential_formats::remap_for_export(output);

    let has_style_references = output_references_style_ids(&remapped_output);
    let style_palette_for_export = if has_style_references {
        remapped_output.style_palette.as_slice()
    } else {
        &[]
    };

    let mut styles_writer = build_styles(style_palette_for_export);
    styles_writer.dxfs = registry_dxfs;
    if styles_writer.dxfs.is_empty() {
        styles_writer.dxfs = differential_formats::collect(&remapped_output);
    }
    if styles_writer.table_styles.is_empty() {
        styles_writer.table_styles = remapped_output.custom_table_styles.clone();
    }
    if styles_writer.default_table_style.is_none() {
        styles_writer.default_table_style = remapped_output.default_table_style.clone();
    }
    if styles_writer.default_pivot_style.is_none() {
        styles_writer.default_pivot_style = remapped_output.default_pivot_style.clone();
    }

    let mut shared_strings = sheet_parts::build_shared_strings(&remapped_output);
    let sheet_parts::BuiltSheetParts {
        sheet_writers,
        sheet_extras,
        all_chart_entries,
        all_chart_ex_entries,
    } = sheet_parts::build_sheet_parts(&remapped_output, &mut shared_strings);

    let pivot_data = pivot_writer::build_pivot_data(&remapped_output);

    WorkbookPreflight {
        output: remapped_output,
        styles_writer,
        shared_strings,
        sheet_writers,
        sheet_extras,
        all_chart_entries,
        all_chart_ex_entries,
        pivot_data,
        all_image_blobs: Vec::new(),
    }
}

