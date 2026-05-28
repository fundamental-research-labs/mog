use crate::write::xml_writer::XmlWriter;

use ooxml_types::cond_format::IconSetType;

use super::SortBy;

/// Sort condition (CT_SortCondition)
#[derive(Debug, Clone)]
pub struct SortCondition {
    /// Reference for the sort column (e.g., "A:A" or "A1:A10")
    pub col_ref: String,
    /// Whether to sort descending
    pub descending: bool,
    /// Sort by type
    pub sort_by: Option<SortBy>,
    /// Custom sort list
    pub custom_list: Option<String>,
    /// Differential format ID for color sorts
    pub dxf_id: Option<u32>,
    /// Icon set name for icon sorts
    pub icon_set: Option<IconSetType>,
    /// Icon ID for icon sorts
    pub icon_id: Option<u32>,
}

impl SortCondition {
    /// Create a new sort condition
    pub fn new(col_ref: &str) -> Self {
        Self {
            col_ref: col_ref.to_string(),
            descending: false,
            sort_by: None,
            custom_list: None,
            dxf_id: None,
            icon_set: None,
            icon_id: None,
        }
    }

    /// Create a descending sort condition
    pub fn descending(col_ref: &str) -> Self {
        Self {
            col_ref: col_ref.to_string(),
            descending: true,
            sort_by: None,
            custom_list: None,
            dxf_id: None,
            icon_set: None,
            icon_id: None,
        }
    }

    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("sortCondition");

        if self.descending {
            w.attr_bool("descending", true);
        }

        if let Some(sort_by) = self.sort_by {
            if sort_by != SortBy::Value {
                w.attr("sortBy", sort_by.as_str());
            }
        }

        if let Some(ref icon_set) = self.icon_set {
            w.attr("iconSet", icon_set.to_ooxml());
        }
        if let Some(icon_id) = self.icon_id {
            w.attr_num("iconId", icon_id);
        }
        if let Some(ref custom_list) = self.custom_list {
            w.attr("customList", custom_list);
        }
        if let Some(dxf_id) = self.dxf_id {
            w.attr_num("dxfId", dxf_id);
        }

        w.attr("ref", &self.col_ref).self_close();
    }
}

/// Sort state (CT_SortState)
#[derive(Debug, Clone, Default)]
pub struct SortState {
    /// Reference range for the sort (e.g., "A2:D10" - excludes header)
    pub range: String,
    /// Case sensitive sort
    pub case_sensitive: bool,
    /// Whether to sort by columns.
    pub column_sort: bool,
    /// CJK sort method.
    pub sort_method: domain_types::SortMethod,
    /// Sort conditions
    pub conditions: Vec<SortCondition>,
    /// Raw direct-child `<extLst>` owned by this sortState.
    pub ext_lst_raw: Option<String>,
}

impl SortState {
    /// Create a new sort state
    pub fn new(range: &str) -> Self {
        Self {
            range: range.to_string(),
            case_sensitive: false,
            column_sort: false,
            sort_method: domain_types::SortMethod::None,
            conditions: Vec::new(),
            ext_lst_raw: None,
        }
    }

    /// Add a sort condition
    pub fn add_condition(&mut self, condition: SortCondition) -> &mut Self {
        self.conditions.push(condition);
        self
    }

    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("sortState").attr("ref", &self.range);

        if self.case_sensitive {
            w.attr_bool("caseSensitive", true);
        }
        if self.column_sort {
            w.attr_bool("columnSort", true);
        }
        if self.sort_method != domain_types::SortMethod::None {
            w.attr("sortMethod", self.sort_method.to_ooxml_token());
        }

        w.end_attrs();

        for condition in &self.conditions {
            condition.write_xml(w);
        }

        if let Some(raw) = &self.ext_lst_raw {
            w.raw_str(raw);
        }

        w.end_element("sortState");
    }
}
