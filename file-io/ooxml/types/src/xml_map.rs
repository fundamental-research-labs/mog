//! XML mapping types (ECMA-376 Part 1, §18.14 — XML Mapping).

// =============================================================================
// XmlPr
// =============================================================================

/// XML properties for a mapped cell (ECMA-376 CT_XmlPr).
///
/// Defines the XPath expression and data type for a single XML-mapped cell.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct XmlPr {
    /// XML map identifier that this property belongs to.
    pub map_id: u32,
    /// XPath expression selecting the XML element or attribute.
    pub xpath: String,
    /// XML data type for the mapped value (ST_XmlDataType — unrestricted string).
    pub xml_data_type: String,
    /// Future extensibility.
    pub ext_lst: Option<crate::ExtensionList>,
}

// =============================================================================
// XmlCellPr
// =============================================================================

/// XML cell properties (ECMA-376 CT_XmlCellPr).
///
/// Associates XML mapping information with a specific cell, including
/// the XML properties child element and cell-level attributes.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct XmlCellPr {
    /// XML property definition (required child element).
    pub xml_pr: XmlPr,
    /// Future extensibility.
    pub ext_lst: Option<crate::ExtensionList>,
    /// Unique identifier for this cell mapping.
    pub id: u32,
    /// Optional unique name for this cell mapping.
    pub unique_name: Option<String>,
}

// =============================================================================
// XmlColumnPr
// =============================================================================

/// XML column properties (ECMA-376 CT_XmlColumnPr).
///
/// Defines XML mapping properties for a table column, mapping column data
/// to an XML element via an XPath expression.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct XmlColumnPr {
    /// XML map identifier that this column belongs to.
    pub map_id: u32,
    /// XPath expression selecting the XML element or attribute.
    pub xpath: String,
    /// Whether the data is denormalized. Default: `false`.
    pub denormalized: bool,
    /// XML data type for the mapped values (ST_XmlDataType — unrestricted string).
    pub xml_data_type: String,
    /// Future extensibility.
    pub ext_lst: Option<crate::ExtensionList>,
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xml_pr_default() {
        let pr = XmlPr::default();
        assert_eq!(pr.map_id, 0);
        assert_eq!(pr.xpath, "");
        assert_eq!(pr.xml_data_type, "");
        assert!(pr.ext_lst.is_none());
    }

    #[test]
    fn test_xml_pr_serde_roundtrip() {
        let original = XmlPr {
            map_id: 1,
            xpath: "/root/element/@attr".to_string(),
            xml_data_type: "string".to_string(),
            ext_lst: None,
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: XmlPr = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_xml_cell_pr_default() {
        let pr = XmlCellPr::default();
        assert_eq!(pr.id, 0);
        assert!(pr.unique_name.is_none());
        assert!(pr.ext_lst.is_none());
        assert_eq!(pr.xml_pr.map_id, 0);
    }

    #[test]
    fn test_xml_cell_pr_serde_roundtrip() {
        let original = XmlCellPr {
            xml_pr: XmlPr {
                map_id: 2,
                xpath: "/data/item".to_string(),
                xml_data_type: "integer".to_string(),
                ext_lst: None,
            },
            ext_lst: None,
            id: 42,
            unique_name: Some("myMapping".to_string()),
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: XmlCellPr = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_xml_column_pr_default() {
        let pr = XmlColumnPr::default();
        assert_eq!(pr.map_id, 0);
        assert_eq!(pr.xpath, "");
        assert!(!pr.denormalized);
        assert_eq!(pr.xml_data_type, "");
        assert!(pr.ext_lst.is_none());
    }

    #[test]
    fn test_xml_column_pr_serde_roundtrip() {
        let original = XmlColumnPr {
            map_id: 3,
            xpath: "/root/items/item/name".to_string(),
            denormalized: true,
            xml_data_type: "string".to_string(),
            ext_lst: None,
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: XmlColumnPr = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
