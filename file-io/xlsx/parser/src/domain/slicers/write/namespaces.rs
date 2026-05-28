/// x14 namespace (slicers, slicer caches - Office 2010)
pub const NS_X14: &str = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";

/// x15 namespace (table slicer caches - Office 2013)
pub const NS_X15: &str = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main";

/// xr10 namespace (uid attributes)
pub const NS_XR10: &str = "http://schemas.microsoft.com/office/spreadsheetml/2024/richdata2";

/// mc namespace (markup compatibility)
pub const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/// Extension URI for x15:tableSlicerCache in extLst
pub const EXT_URI_TABLE_SLICER_CACHE: &str = "{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}";

/// Extension URI for x14:slicerList in worksheet extLst
pub const EXT_URI_SLICER_LIST: &str = "{A8765BA9-456A-4dab-B4F3-ACF838C121DE}";

/// Extension URI for x14:slicerCaches in workbook extLst
pub const EXT_URI_SLICER_CACHES: &str = "{BBE1A952-AA13-448e-AADC-164F8A28A991}";

/// Main spreadsheetml namespace (used as "x" prefix inside slicer parts)
pub(super) const NS_X: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
