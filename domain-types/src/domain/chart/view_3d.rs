use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartView3DData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rot_x: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rot_y: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth_percent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r_ang_ax: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub perspective: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_percent: Option<u32>,
}
