use crate::write::xml_writer::XmlWriter;

use super::{DynamicFilterType, FilterOperator};

/// A single custom filter criterion (CT_CustomFilter)
#[derive(Debug, Clone)]
pub struct CustomFilter {
    /// The filter operator
    pub operator: FilterOperator,
    /// The filter value
    pub value: String,
}

impl CustomFilter {
    /// Create a new custom filter
    pub fn new(operator: FilterOperator, value: &str) -> Self {
        Self {
            operator,
            value: value.to_string(),
        }
    }
}

/// Filter type for a filter column
#[derive(Debug, Clone)]
pub enum FilterType {
    /// Discrete values filter
    Filters {
        values: Vec<String>,
        blank: bool,
        calendar_type: Option<domain_types::CalendarType>,
        date_group_items: Vec<domain_types::DateGroupItem>,
    },
    /// Custom filters (1 or 2 conditions)
    CustomFilters {
        filters: Vec<CustomFilter>,
        and: bool,
    },
    /// Top 10 filter
    Top10 {
        /// Filter top (true) or bottom (false)
        top: bool,
        /// Value is percentage (true) or count (false)
        percent: bool,
        /// The filter value
        val: f64,
        /// Application-computed filter threshold
        filter_val: Option<f64>,
    },
    /// Dynamic filter
    DynamicFilter {
        /// The dynamic filter type
        kind: DynamicFilterType,
        /// Optional value for range-based dynamic filters
        val: Option<f64>,
        /// Optional max value for range-based dynamic filters
        max_val: Option<f64>,
        /// Optional ISO datetime value
        val_iso: Option<String>,
        /// Optional ISO datetime max value
        max_val_iso: Option<String>,
    },
    /// Color filter
    ColorFilter {
        /// Whether to filter by cell color instead of font color
        cell_color: bool,
        /// Differential format ID
        dxf_id: Option<u32>,
    },
    /// Icon filter
    IconFilter {
        /// Icon set identifier
        icon_set: String,
        /// Icon ID within the set
        icon_id: Option<u32>,
    },
}

/// Filter column definition (CT_FilterColumn)
#[derive(Debug, Clone)]
pub struct FilterColumn {
    /// Column index (0-based from table start)
    pub col_id: u32,
    /// Hide the filter dropdown in the UI.
    pub hidden_button: bool,
    /// Show the filter dropdown in the UI.
    pub show_button: bool,
    /// The filter type and settings
    pub filter: FilterType,
    /// Raw direct-child `<extLst>` owned by this filterColumn.
    pub ext_lst_raw: Option<String>,
}

impl FilterColumn {
    /// Create a new filter column with discrete values
    pub fn with_values(col_id: u32, values: Vec<String>) -> Self {
        Self {
            col_id,
            hidden_button: false,
            show_button: true,
            filter: FilterType::Filters {
                values,
                blank: false,
                calendar_type: None,
                date_group_items: Vec::new(),
            },
            ext_lst_raw: None,
        }
    }

    /// Create a new filter column with custom filters
    pub fn with_custom_filters(col_id: u32, filters: Vec<CustomFilter>) -> Self {
        Self {
            col_id,
            hidden_button: false,
            show_button: true,
            filter: FilterType::CustomFilters {
                filters,
                and: false,
            },
            ext_lst_raw: None,
        }
    }

    /// Create a new filter column with top 10 filter
    pub fn with_top10(col_id: u32, top: bool, percent: bool, val: f64) -> Self {
        Self {
            col_id,
            hidden_button: false,
            show_button: true,
            filter: FilterType::Top10 {
                top,
                percent,
                val,
                filter_val: None,
            },
            ext_lst_raw: None,
        }
    }

    /// Create a new filter column with dynamic filter
    pub fn with_dynamic_filter(col_id: u32, kind: DynamicFilterType) -> Self {
        Self {
            col_id,
            hidden_button: false,
            show_button: true,
            filter: FilterType::DynamicFilter {
                kind,
                val: None,
                max_val: None,
                val_iso: None,
                max_val_iso: None,
            },
            ext_lst_raw: None,
        }
    }

    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        self.write_xml_with_strict(w, false);
    }

    pub(crate) fn write_xml_with_strict(&self, w: &mut XmlWriter, strict: bool) {
        w.start_element("filterColumn")
            .attr_num("colId", self.col_id);
        if self.hidden_button {
            w.attr("hiddenButton", "1");
        }
        if !self.show_button {
            w.attr("showButton", "0");
        }
        w.end_attrs();

        match &self.filter {
            FilterType::Filters {
                values,
                blank,
                calendar_type,
                date_group_items,
            } => {
                w.start_element("filters");
                if *blank {
                    w.attr("blank", "1");
                }
                if let Some(calendar_type) = calendar_type {
                    w.attr("calendarType", calendar_type.to_ooxml_token());
                }
                w.end_attrs();
                for val in values {
                    w.empty_element("filter", &[("val", val)]);
                }
                for item in date_group_items {
                    w.start_element("dateGroupItem")
                        .attr("year", &item.year.to_string());
                    if let Some(month) = item.month {
                        w.attr("month", &month.to_string());
                    }
                    if let Some(day) = item.day {
                        w.attr("day", &day.to_string());
                    }
                    if let Some(hour) = item.hour {
                        w.attr("hour", &hour.to_string());
                    }
                    if let Some(minute) = item.minute {
                        w.attr("minute", &minute.to_string());
                    }
                    if let Some(second) = item.second {
                        w.attr("second", &second.to_string());
                    }
                    w.attr("dateTimeGrouping", item.date_time_grouping.to_ooxml_token());
                    w.self_close();
                }
                w.end_element("filters");
            }
            FilterType::CustomFilters { filters, and } => {
                w.start_element("customFilters");
                if *and {
                    w.attr("and", "1");
                }
                w.end_attrs();
                for filter in filters {
                    w.empty_element(
                        "customFilter",
                        &[
                            ("operator", filter.operator.as_str()),
                            ("val", &filter.value),
                        ],
                    );
                }
                w.end_element("customFilters");
            }
            FilterType::Top10 {
                top,
                percent,
                val,
                filter_val,
            } => {
                w.start_element("top10")
                    .attr_bool("top", *top)
                    .attr_bool("percent", *percent)
                    .attr_num("val", *val);
                if let Some(fv) = filter_val {
                    w.attr_num("filterVal", *fv);
                }
                w.self_close();
            }
            FilterType::DynamicFilter {
                kind,
                val,
                max_val,
                val_iso,
                max_val_iso,
            } => {
                w.start_element("dynamicFilter").attr("type", kind.as_str());
                if let Some(v) = val {
                    w.attr_num("val", *v);
                }
                if !strict {
                    if let Some(v) = max_val {
                        w.attr_num("maxVal", *v);
                    }
                }
                if let Some(v) = val_iso {
                    w.attr("valIso", v);
                }
                if let Some(v) = max_val_iso {
                    w.attr("maxValIso", v);
                }
                w.self_close();
            }
            FilterType::ColorFilter { cell_color, dxf_id } => {
                w.start_element("colorFilter");
                if let Some(id) = dxf_id {
                    w.attr_num("dxfId", *id);
                }
                if !cell_color {
                    w.attr("cellColor", "0");
                }
                w.self_close();
            }
            FilterType::IconFilter { icon_set, icon_id } => {
                w.start_element("iconFilter").attr("iconSet", icon_set);
                if let Some(id) = icon_id {
                    w.attr_num("iconId", *id);
                }
                w.self_close();
            }
        }

        if let Some(raw) = &self.ext_lst_raw {
            w.raw_str(raw);
        }

        w.end_element("filterColumn");
    }
}

/// Auto-filter definition (CT_AutoFilter)
#[derive(Debug, Clone, Default)]
pub struct AutoFilterDef {
    /// Reference range for the filter (e.g., "A1:E10")
    pub range: String,
    /// Filter columns
    pub filter_columns: Vec<FilterColumn>,
    /// Extension UID for revision tracking (xr:uid)
    pub xr_uid: Option<String>,
    /// Raw direct-child `<extLst>` owned by this autoFilter.
    pub ext_lst_raw: Option<String>,
}

impl AutoFilterDef {
    /// Create a new auto-filter with the specified range
    pub fn new(range: &str) -> Self {
        Self {
            range: range.to_string(),
            filter_columns: Vec::new(),
            xr_uid: None,
            ext_lst_raw: None,
        }
    }

    /// Add a filter column
    pub fn add_filter_column(&mut self, filter_column: FilterColumn) -> &mut Self {
        self.filter_columns.push(filter_column);
        self
    }

    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        self.write_xml_with_strict(w, false);
    }

    pub(crate) fn write_xml_with_strict(&self, w: &mut XmlWriter, strict: bool) {
        if self.filter_columns.is_empty() && self.xr_uid.is_none() && self.ext_lst_raw.is_none() {
            w.empty_element("autoFilter", &[("ref", &self.range)]);
        } else if self.filter_columns.is_empty() && self.ext_lst_raw.is_none() {
            let uid = self.xr_uid.as_deref().unwrap();
            w.empty_element("autoFilter", &[("ref", &self.range), ("xr:uid", uid)]);
        } else {
            w.start_element("autoFilter").attr("ref", &self.range);
            if let Some(ref uid) = self.xr_uid {
                w.attr("xr:uid", uid);
            }
            w.end_attrs();

            for fc in &self.filter_columns {
                fc.write_xml_with_strict(w, strict);
            }

            if let Some(raw) = &self.ext_lst_raw {
                w.raw_str(raw);
            }

            w.end_element("autoFilter");
        }
    }
}
