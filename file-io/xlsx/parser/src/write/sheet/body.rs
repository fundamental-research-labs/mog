use super::{SheetWriter, hyperlinks, raw_sections, relationships, sheet_data};
use crate::domain::worksheet::write::{
    write_cols, write_dimension_ref, write_dimensions, write_merge_cells, write_sheet_calc_pr,
    write_sheet_format_pr, write_sheet_properties, write_sheet_views,
};
use crate::write::xml_writer::XmlWriter;
use domain_types::WorksheetSemanticXml;

pub(super) fn write_worksheet_body(w: &mut XmlWriter, sheet: &SheetWriter) {
    write_sheet_properties(w, sheet.sheet_properties.as_ref());
    if let Some(dimension_ref) = &sheet.dimension_ref {
        write_dimension_ref(w, dimension_ref);
    } else {
        write_dimensions(w, sheet_data::calculate_dimension(sheet));
    }
    write_sheet_views(
        w,
        &sheet.sheet_views,
        sheet.sheet_views_ext_lst_xml.as_deref(),
    );
    write_sheet_format_pr(w, &sheet.sheet_format_pr);
    write_cols(w, &sheet.cols);
    sheet_data::write_sheet_data(w, sheet);

    if let Some(sheet_calc_pr) = &sheet.sheet_calc_pr {
        write_sheet_calc_pr(w, sheet_calc_pr);
    } else {
        write_semantic_container(w, &sheet.worksheet_semantic_containers.sheet_calc_pr);
    }
    raw_sections::write_raw_section(w, &sheet.sheet_protection_xml);
    write_semantic_container(w, &sheet.worksheet_semantic_containers.protected_ranges);
    write_semantic_container(w, &sheet.worksheet_semantic_containers.scenarios);
    raw_sections::write_raw_section(w, &sheet.auto_filter_xml);
    raw_sections::write_raw_section(w, &sheet.sort_state_xml);
    write_semantic_container(w, &sheet.worksheet_semantic_containers.data_consolidate);
    write_semantic_container(w, &sheet.worksheet_semantic_containers.custom_sheet_views);
    write_merge_cells(w, &sheet.merges);
    write_semantic_container(w, &sheet.worksheet_semantic_containers.phonetic_pr);
    raw_sections::write_raw_section(w, &sheet.conditional_formatting_xml);
    raw_sections::write_raw_section(w, &sheet.data_validations_xml);
    hyperlinks::write_hyperlinks(w, &sheet.hyperlinks);

    if let Some(ref pw) = sheet.print_writer {
        pw.write_to(w);
    }

    raw_sections::write_raw_section(w, &sheet.custom_properties_xml);
    write_semantic_container(w, &sheet.worksheet_semantic_containers.cell_watches);
    write_semantic_container(w, &sheet.worksheet_semantic_containers.ignored_errors);
    write_semantic_container(w, &sheet.worksheet_semantic_containers.smart_tags);
    relationships::write_drawing(w, &sheet.drawing_r_id);
    relationships::write_legacy_drawing(w, &sheet.legacy_drawing_r_id);
    relationships::write_legacy_drawing_hf(w, &sheet.legacy_drawing_hf_r_id);
    raw_sections::write_raw_section(w, &sheet.ole_objects_xml);
    raw_sections::write_raw_section(w, &sheet.controls_xml);
    raw_sections::write_raw_section(w, &sheet.table_parts_xml);
    relationships::write_pivot_table_definitions(w, &sheet.pivot_table_r_ids);
    raw_sections::write_raw_section(w, &sheet.ext_lst_xml);
}

pub(super) fn write_semantic_container(
    w: &mut XmlWriter,
    container: &Option<WorksheetSemanticXml>,
) {
    if let Some(container) = container
        && !container.raw_xml.is_empty()
    {
        w.raw_str(&container.raw_xml);
    }
}
