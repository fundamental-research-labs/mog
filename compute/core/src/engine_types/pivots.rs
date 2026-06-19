use serde::Deserialize;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCreateWithSheetOptions {
    pub insert_before_sheet_id: Option<String>,
    pub insert_index: Option<u32>,
}
