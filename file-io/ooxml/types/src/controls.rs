//! ActiveX control types (ECMA-376 Part 1, Section 18.3).
//!
//! Types modelling embedded ActiveX controls within worksheets, including
//! control property bags and the wrapper collection.

// ============================================================================
// ControlPr — CT_ControlPr
// ============================================================================

/// Control display and behaviour properties (CT_ControlPr).
///
/// Controls visual presentation and interaction settings for an embedded
/// ActiveX control within a worksheet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ControlPr {
    /// Object anchor positioning (required per XSD, but modelled as Option
    /// for ergonomic construction — callers should always set this).
    pub anchor: Option<crate::ole::ObjectAnchor>,
    /// Whether the control is locked when the sheet is protected. Default: `true`.
    pub locked: bool,
    /// Whether the control uses its default size. Default: `true`.
    pub default_size: bool,
    /// Whether the control is printed. Default: `true`.
    pub print: bool,
    /// Whether the control is disabled. Default: `false`.
    pub disabled: bool,
    /// Whether to recalculate always. Default: `false`.
    pub recalc_always: bool,
    /// Whether the control is a UI object (not user-selectable). Default: `false`.
    pub ui_object: bool,
    /// Whether to auto-fill the background. Default: `true`.
    pub auto_fill: bool,
    /// Whether to auto-draw the border line. Default: `true`.
    pub auto_line: bool,
    /// Whether to auto-size the picture. Default: `true`.
    pub auto_pict: bool,
    /// Associated macro name.
    pub macro_name: Option<String>,
    /// Alternative text for accessibility.
    pub alt_text: Option<String>,
    /// Linked cell reference for the control value.
    pub linked_cell: Option<String>,
    /// Cell range providing list fill data.
    pub list_fill_range: Option<String>,
    /// Clipboard format identifier.
    pub cf: Option<String>,
    /// Relationship ID to the control image.
    pub r_id: Option<String>,
}

impl ControlPr {
    /// Returns the effective clipboard format, using the XSD default of `"pict"`
    /// when the field is absent.
    #[must_use]
    pub fn effective_cf(&self) -> &str {
        self.cf.as_deref().unwrap_or("pict")
    }
}

impl Default for ControlPr {
    fn default() -> Self {
        Self {
            anchor: None,
            locked: true,
            default_size: true,
            print: true,
            disabled: false,
            recalc_always: false,
            ui_object: false,
            auto_fill: true,
            auto_line: true,
            auto_pict: true,
            macro_name: None,
            alt_text: None,
            linked_cell: None,
            list_fill_range: None,
            cf: None,
            r_id: None,
        }
    }
}

// ============================================================================
// Control — CT_Control
// ============================================================================

/// An embedded ActiveX control reference (CT_Control).
///
/// Associates a shape ID with a relationship to an ActiveX control part and
/// optional display properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Control {
    /// Shape ID within the drawing (required).
    pub shape_id: u32,
    /// Relationship ID to the ActiveX control part (required).
    pub r_id: String,
    /// Optional display name of the control.
    pub name: Option<String>,
    /// Control display and behaviour properties.
    pub control_pr: Option<ControlPr>,
}

// ============================================================================
// Controls — CT_Controls (wrapper)
// ============================================================================

/// Collection of embedded ActiveX controls (CT_Controls).
///
/// Wrapper around a list of [`Control`] entries within a worksheet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Controls {
    /// Control entries.
    pub controls: Vec<Control>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_pr_defaults() {
        let pr = ControlPr::default();
        assert!(pr.anchor.is_none());
        assert!(pr.locked);
        assert!(pr.default_size);
        assert!(pr.print);
        assert!(!pr.disabled);
        assert!(!pr.recalc_always);
        assert!(!pr.ui_object);
        assert!(pr.auto_fill);
        assert!(pr.auto_line);
        assert!(pr.auto_pict);
        assert!(pr.macro_name.is_none());
        assert!(pr.alt_text.is_none());
        assert!(pr.linked_cell.is_none());
        assert!(pr.list_fill_range.is_none());
        assert!(pr.cf.is_none());
        assert_eq!(pr.effective_cf(), "pict");
        assert!(pr.r_id.is_none());
    }

    #[test]
    fn control_defaults() {
        let c = Control::default();
        assert_eq!(c.shape_id, 0);
        assert!(c.r_id.is_empty());
        assert!(c.name.is_none());
        assert!(c.control_pr.is_none());
    }

    #[test]
    fn controls_default() {
        let cs = Controls::default();
        assert!(cs.controls.is_empty());
    }
}
