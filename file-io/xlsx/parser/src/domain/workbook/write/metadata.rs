use crate::write::xml_writer::XmlWriter;
use domain_types::domain::workbook::{
    FileSharing, FileVersion, WorkbookProperties, WorkbookWebPublishing,
};

use super::attrs::{object_display_mode_to_xml, update_links_to_xml};

pub(super) fn write_file_version(w: &mut XmlWriter, file_version: Option<&FileVersion>) {
    let Some(file_version) = file_version else {
        return;
    };

    w.start_element("fileVersion")
        .attr_if("appName", file_version.app_name.as_deref())
        .attr_if("lastEdited", file_version.last_edited.as_deref())
        .attr_if("lowestEdited", file_version.lowest_edited.as_deref())
        .attr_if("rupBuild", file_version.rup_build.as_deref())
        .attr_if("codeName", file_version.code_name.as_deref())
        .self_close();
}

pub(super) fn write_file_sharing(w: &mut XmlWriter, file_sharing: Option<&FileSharing>) {
    let Some(file_sharing) = file_sharing else {
        return;
    };

    let mut elem = w.start_element("fileSharing");
    if file_sharing.read_only_recommended {
        elem = elem.attr_bool("readOnlyRecommended", true);
    }
    elem.attr_if("userName", file_sharing.user_name.as_deref())
        .attr_if(
            "reservationPassword",
            file_sharing.reservation_password.as_deref(),
        )
        .attr_if("algorithmName", file_sharing.algorithm_name.as_deref())
        .attr_if("hashValue", file_sharing.hash_value.as_deref())
        .attr_if("saltValue", file_sharing.salt_value.as_deref())
        .attr_num_if("spinCount", file_sharing.spin_count)
        .self_close();
}

pub(super) fn write_workbook_properties(
    w: &mut XmlWriter,
    workbook_properties: Option<&WorkbookProperties>,
) {
    let Some(properties) = workbook_properties else {
        return;
    };
    let defaults = WorkbookProperties::default();

    let mut elem = w.start_element("workbookPr");
    if properties.date1904 != defaults.date1904 {
        elem = elem.attr_bool("date1904", properties.date1904);
    }
    if properties.show_objects != defaults.show_objects {
        elem = elem.attr(
            "showObjects",
            object_display_mode_to_xml(properties.show_objects),
        );
    }
    if properties.show_border_unselected_tables != defaults.show_border_unselected_tables {
        elem = elem.attr_bool(
            "showBorderUnselectedTables",
            properties.show_border_unselected_tables,
        );
    }
    if properties.filter_privacy != defaults.filter_privacy {
        elem = elem.attr_bool("filterPrivacy", properties.filter_privacy);
    }
    if properties.prompted_solutions != defaults.prompted_solutions {
        elem = elem.attr_bool("promptedSolutions", properties.prompted_solutions);
    }
    if properties.show_ink_annotation != defaults.show_ink_annotation {
        elem = elem.attr_bool("showInkAnnotation", properties.show_ink_annotation);
    }
    if properties.backup_file != defaults.backup_file {
        elem = elem.attr_bool("backupFile", properties.backup_file);
    }
    if properties.save_external_link_values != defaults.save_external_link_values {
        elem = elem.attr_bool(
            "saveExternalLinkValues",
            properties.save_external_link_values,
        );
    }
    if properties.update_links != defaults.update_links {
        elem = elem.attr("updateLinks", update_links_to_xml(properties.update_links));
    }
    elem = elem.attr_if("codeName", properties.code_name.as_deref());
    if properties.hide_pivot_field_list != defaults.hide_pivot_field_list {
        elem = elem.attr_bool("hidePivotFieldList", properties.hide_pivot_field_list);
    }
    if properties.show_pivot_chart_filter != defaults.show_pivot_chart_filter {
        elem = elem.attr_bool("showPivotChartFilter", properties.show_pivot_chart_filter);
    }
    if properties.allow_refresh_query != defaults.allow_refresh_query {
        elem = elem.attr_bool("allowRefreshQuery", properties.allow_refresh_query);
    }
    if properties.publish_items != defaults.publish_items {
        elem = elem.attr_bool("publishItems", properties.publish_items);
    }
    if properties.check_compatibility != defaults.check_compatibility {
        elem = elem.attr_bool("checkCompatibility", properties.check_compatibility);
    }
    if properties.auto_compress_pictures != defaults.auto_compress_pictures {
        elem = elem.attr_bool("autoCompressPictures", properties.auto_compress_pictures);
    }
    if properties.refresh_all_connections != defaults.refresh_all_connections {
        elem = elem.attr_bool("refreshAllConnections", properties.refresh_all_connections);
    }
    elem.attr_num_if("defaultThemeVersion", properties.default_theme_version)
        .self_close();
}

pub(super) fn write_web_publishing(
    w: &mut XmlWriter,
    web_publishing: Option<&WorkbookWebPublishing>,
) {
    let Some(web_publishing) = web_publishing else {
        return;
    };

    let mut elem = w.start_element("webPublishing");
    if let Some(value) = web_publishing.css {
        elem = elem.attr_bool("css", value);
    }
    if let Some(value) = web_publishing.thicket {
        elem = elem.attr_bool("thicket", value);
    }
    if let Some(value) = web_publishing.long_file_names {
        elem = elem.attr_bool("longFileNames", value);
    }
    if let Some(value) = web_publishing.vml {
        elem = elem.attr_bool("vml", value);
    }
    if let Some(value) = web_publishing.allow_png {
        elem = elem.attr_bool("allowPng", value);
    }
    if let Some(value) = web_publishing.target_screen_size {
        elem = elem.attr("targetScreenSize", value.to_ooxml());
    }
    elem = elem.attr_num_if("dpi", web_publishing.dpi);
    elem = elem.attr_num_if("codePage", web_publishing.code_page);
    elem.attr_if("characterSet", web_publishing.character_set.as_deref())
        .self_close();
}
