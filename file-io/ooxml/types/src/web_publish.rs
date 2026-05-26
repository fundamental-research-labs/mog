//! Web publishing types (ECMA-376 Part 1, §18.5.1 — Web Publishing).

// =============================================================================
// WebSourceType
// =============================================================================

/// Web source type (ECMA-376 ST_WebSourceType, §18.18.84).
///
/// Identifies the kind of data source for a web-published item.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum WebSourceType {
    /// An entire worksheet.
    #[default]
    Sheet,
    /// The defined print area of a worksheet.
    PrintArea,
    /// An auto-filter range.
    AutoFilter,
    /// A named range.
    Range,
    /// A chart object.
    Chart,
    /// A pivot table.
    PivotTable,
    /// A query table.
    Query,
    /// A label range.
    Label,
}

impl WebSourceType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "sheet" => Self::Sheet,
            "printArea" => Self::PrintArea,
            "autoFilter" => Self::AutoFilter,
            "range" => Self::Range,
            "chart" => Self::Chart,
            "pivotTable" => Self::PivotTable,
            "query" => Self::Query,
            "label" => Self::Label,
            _ => Self::Sheet,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Sheet => "sheet",
            Self::PrintArea => "printArea",
            Self::AutoFilter => "autoFilter",
            Self::Range => "range",
            Self::Chart => "chart",
            Self::PivotTable => "pivotTable",
            Self::Query => "query",
            Self::Label => "label",
        }
    }
}

// =============================================================================
// TargetScreenSize
// =============================================================================

/// Target screen size for web publishing (ECMA-376 ST_TargetScreenSize, §18.18.74).
///
/// Specifies the target monitor resolution for web page layout.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TargetScreenSize {
    /// 544 x 376 pixels.
    Size544x376,
    /// 640 x 480 pixels.
    #[default]
    Size640x480,
    /// 720 x 512 pixels.
    Size720x512,
    /// 800 x 600 pixels.
    Size800x600,
    /// 1024 x 768 pixels.
    Size1024x768,
    /// 1152 x 882 pixels.
    Size1152x882,
    /// 1152 x 900 pixels.
    Size1152x900,
    /// 1280 x 1024 pixels.
    Size1280x1024,
    /// 1600 x 1200 pixels.
    Size1600x1200,
    /// 1800 x 1440 pixels.
    Size1800x1440,
    /// 1920 x 1200 pixels.
    Size1920x1200,
}

impl TargetScreenSize {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "544x376" => Self::Size544x376,
            "640x480" => Self::Size640x480,
            "720x512" => Self::Size720x512,
            "800x600" => Self::Size800x600,
            "1024x768" => Self::Size1024x768,
            "1152x882" => Self::Size1152x882,
            "1152x900" => Self::Size1152x900,
            "1280x1024" => Self::Size1280x1024,
            "1600x1200" => Self::Size1600x1200,
            "1800x1440" => Self::Size1800x1440,
            "1920x1200" => Self::Size1920x1200,
            _ => Self::Size640x480,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Size544x376 => "544x376",
            Self::Size640x480 => "640x480",
            Self::Size720x512 => "720x512",
            Self::Size800x600 => "800x600",
            Self::Size1024x768 => "1024x768",
            Self::Size1152x882 => "1152x882",
            Self::Size1152x900 => "1152x900",
            Self::Size1280x1024 => "1280x1024",
            Self::Size1600x1200 => "1600x1200",
            Self::Size1800x1440 => "1800x1440",
            Self::Size1920x1200 => "1920x1200",
        }
    }
}

// =============================================================================
// WebPublishItem
// =============================================================================

/// A single web publish item (ECMA-376 CT_WebPublishItem).
///
/// Defines one item to be published to a web page from the workbook.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WebPublishItem {
    /// Unique identifier for this publish item.
    pub id: u32,
    /// HTML div element ID for the published content.
    pub div_id: String,
    /// Type of source data to publish.
    pub source_type: WebSourceType,
    /// Source cell range reference, if applicable.
    pub source_ref: Option<String>,
    /// Source object name, if applicable.
    pub source_object: Option<String>,
    /// Destination file path for the published HTML.
    pub destination_file: String,
    /// Title for the published content.
    pub title: Option<String>,
    /// Whether to automatically republish when the workbook is saved. Default: `false`.
    pub auto_republish: bool,
}

// =============================================================================
// WebPublishItems
// =============================================================================

/// Container for web publish items (ECMA-376 CT_WebPublishItems).
///
/// Holds the collection of items to be published from the workbook.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WebPublishItems {
    /// The web publish items.
    pub items: Vec<WebPublishItem>,
    /// Number of items in the collection.
    pub count: Option<u32>,
}

// =============================================================================
// WebPublishObject
// =============================================================================

/// A web publish object (ECMA-376 CT_WebPublishObject).
///
/// Defines an embedded object to be published to a web page.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WebPublishObject {
    /// Unique identifier for this publish object.
    pub id: u32,
    /// HTML div element ID for the published object.
    pub div_id: String,
    /// Source object name, if applicable.
    pub source_object: Option<String>,
    /// Destination file path for the published HTML.
    pub destination_file: String,
    /// Title for the published object.
    pub title: Option<String>,
    /// Whether to automatically republish when the workbook is saved. Default: `false`.
    pub auto_republish: bool,
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_web_source_type_from_ooxml() {
        assert_eq!(WebSourceType::from_ooxml("sheet"), WebSourceType::Sheet);
        assert_eq!(
            WebSourceType::from_ooxml("printArea"),
            WebSourceType::PrintArea
        );
        assert_eq!(
            WebSourceType::from_ooxml("autoFilter"),
            WebSourceType::AutoFilter
        );
        assert_eq!(WebSourceType::from_ooxml("range"), WebSourceType::Range);
        assert_eq!(WebSourceType::from_ooxml("chart"), WebSourceType::Chart);
        assert_eq!(
            WebSourceType::from_ooxml("pivotTable"),
            WebSourceType::PivotTable
        );
        assert_eq!(WebSourceType::from_ooxml("query"), WebSourceType::Query);
        assert_eq!(WebSourceType::from_ooxml("label"), WebSourceType::Label);
        // Unknown values fall back to default
        assert_eq!(WebSourceType::from_ooxml("unknown"), WebSourceType::Sheet);
    }

    #[test]
    fn test_web_source_type_to_ooxml() {
        assert_eq!(WebSourceType::Sheet.to_ooxml(), "sheet");
        assert_eq!(WebSourceType::PrintArea.to_ooxml(), "printArea");
        assert_eq!(WebSourceType::AutoFilter.to_ooxml(), "autoFilter");
        assert_eq!(WebSourceType::Range.to_ooxml(), "range");
        assert_eq!(WebSourceType::Chart.to_ooxml(), "chart");
        assert_eq!(WebSourceType::PivotTable.to_ooxml(), "pivotTable");
        assert_eq!(WebSourceType::Query.to_ooxml(), "query");
        assert_eq!(WebSourceType::Label.to_ooxml(), "label");
    }

    #[test]
    fn test_web_source_type_roundtrip() {
        for variant in [
            WebSourceType::Sheet,
            WebSourceType::PrintArea,
            WebSourceType::AutoFilter,
            WebSourceType::Range,
            WebSourceType::Chart,
            WebSourceType::PivotTable,
            WebSourceType::Query,
            WebSourceType::Label,
        ] {
            assert_eq!(WebSourceType::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    #[test]
    fn test_web_source_type_default() {
        assert_eq!(WebSourceType::default(), WebSourceType::Sheet);
    }

    #[test]
    fn test_target_screen_size_from_ooxml() {
        assert_eq!(
            TargetScreenSize::from_ooxml("544x376"),
            TargetScreenSize::Size544x376
        );
        assert_eq!(
            TargetScreenSize::from_ooxml("640x480"),
            TargetScreenSize::Size640x480
        );
        assert_eq!(
            TargetScreenSize::from_ooxml("1920x1200"),
            TargetScreenSize::Size1920x1200
        );
        // Unknown values fall back to default
        assert_eq!(
            TargetScreenSize::from_ooxml("unknown"),
            TargetScreenSize::Size640x480
        );
    }

    #[test]
    fn test_target_screen_size_to_ooxml() {
        assert_eq!(TargetScreenSize::Size544x376.to_ooxml(), "544x376");
        assert_eq!(TargetScreenSize::Size640x480.to_ooxml(), "640x480");
        assert_eq!(TargetScreenSize::Size1920x1200.to_ooxml(), "1920x1200");
    }

    #[test]
    fn test_target_screen_size_roundtrip() {
        for variant in [
            TargetScreenSize::Size544x376,
            TargetScreenSize::Size640x480,
            TargetScreenSize::Size720x512,
            TargetScreenSize::Size800x600,
            TargetScreenSize::Size1024x768,
            TargetScreenSize::Size1152x882,
            TargetScreenSize::Size1152x900,
            TargetScreenSize::Size1280x1024,
            TargetScreenSize::Size1600x1200,
            TargetScreenSize::Size1800x1440,
            TargetScreenSize::Size1920x1200,
        ] {
            assert_eq!(TargetScreenSize::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    #[test]
    fn test_target_screen_size_default() {
        assert_eq!(TargetScreenSize::default(), TargetScreenSize::Size640x480);
    }

    #[test]
    fn test_web_publish_item_default() {
        let item = WebPublishItem::default();
        assert_eq!(item.id, 0);
        assert_eq!(item.div_id, "");
        assert_eq!(item.source_type, WebSourceType::Sheet);
        assert!(item.source_ref.is_none());
        assert!(item.source_object.is_none());
        assert_eq!(item.destination_file, "");
        assert!(item.title.is_none());
        assert!(!item.auto_republish);
    }

    #[test]
    fn test_web_publish_item_serde_roundtrip() {
        let original = WebPublishItem {
            id: 1,
            div_id: "div1".to_string(),
            source_type: WebSourceType::Chart,
            source_ref: Some("Sheet1!A1:D10".to_string()),
            source_object: None,
            destination_file: "output.html".to_string(),
            title: Some("My Chart".to_string()),
            auto_republish: true,
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: WebPublishItem = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_web_publish_items_default() {
        let items = WebPublishItems::default();
        assert!(items.items.is_empty());
        assert!(items.count.is_none());
    }

    #[test]
    fn test_web_publish_object_default() {
        let obj = WebPublishObject::default();
        assert_eq!(obj.id, 0);
        assert_eq!(obj.div_id, "");
        assert!(obj.source_object.is_none());
        assert_eq!(obj.destination_file, "");
        assert!(obj.title.is_none());
        assert!(!obj.auto_republish);
    }

    #[test]
    fn test_web_publish_object_serde_roundtrip() {
        let original = WebPublishObject {
            id: 5,
            div_id: "objDiv".to_string(),
            source_object: Some("Chart 1".to_string()),
            destination_file: "chart.html".to_string(),
            title: Some("Published Chart".to_string()),
            auto_republish: false,
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: WebPublishObject = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
