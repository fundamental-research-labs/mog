use domain_types::chart::DataLabelData;
use ooxml_types::charts::ExtensionEntry;

use crate::infra::xml::{parse_bool_attr_opt, parse_element_content, parse_string_attr};
use crate::write::xml_writer::XmlWriter;

const DATA_LABEL_CONTRACT_URI: &str = "{F3B57944-1A5C-4B7F-A08B-3CC61D1543E4}";
const MOG_CHART_NS: &str = "https://schemas.mog.app/spreadsheet/chart/2026/main";

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct DataLabelContractProjection {
    pub full_data_label: Option<DataLabelData>,
    pub text: Option<String>,
    pub auto_text: Option<bool>,
    pub format: Option<String>,
    pub geometric_shape_type: Option<String>,
    pub formula: Option<String>,
    pub link_number_format: Option<bool>,
}

pub(crate) fn build_data_label_contract_extension(
    data_label: &DataLabelData,
) -> Option<ExtensionEntry> {
    build_data_label_contract_extension_impl(data_label, data_label.delete.is_some())
}

pub(crate) fn build_full_data_label_contract_extension(
    data_label: &DataLabelData,
) -> Option<ExtensionEntry> {
    build_data_label_contract_extension_impl(data_label, true)
}

pub(crate) fn is_data_label_contract_extension(extension: &ExtensionEntry) -> bool {
    extension.uri == DATA_LABEL_CONTRACT_URI || extension.xml.contains("mog:dataLabelContract")
}

fn build_data_label_contract_extension_impl(
    data_label: &DataLabelData,
    force_full_projection: bool,
) -> Option<ExtensionEntry> {
    if data_label.text.is_none()
        && data_label.auto_text.is_none()
        && data_label.format.is_none()
        && data_label.geometric_shape_type.is_none()
        && data_label.formula.is_none()
        && data_label.link_number_format.is_none()
        && !force_full_projection
    {
        return None;
    }

    let full_json = if force_full_projection {
        Some(serde_json::to_string(data_label).ok()?)
    } else {
        None
    };

    let mut w = XmlWriter::new();
    w.start_element("c:ext")
        .attr("uri", DATA_LABEL_CONTRACT_URI)
        .end_attrs();
    w.start_element("mog:dataLabelContract")
        .attr("xmlns:mog", MOG_CHART_NS)
        .attr_if("text", data_label.text.as_deref())
        .attr_if("format", data_label.format.as_deref())
        .attr_if(
            "geometricShapeType",
            data_label.geometric_shape_type.as_deref(),
        )
        .attr_if("formula", data_label.formula.as_deref());
    if let Some(auto_text) = data_label.auto_text {
        w.attr_bool("autoText", auto_text);
    }
    if let Some(link_number_format) = data_label.link_number_format {
        w.attr_bool("linkNumberFormat", link_number_format);
    }
    if let Some(json) = full_json.as_deref() {
        w.end_attrs()
            .element_with_text("mog:domainJson", json)
            .end_element("mog:dataLabelContract");
    } else {
        w.self_close();
    }
    w.end_element("c:ext");

    Some(ExtensionEntry {
        uri: DATA_LABEL_CONTRACT_URI.to_string(),
        xml: w.finish_string(),
    })
}

pub(crate) fn parse_data_label_contract_extensions(
    extensions: &[ExtensionEntry],
) -> DataLabelContractProjection {
    let mut projection = DataLabelContractProjection::default();

    for extension in extensions {
        if extension.uri != DATA_LABEL_CONTRACT_URI
            && !extension.xml.contains("mog:dataLabelContract")
        {
            continue;
        }

        let xml = extension.xml.as_bytes();
        projection.full_data_label = projection.full_data_label.or_else(|| {
            parse_element_content(xml, b"domainJson")
                .and_then(|json| serde_json::from_str::<DataLabelData>(&json).ok())
        });
        projection.text = projection.text.or_else(|| parse_string_attr(xml, b"text"));
        projection.auto_text = projection
            .auto_text
            .or_else(|| parse_bool_attr_opt(xml, b"autoText=\""));
        projection.format = projection
            .format
            .or_else(|| parse_string_attr(xml, b"format"));
        projection.geometric_shape_type = projection
            .geometric_shape_type
            .or_else(|| parse_string_attr(xml, b"geometricShapeType"));
        projection.formula = projection
            .formula
            .or_else(|| parse_string_attr(xml, b"formula"));
        projection.link_number_format = projection
            .link_number_format
            .or_else(|| parse_bool_attr_opt(xml, b"linkNumberFormat=\""));
    }

    projection
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_label_contract_extension_round_trips_projected_fields() {
        let label = DataLabelData {
            show: true,
            delete: None,
            position: None,
            text: Some("A & B".to_string()),
            visual_format: None,
            number_format: None,
            text_orientation: None,
            rich_text: None,
            auto_text: Some(false),
            format: Some("custom".to_string()),
            show_value: None,
            show_category_name: None,
            show_series_name: None,
            show_percentage: None,
            show_bubble_size: None,
            show_legend_key: None,
            separator: None,
            show_leader_lines: None,
            horizontal_alignment: None,
            vertical_alignment: None,
            link_number_format: Some(true),
            geometric_shape_type: Some("rect".to_string()),
            formula: Some("Sheet1!$A$1".to_string()),
            height: None,
            width: None,
            leader_lines_format: None,
            layout: None,
        };

        let extension = build_data_label_contract_extension(&label).expect("extension");
        let projection = parse_data_label_contract_extensions(&[extension]);

        assert_eq!(projection.full_data_label, None);
        assert_eq!(projection.text.as_deref(), Some("A & B"));
        assert_eq!(projection.auto_text, Some(false));
        assert_eq!(projection.format.as_deref(), Some("custom"));
        assert_eq!(projection.geometric_shape_type.as_deref(), Some("rect"));
        assert_eq!(projection.formula.as_deref(), Some("Sheet1!$A$1"));
        assert_eq!(projection.link_number_format, Some(true));
    }

    #[test]
    fn data_label_contract_extension_round_trips_full_deleted_label_contract() {
        let label = DataLabelData {
            show: true,
            delete: Some(true),
            position: Some("right".to_string()),
            text: Some("Deleted but configured".to_string()),
            visual_format: None,
            number_format: Some("#,##0".to_string()),
            text_orientation: None,
            rich_text: None,
            auto_text: Some(true),
            format: None,
            show_value: Some(true),
            show_category_name: None,
            show_series_name: None,
            show_percentage: None,
            show_bubble_size: None,
            show_legend_key: None,
            separator: Some(" | ".to_string()),
            show_leader_lines: None,
            horizontal_alignment: Some("center".to_string()),
            vertical_alignment: Some("top".to_string()),
            link_number_format: Some(true),
            geometric_shape_type: None,
            formula: None,
            height: None,
            width: None,
            leader_lines_format: None,
            layout: None,
        };

        let extension = build_data_label_contract_extension(&label).expect("extension");
        let projection = parse_data_label_contract_extensions(&[extension]);

        assert_eq!(projection.full_data_label, Some(label));
    }
}
