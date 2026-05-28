use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookConnectionSet {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connections: Vec<WorkbookConnection>,
}

impl WorkbookConnectionSet {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.connections.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookConnection {
    pub id: u32,
    pub name: Option<String>,
    pub description: Option<String>,
    pub connection_type: Option<u32>,
    pub refreshed_version: Option<u32>,
    pub min_refreshable_version: Option<u32>,
    pub save_data: bool,
    pub credentials: Option<String>,
    pub single_sign_on_id: Option<String>,
    pub background: bool,
    pub deleted: bool,
    pub keep_alive: bool,
    pub new_connection: bool,
    pub odc_file: Option<String>,
    pub only_use_connection_file: bool,
    pub reconnection_method: Option<u32>,
    pub refresh_on_load: bool,
    pub save_password: bool,
    pub source_file: Option<String>,
    pub interval: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_pr: Option<DbConnectionProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oledb_pr: Option<DbConnectionProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub olap_pr: Option<OlapConnectionProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_pr: Option<WebConnectionProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_pr: Option<TextConnectionProperties>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parameters: Vec<ConnectionParameter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionProperties {
    pub connection: Option<String>,
    pub command: Option<String>,
    pub server_command: Option<String>,
    pub command_type: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OlapConnectionProperties {
    pub local: bool,
    pub local_connection: Option<String>,
    pub local_refresh: bool,
    pub send_locale: bool,
    pub row_drill_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_fill: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_number_format: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_font: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_font_color: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebConnectionProperties {
    pub xml: bool,
    pub source_data: bool,
    pub parse_pre: bool,
    pub consecutive: bool,
    pub first_row: bool,
    pub xl97: bool,
    pub text_dates: bool,
    pub xl2000: bool,
    pub url: Option<String>,
    pub post: Option<String>,
    pub html_tables: bool,
    pub html_format: Option<String>,
    pub edit_page: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tables: Vec<ConnectionTableRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ConnectionTableRef {
    Missing,
    Name(String),
    Index(u32),
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextConnectionProperties {
    pub prompt: bool,
    pub file_type: Option<String>,
    pub code_page: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub character_set: Option<String>,
    pub first_row: Option<u32>,
    pub source_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delimited: Option<bool>,
    pub delimiter: Option<String>,
    pub decimal: Option<String>,
    pub thousands: Option<String>,
    pub tab: bool,
    pub space: bool,
    pub comma: bool,
    pub semicolon: bool,
    pub consecutive: bool,
    pub qualifier: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<TextConnectionField>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextConnectionField {
    pub field_type: Option<String>,
    pub position: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionParameter {
    pub name: Option<String>,
    pub sql_type: Option<i32>,
    pub parameter_type: Option<String>,
    pub refresh_on_change: bool,
    pub prompt: Option<String>,
    pub boolean: Option<bool>,
    pub double: Option<f64>,
    pub integer: Option<i32>,
    pub string: Option<String>,
    pub cell: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryTable {
    pub connection_id: Option<u32>,
    pub name: Option<String>,
    pub relationship_id: Option<String>,
    pub path_hint: Option<String>,
    pub auto_format_id: Option<u32>,
    pub apply_number_formats: bool,
    pub apply_border_formats: bool,
    pub apply_font_formats: bool,
    pub apply_pattern_formats: bool,
    pub apply_alignment_formats: bool,
    pub apply_width_height_formats: bool,
    pub refresh_on_load: bool,
    pub grow_shrink_type: Option<String>,
    pub fill_formulas: bool,
    pub remove_data_on_save: bool,
    pub disable_edit: bool,
    pub preserve_formatting: bool,
    pub adjust_column_width: bool,
    pub intermediate: bool,
    pub connection_id_deleted: bool,
    pub headers: bool,
    pub row_numbers: bool,
    pub disable_refresh: bool,
    pub background_refresh: bool,
    pub first_background_refresh: bool,
    pub next_id: Option<u32>,
    pub minimum_version: Option<u32>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub refresh_present: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub preserve_sort_filter_layout: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub field_id_wrapped: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub headers_in_last_refresh: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unbound_columns_left: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unbound_columns_right: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_state_xml: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_ext_lst_xml: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<QueryTableField>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_fields: Vec<QueryTableDeletedField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryTableField {
    pub id: u32,
    pub name: Option<String>,
    pub table_column_id: Option<u32>,
    pub data_bound: bool,
    pub row_numbers: bool,
    pub fill_formulas: bool,
    pub clipped: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryTableDeletedField {
    pub name: Option<String>,
}

fn is_false(v: &bool) -> bool {
    !*v
}
