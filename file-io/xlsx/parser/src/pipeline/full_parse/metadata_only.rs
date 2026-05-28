use crate::domain::workbook::read::SheetInfo;
use crate::domain::worksheet::read::{
    parse_dimension_ref_with_text, parse_frozen_pane, parse_sheet_format_pr, parse_sheet_views,
    parse_sheet_views_ext_lst,
};
use crate::output::results::FullParsedSheet;
use crate::zip::{XlsxArchive, ZipError};

pub(super) fn append_metadata_only_sheets(
    archive: &XlsxArchive<'_>,
    sheets: &mut Vec<FullParsedSheet>,
    sheet_namespaces: &mut Vec<crate::infra::xml_namespaces::NamespaceMap>,
    sheet_infos: &[SheetInfo],
    parse_cell_count: usize,
    sheet_count: usize,
) -> Result<(), String> {
    for sheet_idx in parse_cell_count..sheet_count {
        let sheet_num = sheet_idx + 1;
        let sheet_info = sheet_infos.get(sheet_idx);
        let sheet_name = sheet_info
            .map(|si| si.name.clone())
            .unwrap_or_else(|| format!("Sheet{}", sheet_num));
        let mut empty_sheet = FullParsedSheet {
            name: sheet_name,
            index: sheet_idx,
            sheet_id: sheet_info.map(|si| si.sheet_id),
            state: sheet_info
                .map(|si| si.state)
                .unwrap_or(crate::domain::workbook::types::SheetState::Visible),
            ..Default::default()
        };

        let metadata_xml = match archive.get_worksheet(sheet_num) {
            Ok(xml) => Some(xml),
            Err(ZipError::FileNotFound(_)) => None,
            Err(e) => return Err(format!("Failed to read worksheet {}: {}", sheet_num, e)),
        };
        if let Some(xml) = metadata_xml {
            let pre_sd = memchr::memmem::find(&xml, b"<sheetData")
                .map(|p| &xml[..p])
                .unwrap_or(&xml);
            empty_sheet.view_options = parse_sheet_views(pre_sd)
                .into_iter()
                .map(crate::output::results::SheetViewOutput::from)
                .collect();
            empty_sheet.sheet_views_ext_lst_xml = parse_sheet_views_ext_lst(pre_sd);
            empty_sheet.worksheet_dimension_ref =
                parse_dimension_ref_with_text(pre_sd).map(|dimension| dimension.ref_range);
            empty_sheet.frozen_pane = parse_frozen_pane(pre_sd);
            let fmt_pr = parse_sheet_format_pr(pre_sd);
            empty_sheet.default_row_height = fmt_pr.default_row_height;
            empty_sheet.default_col_width = fmt_pr.default_col_width;
            empty_sheet.base_col_width = fmt_pr.base_col_width;
            empty_sheet.default_row_descent = fmt_pr.default_row_descent;
            empty_sheet.outline_level_row = fmt_pr.outline_level_row;
            empty_sheet.outline_level_col = fmt_pr.outline_level_col;
            empty_sheet.custom_height = fmt_pr.custom_height;
            empty_sheet.zero_height = fmt_pr.zero_height;
            empty_sheet.thick_top = fmt_pr.thick_top;
            empty_sheet.thick_bottom = fmt_pr.thick_bottom;
        }

        sheets.push(empty_sheet);
        sheet_namespaces.push(Default::default());
    }

    Ok(())
}
