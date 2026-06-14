use super::helpers::capture_namespaces_from_xml;
use crate::domain::workbook::read::SheetPackageContext;
use crate::domain::worksheet::read::{
    parse_dimension_ref_with_text, parse_dimensions, parse_frozen_pane, parse_sheet_format_pr,
    parse_sheet_properties, parse_sheet_views, parse_sheet_views_ext_lst,
};
use crate::infra::xml_namespaces::NamespaceMap;
use crate::output::results::FullParsedSheet;
use crate::zip::{XlsxArchive, ZipError};

pub(super) fn append_metadata_only_sheets(
    archive: &XlsxArchive<'_>,
    sheets: &mut Vec<FullParsedSheet>,
    sheet_namespaces: &mut Vec<NamespaceMap>,
    sheet_package_contexts: &[SheetPackageContext],
) -> Result<(), String> {
    let parsed_sheets = std::mem::take(sheets);
    let mut parsed_namespaces = std::mem::take(sheet_namespaces).into_iter();
    let mut parsed_by_index: Vec<Option<(FullParsedSheet, NamespaceMap)>> =
        std::iter::repeat_with(|| None)
            .take(sheet_package_contexts.len())
            .collect();

    for sheet in parsed_sheets {
        let namespace = parsed_namespaces.next().unwrap_or_default();
        let sheet_idx = sheet.index;
        if let Some(slot) = parsed_by_index.get_mut(sheet_idx) {
            *slot = Some((sheet, namespace));
        }
    }

    for (sheet_idx, sheet_context) in sheet_package_contexts.iter().enumerate() {
        if let Some((sheet, namespace)) = parsed_by_index.get_mut(sheet_idx).and_then(Option::take)
        {
            sheets.push(sheet);
            sheet_namespaces.push(namespace);
            continue;
        }

        let mut empty_sheet = FullParsedSheet {
            name: sheet_context.sheet_name.clone(),
            index: sheet_idx,
            owner_part_path: sheet_context.owner_part_path.clone(),
            sheet_id: sheet_context.sheet_id,
            state: sheet_context.visibility,
            ..Default::default()
        };

        let metadata_xml = match sheet_context.owner_part_path.as_deref() {
            Some(path) => match archive.read_file(path) {
                Ok(xml) => Some(xml),
                Err(ZipError::FileNotFound(_)) => None,
                Err(e) => return Err(format!("Failed to read worksheet {}: {}", path, e)),
            },
            None => None,
        };
        let mut namespace = NamespaceMap::default();
        if let Some(xml) = metadata_xml {
            namespace = capture_namespaces_from_xml(&xml);
            apply_metadata_xml(&mut empty_sheet, &xml);
        }

        sheets.push(empty_sheet);
        sheet_namespaces.push(namespace);
    }

    Ok(())
}

fn apply_metadata_xml(empty_sheet: &mut FullParsedSheet, xml: &[u8]) {
    let pre_sd = memchr::memmem::find(xml, b"<sheetData")
        .map(|p| &xml[..p])
        .unwrap_or(xml);
    let (col_widths, row_heights) = parse_dimensions(xml);
    empty_sheet.col_widths = col_widths;
    empty_sheet.row_heights = row_heights;
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
    empty_sheet.sheet_properties = parse_sheet_properties(pre_sd);
    empty_sheet.outline_properties = empty_sheet
        .sheet_properties
        .as_ref()
        .and_then(|properties| properties.outline_pr.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_only_sheet_preserves_structural_dimensions_for_outlines() {
        let xml = br#"
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
              <sheetPr><outlinePr summaryBelow="1" summaryRight="0"/></sheetPr>
              <dimension ref="A1:I12"/>
              <sheetViews><sheetView workbookViewId="0"/></sheetViews>
              <sheetFormatPr defaultRowHeight="15" outlineLevelRow="1" outlineLevelCol="1"/>
              <cols>
                <col min="5" max="9" width="10.5" hidden="1" outlineLevel="1"/>
              </cols>
              <sheetData>
                <row r="6" outlineLevel="1" hidden="1"/>
                <row r="7" outlineLevel="1" hidden="1"/>
                <row r="8" collapsed="1"/>
              </sheetData>
            </worksheet>
        "#;
        let mut sheet = FullParsedSheet::default();

        apply_metadata_xml(&mut sheet, xml);

        assert_eq!(sheet.col_widths.len(), 1);
        assert_eq!(sheet.col_widths[0].min, 5);
        assert_eq!(sheet.col_widths[0].max, 9);
        assert_eq!(sheet.col_widths[0].outline_level, Some(1));
        assert!(sheet.col_widths[0].hidden);

        assert_eq!(sheet.row_heights.len(), 3);
        assert_eq!(sheet.row_heights[0].row, 5);
        assert_eq!(sheet.row_heights[0].outline_level, Some(1));
        assert_eq!(sheet.row_heights[0].hidden, Some(true));
        assert_eq!(sheet.row_heights[2].row, 7);
        assert_eq!(sheet.row_heights[2].collapsed, Some(true));
        assert_eq!(sheet.outline_level_row, Some(1));
        assert_eq!(sheet.outline_level_col, Some(1));
        assert!(sheet.outline_properties.is_some());
    }
}
