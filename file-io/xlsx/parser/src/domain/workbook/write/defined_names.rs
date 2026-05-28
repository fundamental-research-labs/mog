use crate::write::xml_writer::XmlWriter;

use super::DefinedNameDef;

/// Write definedNames section.
///
/// Emits all OOXML CT_DefinedName attributes for full round-trip fidelity.
/// Attribute order follows the XSD sequence: name, comment, customMenu,
/// description, help, statusBar, localSheetId, hidden, function,
/// vbProcedure, xlm, functionGroupId, shortcutKey, publishToServer,
/// workbookParameter.
pub(super) fn write_defined_names(w: &mut XmlWriter, defined_names: &[DefinedNameDef]) {
    if defined_names.is_empty() {
        return;
    }

    w.start_element("definedNames").end_attrs();

    for def in defined_names {
        w.start_element("definedName").attr("name", &def.name);

        if let Some(comment) = &def.comment {
            w.attr("comment", comment);
        }
        if let Some(custom_menu) = &def.custom_menu {
            w.attr("customMenu", custom_menu);
        }
        if let Some(description) = &def.description {
            w.attr("description", description);
        }
        if let Some(help) = &def.help {
            w.attr("help", help);
        }
        if let Some(status_bar) = &def.status_bar {
            w.attr("statusBar", status_bar);
        }
        if let Some(sheet_id) = def.local_sheet_id {
            w.attr_num("localSheetId", sheet_id);
        }
        if def.hidden {
            w.attr_bool("hidden", true);
        }
        if def.function {
            w.attr_bool("function", true);
        }
        if def.vb_procedure {
            w.attr_bool("vbProcedure", true);
        }
        if def.xlm {
            w.attr_bool("xlm", true);
        }
        if let Some(function_group_id) = def.function_group_id {
            w.attr_num("functionGroupId", function_group_id);
        }
        if let Some(shortcut_key) = &def.shortcut_key {
            w.attr("shortcutKey", shortcut_key);
        }
        if def.publish_to_server {
            w.attr_bool("publishToServer", true);
        }
        if def.workbook_parameter {
            w.attr_bool("workbookParameter", true);
        }
        if def.xml_space_preserve {
            w.attr("xml:space", "preserve");
        }

        w.end_attrs().text(&def.value).end_element("definedName");
    }

    w.end_element("definedNames");
}
