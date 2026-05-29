use domain_types::ParseOutput;

use super::differential_formats;
use super::export_context::WorkbookPreflight;
use super::sheet_parts;
use super::style_remap::build_style_export_plan;
use crate::write::pivot_writer;

pub(super) fn run(output: &ParseOutput) -> WorkbookPreflight {
    let (remapped_output, registry_dxfs) = differential_formats::remap_for_export(output);
    let mut style_export = build_style_export_plan(&remapped_output);
    style_export.writer.dxfs = registry_dxfs;
    if style_export.writer.dxfs.is_empty() {
        style_export.writer.dxfs = differential_formats::collect(&remapped_output);
    }

    let mut styles_writer = style_export.writer;
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
    shared_strings.set_root_ext_lst_xml(
        remapped_output
            .package_fidelity
            .as_ref()
            .and_then(|metadata| metadata.shared_string_table.as_ref())
            .map(|sst| sst.ext_lst_xml.clone()),
    );
    let sheet_parts::BuiltSheetParts {
        sheet_writers,
        sheet_extras,
        all_chart_entries,
        all_chart_ex_entries,
    } = sheet_parts::build_sheet_parts(
        &remapped_output,
        &mut shared_strings,
        &style_export.remapper,
    );

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
