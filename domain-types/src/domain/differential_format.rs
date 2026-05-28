use serde::{Deserialize, Serialize};

/// Workbook-level differential format registry entry.
///
/// The `id` is Mog's stable workbook-scoped DXF identity. XLSX export compacts
/// reachable entries into the positional OOXML `<dxfs>` array and remaps all
/// `dxfId` references for the package being written.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DxfDef {
    pub id: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<DxfOwner>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<ooxml_types::styles::FontDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<ooxml_types::styles::FillDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<ooxml_types::styles::BorderDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<ooxml_types::styles::NumberFormatDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<ooxml_types::styles::AlignmentDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protection: Option<ooxml_types::styles::ProtectionDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extension_metadata: Option<ooxml_types::ExtensionList>,
}

impl DxfDef {
    #[must_use]
    pub fn from_ooxml(id: u32, value: ooxml_types::styles::DxfDef) -> Self {
        Self {
            id,
            owners: Vec::new(),
            font: value.font,
            fill: value.fill,
            border: value.border,
            number_format: value.num_fmt,
            alignment: value.alignment,
            protection: value.protection,
            extension_metadata: value.ext_lst,
        }
    }

    #[must_use]
    pub fn to_ooxml(&self) -> ooxml_types::styles::DxfDef {
        ooxml_types::styles::DxfDef {
            font: self.font.clone(),
            num_fmt: self.number_format.clone(),
            fill: self.fill.clone(),
            border: self.border.clone(),
            alignment: self.alignment.clone(),
            protection: self.protection.clone(),
            ext_lst: self.extension_metadata.clone(),
        }
    }
}

/// Explicit owner metadata for a DXF registry entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DxfOwner {
    ConditionalFormatRule {
        sheet_index: u32,
        format_id: String,
        rule_id: String,
    },
    AutoFilter {
        sheet_index: u32,
        column_id: u32,
    },
    SheetSort {
        sheet_index: u32,
        condition_index: u32,
    },
    Table {
        sheet_index: u32,
        table_name: String,
        field: String,
    },
    TableColumn {
        sheet_index: u32,
        table_name: String,
        column_name: String,
        field: String,
    },
    TableFilter {
        sheet_index: u32,
        table_name: String,
        column_id: u32,
    },
    TableSort {
        sheet_index: u32,
        table_name: String,
        condition_index: u32,
    },
    TableStyle {
        style_name: String,
        element_index: u32,
    },
}
