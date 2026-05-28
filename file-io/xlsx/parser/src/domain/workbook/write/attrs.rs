use domain_types::domain::workbook::{ObjectDisplayMode, UpdateLinks};

use super::SheetState;

/// Spreadsheet ML namespace.
pub(super) const SPREADSHEET_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
/// Relationships namespace.
pub(super) const RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// Convert `SheetState` to OOXML attribute value (None = visible = omit attribute).
pub(super) fn sheet_state_to_xml_value(state: SheetState) -> Option<&'static str> {
    match state {
        SheetState::Visible => None,
        SheetState::Hidden => Some("hidden"),
        SheetState::VeryHidden => Some("veryHidden"),
    }
}

pub(super) fn object_display_mode_to_xml(mode: ObjectDisplayMode) -> &'static str {
    match mode {
        ObjectDisplayMode::All => "all",
        ObjectDisplayMode::Placeholders => "placeholders",
        ObjectDisplayMode::None => "none",
    }
}

pub(super) fn update_links_to_xml(update_links: UpdateLinks) -> &'static str {
    match update_links {
        UpdateLinks::UserSet => "userSet",
        UpdateLinks::Never => "never",
        UpdateLinks::Always => "always",
    }
}
