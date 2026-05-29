use crate::domain::workbook::types::WorkbookView;
use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};

/// Parse all `<bookViews><workbookView .../>` elements from workbook.xml.
pub fn parse_workbook_views(xml: &[u8]) -> Vec<WorkbookView> {
    let mut views = Vec::new();
    let mut offset = 0;

    while let Some(tag_start) = find_tag_simd(xml, b"workbookView", offset) {
        let tag_end = find_gt_simd(xml, tag_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let elem_end = if tag_end >= 2 && xml[tag_end - 2] == b'/' {
            tag_end
        } else {
            find_workbook_view_close(xml, tag_end).unwrap_or(tag_end)
        };
        let elem = &xml[tag_start..tag_end];
        let full_elem = &xml[tag_start..elem_end];

        let parse_i32 = |attr: &[u8]| -> Option<i32> {
            find_attr_simd(elem, attr, 0).and_then(|p| {
                let vs = p + attr.len();
                extract_quoted_value(elem, vs)
                    .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
            })
        };
        let parse_u32 = |attr: &[u8]| -> Option<u32> {
            find_attr_simd(elem, attr, 0).and_then(|p| {
                let vs = p + attr.len();
                extract_quoted_value(elem, vs)
                    .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
            })
        };
        let parse_bool = |attr: &[u8], default: bool| -> bool {
            find_attr_simd(elem, attr, 0)
                .and_then(|p| {
                    let vs = p + attr.len();
                    extract_quoted_value(elem, vs)
                        .map(|(s, e)| elem[s..e] == *b"1" || elem[s..e] == *b"true")
                })
                .unwrap_or(default)
        };
        let parse_string = |attr: &[u8]| -> Option<String> {
            find_attr_simd(elem, attr, 0).and_then(|p| {
                let vs = p + attr.len();
                extract_quoted_value(elem, vs)
                    .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok().map(ToOwned::to_owned))
            })
        };

        let mut view = WorkbookView::default();
        view.visibility = parse_string(b"visibility=\"")
            .as_deref()
            .map(|value| ooxml_types::workbook::Visibility::from_bytes(value.as_bytes()))
            .unwrap_or_default();
        view.minimized = parse_bool(b"minimized=\"", false);
        view.x_window = parse_i32(b"xWindow=\"");
        view.y_window = parse_i32(b"yWindow=\"");
        view.window_width = parse_u32(b"windowWidth=\"");
        view.window_height = parse_u32(b"windowHeight=\"");
        view.active_tab = parse_u32(b"activeTab=\"").unwrap_or(0);
        view.first_sheet = parse_u32(b"firstSheet=\"").unwrap_or(0);
        view.show_horizontal_scroll = parse_bool(b"showHorizontalScroll=\"", true);
        view.show_vertical_scroll = parse_bool(b"showVerticalScroll=\"", true);
        view.show_sheet_tabs = parse_bool(b"showSheetTabs=\"", true);
        view.tab_ratio = find_attr_simd(elem, b"tabRatio=\"", 0).and_then(|p| {
            let vs = p + b"tabRatio=\"".len();
            extract_quoted_value(elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse::<f64>().ok())
        });
        view.xr_uid = find_attr_simd(elem, b"xr2:uid=\"", 0).and_then(|p| {
            let vs = p + b"xr2:uid=\"".len();
            extract_quoted_value(elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok().map(|s| s.to_string()))
        });
        view.auto_filter_date_grouping = parse_bool(b"autoFilterDateGrouping=\"", true);
        view.ext_lst =
            extract_direct_ext_lst(full_elem).map(|raw_xml| ooxml_types::ExtensionList {
                raw_xml: Some(raw_xml),
            });

        views.push(view);
        offset = elem_end;
    }

    views
}

fn find_workbook_view_close(xml: &[u8], start: usize) -> Option<usize> {
    let close = b"</workbookView>";
    memchr::memmem::find(&xml[start..], close).map(|pos| start + pos + close.len())
}

fn extract_direct_ext_lst(xml: &[u8]) -> Option<String> {
    let open_end = find_gt_simd(xml, 0)? + 1;
    let close_start = xml.len().saturating_sub(b"</workbookView>".len());
    if close_start <= open_end {
        return None;
    }
    let body = &xml[open_end..close_start];
    let ext_start_rel = find_tag_simd(body, b"extLst", 0)?;
    let ext_start = open_end + ext_start_rel;
    let ext_open_end = find_gt_simd(xml, ext_start)? + 1;
    let ext_end = if ext_open_end >= 2 && xml[ext_open_end - 2] == b'/' {
        ext_open_end
    } else {
        memchr::memmem::find(&xml[ext_open_end..close_start], b"</extLst>")
            .map(|pos| ext_open_end + pos + b"</extLst>".len())?
    };
    std::str::from_utf8(&xml[ext_start..ext_end])
        .ok()
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_multiple_workbook_views_in_order_with_defaults() {
        let xml = br#"<workbook><bookViews>
  <workbookView activeTab="2" firstSheet="1" showHorizontalScroll="0" xr2:uid="{abc}"/>
  <workbookView xWindow="10" yWindow="20" windowWidth="300" windowHeight="400" tabRatio="0.75"/>
</bookViews></workbook>"#;

        let views = parse_workbook_views(xml);
        assert_eq!(views.len(), 2);
        assert_eq!(views[0].active_tab, 2);
        assert_eq!(views[0].first_sheet, 1);
        assert!(!views[0].show_horizontal_scroll);
        assert!(views[0].show_vertical_scroll);
        assert!(views[0].show_sheet_tabs);
        assert_eq!(views[0].xr_uid.as_deref(), Some("{abc}"));
        assert_eq!(views[1].x_window, Some(10));
        assert_eq!(views[1].y_window, Some(20));
        assert_eq!(views[1].window_width, Some(300));
        assert_eq!(views[1].window_height, Some(400));
        assert_eq!(views[1].active_tab, 0);
        assert_eq!(views[1].first_sheet, 0);
        assert_eq!(views[1].tab_ratio, Some(0.75));
        assert!(views[1].show_horizontal_scroll);
        assert!(views[1].show_vertical_scroll);
        assert!(views[1].auto_filter_date_grouping);
    }

    #[test]
    fn parses_visibility_minimized_and_child_ext_lst() {
        let xml = br#"<workbook><bookViews>
  <workbookView visibility="hidden" minimized="1"><extLst><ext uri="{u}"/></extLst></workbookView>
</bookViews></workbook>"#;

        let views = parse_workbook_views(xml);
        assert_eq!(
            views[0].visibility,
            ooxml_types::workbook::Visibility::Hidden
        );
        assert!(views[0].minimized);
        assert_eq!(
            views[0]
                .ext_lst
                .as_ref()
                .and_then(|ext| ext.raw_xml.as_deref()),
            Some("<extLst><ext uri=\"{u}\"/></extLst>")
        );
    }
}
