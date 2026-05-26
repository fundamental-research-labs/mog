//! VML shape-level round-trip properties for form controls.
//!
//! [`VmlShapeProps`] mirrors the `v:shape` element and its children inside
//! `vmlDrawing*.vml`. It lives in `domain-types` — rather than in
//! `xlsx-parser` where it used to live — so that
//! `FormControlOoxmlProps.vml_shape` can be a typed field instead of a
//! `serde_json::Value` blob (typed OOXML preservation).

use serde::{Deserialize, Serialize};

/// VML shape-level visual properties for form controls.
///
/// These properties come from the `v:shape` element and its children in
/// `vmlDrawing*.vml` files. They have no equivalent in the modern
/// `ctrlProp*.xml` (CT_FormControlPr) format, so they must be parsed from
/// VML and written back to VML for lossless round-trip.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmlShapeProps {
    /// The full VML style string (e.g. "position:absolute;margin-left:441.75pt;...").
    pub style: Option<String>,
    /// `o:button="t"` — marks the shape as a button.
    pub is_button: bool,
    /// `fillcolor` attribute (e.g. "buttonFace [67]").
    pub fillcolor: Option<String>,
    /// `strokecolor` attribute (e.g. "windowText [64]").
    pub strokecolor: Option<String>,
    /// Raw `<v:fill .../>` child element XML.
    pub fill_xml: Option<String>,
    /// Raw `<o:lock .../>` child element XML.
    pub lock_xml: Option<String>,
    /// Textbox `style` attribute (e.g. "mso-direction-alt:auto").
    pub textbox_style: Option<String>,
    /// Textbox `o:singleclick` attribute.
    pub textbox_singleclick: Option<String>,
    /// Raw HTML content inside `<v:textbox>` (the div with font/text).
    pub textbox_content: Option<String>,
    /// The `data` attribute from `<o:idmap>` (e.g. "1", "12"). Indicates which
    /// shape ID range this VML file manages.
    pub idmap_data: Option<String>,
}
