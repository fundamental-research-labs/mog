//! Hyperlink reference — CT_Hyperlink mirror (typed OOXML preservation A.7 primitive).
//!
//! `HyperlinkRef` is the domain-level mirror of
//! `ooxml_types::drawings::Hyperlink` (CT_Hyperlink). Used by non-visual
//! drawing props (`hlinkClick` / `hlinkHover` on pictures, shapes, connectors)
//! and by run-property hyperlinks (`hlinkClick` / `hlinkMouseOver` on text
//! runs). Carries the `r:id` relationship plus the action / tooltip / history
//! / highlight / end-sound metadata; the resolved URL is cached alongside so
//! UI consumers don't have to re-walk the OPC relationships table.
//!
//! `Default` emits no JSON keys.

use serde::{Deserialize, Serialize};

/// Hyperlink reference (CT_Hyperlink).
///
/// Covers the full attribute surface of `CT_Hyperlink` modulo the `snd`
/// (embedded WAV) child element, which is stored as `sound_ref` (r:id) here
/// and reassembled by the writer. `ext_lst` is preserved as opaque XML.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct HyperlinkRef {
    /// Resolved target URL (cache — not in XSD). Populated by the parser
    /// from the OPC relationship lookup keyed by `rel_id`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Relationship id (`r:id`) pointing at the target in the OPC
    /// relationships table.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel_id: Option<String>,
    /// Original URL preserved when the hyperlink was flagged invalid.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invalid_url: Option<String>,
    /// Action token (e.g. `"ppaction://hlinksldjump"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Hover tooltip text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    /// Navigation frame target (`@tgtFrame`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tgt_frame: Option<String>,
    /// Whether to add this navigation to browser history (spec default true).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<bool>,
    /// Whether to highlight the anchor on click (spec default false).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight_click: Option<bool>,
    /// Whether the previous sound should stop when the link is activated
    /// (spec default false).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_sound: Option<bool>,
    /// Relationship id for an embedded `<a:snd>` WAV sound (deferred in the
    /// ooxml-types layer; captured here for forward compatibility).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound_ref: Option<String>,
    /// Extension list — opaque XML passthrough (CT_Hyperlink extLst).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings::Hyperlink as OHyperlink;

impl From<&OHyperlink> for HyperlinkRef {
    fn from(h: &OHyperlink) -> Self {
        Self {
            url: h.url.clone(),
            rel_id: h.r_id.clone(),
            invalid_url: h.invalid_url.clone(),
            action: h.action.clone(),
            tooltip: h.tooltip.clone(),
            tgt_frame: h.tgt_frame.clone(),
            history: h.history,
            highlight_click: h.highlight_click,
            end_sound: h.end_snd,
            // The ooxml-types layer does not carry `snd` yet; preserved here
            // so when the edge type gains it, this converter does not need a
            // breaking change.
            sound_ref: None,
            ext_lst: h.ext_lst.clone(),
        }
    }
}

impl From<HyperlinkRef> for OHyperlink {
    fn from(h: HyperlinkRef) -> Self {
        Self {
            url: h.url,
            r_id: h.rel_id,
            action: h.action,
            tooltip: h.tooltip,
            tgt_frame: h.tgt_frame,
            invalid_url: h.invalid_url,
            history: h.history,
            highlight_click: h.highlight_click,
            end_snd: h.end_sound,
            ext_lst: h.ext_lst,
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_emits_no_keys() {
        let h = HyperlinkRef::default();
        let json = serde_json::to_string(&h).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn round_trip_full_surface() {
        let original = OHyperlink {
            url: Some("https://example.com/x".into()),
            r_id: Some("rId42".into()),
            action: Some("ppaction://hlinksldjump".into()),
            tooltip: Some("Go to slide 4".into()),
            tgt_frame: Some("_blank".into()),
            invalid_url: None,
            history: Some(false),
            highlight_click: Some(true),
            end_snd: Some(true),
            ext_lst: Some("<a:extLst><a:ext uri=\"{abc}\"/></a:extLst>".into()),
        };
        let dom: HyperlinkRef = (&original).into();
        let round: OHyperlink = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn round_trip_minimal() {
        let original = OHyperlink {
            r_id: Some("rId1".into()),
            ..Default::default()
        };
        let dom: HyperlinkRef = (&original).into();
        let round: OHyperlink = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn round_trip_invalid_url() {
        let original = OHyperlink {
            invalid_url: Some("ht!tp://broken".into()),
            ..Default::default()
        };
        let dom: HyperlinkRef = (&original).into();
        let round: OHyperlink = dom.into();
        assert_eq!(original, round);
    }
}
