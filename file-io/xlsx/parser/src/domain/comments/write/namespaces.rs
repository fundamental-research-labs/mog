// ============================================================================
// Constants
// ============================================================================

/// Main namespace for spreadsheetml
pub(super) const SPREADSHEETML_NS: &str =
    "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/// Markup compatibility namespace (for mc:Ignorable)
pub(super) const MC_NS: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/// Excel revision namespace (xr:uid on comment elements)
pub(super) const XR_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2014/revision";

/// Threaded comments namespace (Excel 365)
pub(super) const THREADED_COMMENTS_NS: &str =
    "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments";

/// VML namespace
pub(super) const VML_NS: &str = "urn:schemas-microsoft-com:vml";

/// Office namespace for VML
pub(super) const OFFICE_NS: &str = "urn:schemas-microsoft-com:office:office";

/// Excel namespace for VML
pub(super) const EXCEL_NS: &str = "urn:schemas-microsoft-com:office:excel";
