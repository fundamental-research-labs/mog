//! Volatile dependency types (ECMA-376 Part 1, §18.15 — Volatile Dependencies).

// =============================================================================
// VolDepType
// =============================================================================

/// Volatile dependency type (ECMA-376 ST_VolDepType, §18.18.82).
///
/// Specifies the category of volatile dependency being tracked.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum VolDepType {
    /// Real-time data function dependency.
    #[default]
    RealTimeData,
    /// OLAP functions dependency.
    OlapFunctions,
}

impl VolDepType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "olapFunctions" => Self::OlapFunctions,
            _ => Self::RealTimeData,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::RealTimeData => "realTimeData",
            Self::OlapFunctions => "olapFunctions",
        }
    }
}

// =============================================================================
// VolValueType
// =============================================================================

/// Volatile value type (ECMA-376 ST_VolValueType, §18.18.83).
///
/// Specifies the data type of a volatile dependency value.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum VolValueType {
    /// Boolean value.
    Boolean,
    /// Numeric value (default).
    #[default]
    Number,
    /// Error value.
    Error,
    /// String value.
    Str,
}

impl VolValueType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "b" => Self::Boolean,
            "e" => Self::Error,
            "s" => Self::Str,
            _ => Self::Number,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Boolean => "b",
            Self::Number => "n",
            Self::Error => "e",
            Self::Str => "s",
        }
    }
}

// =============================================================================
// VolTopicRef
// =============================================================================

/// A cell reference within a volatile topic (ECMA-376 CT_VolTopicRef).
///
/// Points to a specific cell on a specific sheet that depends on this
/// volatile topic.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VolTopicRef {
    /// Cell reference string (e.g., `"A1"`).
    pub r: String,
    /// Zero-based sheet index.
    pub s: u32,
}

// =============================================================================
// VolTopic
// =============================================================================

/// A volatile topic entry (ECMA-376 CT_VolTopic).
///
/// Represents a single volatile data topic with its value, cell references
/// that depend on it, and optional nested sub-topics.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VolTopic {
    /// Data type of this topic's value. Default: `Number`.
    pub topic_type: VolValueType,
    /// The topic value (text content of the `<v>` element).
    pub value: String,
    /// Cell references that depend on this topic (`<tr>` children).
    pub references: Vec<VolTopicRef>,
    /// Nested sub-topics (`<stp>`/`<tp>` children).
    pub sub_topics: Vec<VolTopic>,
}

// =============================================================================
// VolMain
// =============================================================================

/// A volatile main entry (ECMA-376 CT_VolMain).
///
/// Groups volatile topics under a common first topic value, typically
/// representing the server or function name.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VolMain {
    /// First topic value (the server/function identifier).
    pub first: String,
    /// Volatile topics under this main entry (`<tp>` children).
    pub topics: Vec<VolTopic>,
}

// =============================================================================
// VolType
// =============================================================================

/// A volatile type entry (ECMA-376 CT_VolType).
///
/// Groups volatile main entries by their dependency type (real-time data
/// or OLAP functions).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VolType {
    /// The volatile dependency type.
    pub vol_type: VolDepType,
    /// Main entries for this type (`<main>` children).
    pub main: Vec<VolMain>,
}

// =============================================================================
// VolTypes
// =============================================================================

/// Root container for volatile dependencies (ECMA-376 CT_VolTypes).
///
/// The top-level element of the volatile dependencies part, containing
/// all volatile type entries for the workbook.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VolTypes {
    /// Volatile type entries (`<volType>` children).
    pub vol_type: Vec<VolType>,
    /// Future extensibility area.
    pub ext_lst: Option<crate::ExtensionList>,
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // VolDepType tests
    #[test]
    fn test_vol_dep_type_from_ooxml() {
        assert_eq!(
            VolDepType::from_ooxml("realTimeData"),
            VolDepType::RealTimeData
        );
        assert_eq!(
            VolDepType::from_ooxml("olapFunctions"),
            VolDepType::OlapFunctions
        );
        // Unknown values fall back to default
        assert_eq!(VolDepType::from_ooxml("unknown"), VolDepType::RealTimeData);
    }

    #[test]
    fn test_vol_dep_type_to_ooxml() {
        assert_eq!(VolDepType::RealTimeData.to_ooxml(), "realTimeData");
        assert_eq!(VolDepType::OlapFunctions.to_ooxml(), "olapFunctions");
    }

    #[test]
    fn test_vol_dep_type_roundtrip() {
        for val in [VolDepType::RealTimeData, VolDepType::OlapFunctions] {
            assert_eq!(VolDepType::from_ooxml(val.to_ooxml()), val);
        }
    }

    #[test]
    fn test_vol_dep_type_default() {
        assert_eq!(VolDepType::default(), VolDepType::RealTimeData);
    }

    // VolValueType tests
    #[test]
    fn test_vol_value_type_from_ooxml() {
        assert_eq!(VolValueType::from_ooxml("b"), VolValueType::Boolean);
        assert_eq!(VolValueType::from_ooxml("n"), VolValueType::Number);
        assert_eq!(VolValueType::from_ooxml("e"), VolValueType::Error);
        assert_eq!(VolValueType::from_ooxml("s"), VolValueType::Str);
        // Unknown values fall back to default
        assert_eq!(VolValueType::from_ooxml("unknown"), VolValueType::Number);
    }

    #[test]
    fn test_vol_value_type_to_ooxml() {
        assert_eq!(VolValueType::Boolean.to_ooxml(), "b");
        assert_eq!(VolValueType::Number.to_ooxml(), "n");
        assert_eq!(VolValueType::Error.to_ooxml(), "e");
        assert_eq!(VolValueType::Str.to_ooxml(), "s");
    }

    #[test]
    fn test_vol_value_type_roundtrip() {
        for val in [
            VolValueType::Boolean,
            VolValueType::Number,
            VolValueType::Error,
            VolValueType::Str,
        ] {
            assert_eq!(VolValueType::from_ooxml(val.to_ooxml()), val);
        }
    }

    #[test]
    fn test_vol_value_type_default() {
        assert_eq!(VolValueType::default(), VolValueType::Number);
    }

    // Struct default tests
    #[test]
    fn test_vol_topic_ref_default() {
        let tr = VolTopicRef::default();
        assert_eq!(tr.r, "");
        assert_eq!(tr.s, 0);
    }

    #[test]
    fn test_vol_topic_default() {
        let tp = VolTopic::default();
        assert_eq!(tp.topic_type, VolValueType::Number);
        assert_eq!(tp.value, "");
        assert!(tp.references.is_empty());
        assert!(tp.sub_topics.is_empty());
    }

    #[test]
    fn test_vol_main_default() {
        let vm = VolMain::default();
        assert_eq!(vm.first, "");
        assert!(vm.topics.is_empty());
    }

    #[test]
    fn test_vol_type_default() {
        let vt = VolType::default();
        assert_eq!(vt.vol_type, VolDepType::RealTimeData);
        assert!(vt.main.is_empty());
    }

    #[test]
    fn test_vol_types_default() {
        let vts = VolTypes::default();
        assert!(vts.vol_type.is_empty());
        assert!(vts.ext_lst.is_none());
    }

    #[test]
    fn test_vol_topic_nested() {
        let topic = VolTopic {
            topic_type: VolValueType::Str,
            value: "RTD.Server".to_string(),
            references: vec![
                VolTopicRef {
                    r: "A1".to_string(),
                    s: 0,
                },
                VolTopicRef {
                    r: "B2".to_string(),
                    s: 1,
                },
            ],
            sub_topics: vec![VolTopic {
                topic_type: VolValueType::Number,
                value: "42".to_string(),
                references: vec![],
                sub_topics: vec![],
            }],
        };

        assert_eq!(topic.topic_type, VolValueType::Str);
        assert_eq!(topic.value, "RTD.Server");
        assert_eq!(topic.references.len(), 2);
        assert_eq!(topic.references[0].r, "A1");
        assert_eq!(topic.references[1].s, 1);
        assert_eq!(topic.sub_topics.len(), 1);
        assert_eq!(topic.sub_topics[0].value, "42");
    }

    #[test]
    fn test_vol_dep_type_serde_roundtrip() {
        let original = VolDepType::OlapFunctions;
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: VolDepType = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_vol_types_serde_roundtrip() {
        let original = VolTypes {
            vol_type: vec![VolType {
                vol_type: VolDepType::RealTimeData,
                main: vec![VolMain {
                    first: "MyServer".to_string(),
                    topics: vec![VolTopic {
                        topic_type: VolValueType::Str,
                        value: "topic1".to_string(),
                        references: vec![VolTopicRef {
                            r: "A1".to_string(),
                            s: 0,
                        }],
                        sub_topics: vec![],
                    }],
                }],
            }],
            ext_lst: None,
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: VolTypes = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
