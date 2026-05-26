//! Miscellaneous simple worksheet types (CT_LegacyDrawing, CT_SheetCalcPr, CT_SheetBackgroundPicture).

/// Legacy drawing reference (CT_LegacyDrawing, sml.xsd §18.3.1.50).
///
/// References a VML drawing part via a relationship ID.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub struct LegacyDrawing {
    /// Relationship ID (r:id) pointing to the VML drawing part.
    pub r_id: String,
}

/// Sheet calculation properties (CT_SheetCalcPr, sml.xsd §18.3.1.74).
///
/// Controls whether a full recalculation is forced when the sheet is loaded.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub struct SheetCalcPr {
    /// Whether to force a full calculation on load (default: false per spec).
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub full_calc_on_load: bool,
}

impl SheetCalcPr {
    /// Returns the effective value of `full_calc_on_load` (default: false).
    pub fn effective_full_calc_on_load(&self) -> bool {
        self.full_calc_on_load
    }
}

/// Sheet background picture (CT_SheetBackgroundPicture, sml.xsd §18.3.1.73).
///
/// References an image part used as the sheet background via a relationship ID.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub struct SheetBackgroundPicture {
    /// Relationship ID (r:id) pointing to the image part.
    pub r_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_drawing_default() {
        let ld = LegacyDrawing::default();
        assert!(ld.r_id.is_empty());
    }

    #[test]
    fn legacy_drawing_serde_roundtrip() {
        let ld = LegacyDrawing {
            r_id: "rId1".to_string(),
        };
        let json = serde_json::to_string(&ld).unwrap();
        let deserialized: LegacyDrawing = serde_json::from_str(&json).unwrap();
        assert_eq!(ld, deserialized);
    }

    #[test]
    fn sheet_calc_pr_default_false() {
        let pr = SheetCalcPr::default();
        assert!(!pr.full_calc_on_load);
    }

    #[test]
    fn sheet_calc_pr_serde_skip_default() {
        let pr = SheetCalcPr::default();
        let json = serde_json::to_string(&pr).unwrap();
        assert!(
            !json.contains("full_calc_on_load"),
            "default false should be skipped: {json}"
        );
    }

    #[test]
    fn sheet_calc_pr_serde_roundtrip_true() {
        let pr = SheetCalcPr {
            full_calc_on_load: true,
        };
        let json = serde_json::to_string(&pr).unwrap();
        assert!(
            json.contains("full_calc_on_load"),
            "non-default should be serialized: {json}"
        );
        let deserialized: SheetCalcPr = serde_json::from_str(&json).unwrap();
        assert_eq!(pr, deserialized);
    }

    #[test]
    fn sheet_background_picture_default() {
        let pic = SheetBackgroundPicture::default();
        assert!(pic.r_id.is_empty());
    }

    #[test]
    fn sheet_background_picture_serde_roundtrip() {
        let pic = SheetBackgroundPicture {
            r_id: "rId5".to_string(),
        };
        let json = serde_json::to_string(&pic).unwrap();
        let deserialized: SheetBackgroundPicture = serde_json::from_str(&json).unwrap();
        assert_eq!(pic, deserialized);
    }
}
