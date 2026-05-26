use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineGroup {
    pub is_row: bool,
    pub start: u32,
    pub end: u32,
    pub level: u32,
    pub collapsed: bool,
    pub hidden: bool,
    /// When true, the `collapsed` attribute in the original file was on a
    /// column/row that is a member of the group (has outlineLevel > 0),
    /// rather than on the next row/col after the group end.  The writer uses
    /// this to place `collapsed` on `end` instead of `end + 1`.
    #[serde(default)]
    pub collapsed_on_member: bool,
}

impl Default for OutlineGroup {
    fn default() -> Self {
        Self {
            is_row: true,
            start: 0,
            end: 0,
            level: 1,
            collapsed: false,
            hidden: false,
            collapsed_on_member: false,
        }
    }
}
