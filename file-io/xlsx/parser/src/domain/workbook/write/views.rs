use crate::write::xml_writer::XmlWriter;

use super::WorkbookView;

/// Write bookViews section.
pub(super) fn write_book_views(w: &mut XmlWriter, workbook_views: &[WorkbookView]) {
    let views = if workbook_views.is_empty() {
        vec![WorkbookView::default()]
    } else {
        workbook_views.to_vec()
    };

    w.start_element("bookViews").end_attrs();

    for view in &views {
        w.start_element("workbookView");

        if view.visibility != ooxml_types::workbook::Visibility::Visible {
            w.attr("visibility", view.visibility.as_str());
        }
        if view.minimized {
            w.attr_bool("minimized", true);
        }
        if let Some(x) = view.x_window {
            w.attr_num("xWindow", x);
        }
        if let Some(y) = view.y_window {
            w.attr_num("yWindow", y);
        }
        if let Some(width) = view.window_width {
            w.attr_num("windowWidth", width);
        }
        if let Some(height) = view.window_height {
            w.attr_num("windowHeight", height);
        }
        if view.first_sheet != 0 {
            w.attr_num("firstSheet", view.first_sheet);
        }
        if view.active_tab != 0 {
            w.attr_num("activeTab", view.active_tab);
        }
        if let Some(ratio) = view.tab_ratio {
            w.attr_num("tabRatio", ratio);
        }
        if !view.show_horizontal_scroll {
            w.attr_bool("showHorizontalScroll", false);
        }
        if !view.show_vertical_scroll {
            w.attr_bool("showVerticalScroll", false);
        }
        if !view.show_sheet_tabs {
            w.attr_bool("showSheetTabs", false);
        }
        if !view.auto_filter_date_grouping {
            w.attr_bool("autoFilterDateGrouping", false);
        }
        if let Some(uid) = &view.xr_uid {
            w.attr("xr2:uid", uid);
        }

        if let Some(raw) = view.ext_lst.as_ref().and_then(|ext| ext.raw_xml.as_ref()) {
            w.end_attrs();
            if !crate::infra::xml::raw_xml_contains_relationship_attr(raw) {
                w.raw_str(raw);
            }
            w.end_element("workbookView");
        } else {
            w.self_close();
        }
    }

    w.end_element("bookViews");
}
