//! EG_EffectProperties mirror — typed wrapper over CT_EffectList +
//! CT_EffectDag (typed OOXML preservation primitive).
//!
//! Mirror of `ooxml_types::drawings::EffectProperties`. The OOXML XSD
//! EG_EffectProperties group is a two-way choice:
//!
//! - `<a:effectLst>` (CT_EffectList) — a simple "record of optional
//!   effects" (blur, fillOverlay, glow, innerShadow, outerShadow,
//!   presetShadow, reflection, softEdge).
//! - `<a:effectDag>` (CT_EffectContainer) — a recursive DAG of effects
//!   with container nodes (sib / tree) that nests an unbounded list of
//!   `EG_Effect` choices.
//!
//! The `EffectDag` variant is extremely rare in spreadsheet drawings —
//! the common case is `EffectList`. This module ships the `EffectList`
//! variant as a typed record that consumes the existing domain effect
//! primitives (InnerShadow / Glow / SoftEdge / Blur / Reflection and
//! OuterShadow from `domain::floating_object`). The
//! `EffectDag` variant is preserved as opaque raw XML with a
//! `TODO(typed OOXML preservation)` marker — typing the full recursive container
//! tree is deferred until the corpus shows it matters.

use serde::{Deserialize, Serialize};

use super::effects::{BlurEffect, GlowEffect, InnerShadowEffect, ReflectionEffect, SoftEdgeEffect};
use crate::domain::floating_object::OuterShadowEffect;

// ===========================================================================
// EffectList (CT_EffectList)
// ===========================================================================

/// Simple effect list — CT_EffectList. Each field is optional; only
/// present effects serialize.
///
/// Matches the OOXML child-element order on write: `blur`,
/// `fill_overlay` (deferred — rare), `glow`, `inner_shadow`,
/// `outer_shadow`, `preset_shadow` (deferred — rare), `reflection`,
/// `soft_edge`.
///
/// `Default` emits `{}` — an empty `<a:effectLst/>` is a legitimate
/// OOXML value (present element, no children) and writers can detect
/// the "effectLst present but empty" case via the enclosing
/// `Option<EffectProperties>`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct EffectListSpec {
    /// `<a:blur>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur: Option<BlurEffect>,
    /// `<a:glow>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glow: Option<GlowEffect>,
    /// `<a:innerShdw>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_shadow: Option<InnerShadowEffect>,
    /// `<a:outerShdw>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outer_shadow: Option<OuterShadowEffect>,
    /// `<a:reflection>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reflection: Option<ReflectionEffect>,
    /// `<a:softEdge>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soft_edge: Option<SoftEdgeEffect>,
    /// `<a:fillOverlay>` raw XML (rare; typing deferred).
    ///
    /// TODO(typed OOXML preservation): type CT_FillOverlayEffect.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_overlay_raw_xml: Option<String>,
    /// `<a:prstShdw>` raw XML (rare; typing deferred).
    ///
    /// TODO(typed OOXML preservation): type CT_PresetShadowEffect.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset_shadow_raw_xml: Option<String>,
}

impl EffectListSpec {
    /// Returns `true` if no effects are set.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.blur.is_none()
            && self.glow.is_none()
            && self.inner_shadow.is_none()
            && self.outer_shadow.is_none()
            && self.reflection.is_none()
            && self.soft_edge.is_none()
            && self.fill_overlay_raw_xml.is_none()
            && self.preset_shadow_raw_xml.is_none()
    }
}

// ===========================================================================
// EffectProperties (EG_EffectProperties)
// ===========================================================================

/// Shape-level effect properties — the effectLst vs effectDag choice
/// (EG_EffectProperties).
///
/// The `EffectDag` variant is preserved opaquely as raw XML because the
/// recursive CT_EffectContainer shape is rare in spreadsheet drawings
/// and typing the full DAG adds a lot of surface for little corpus
/// coverage. This can be upgraded to a typed container if the corpus shows
/// drift.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
// EG_EffectProperties mirrors the OOXML choice directly; boxing would leak
// storage strategy into the domain vocabulary instead of clarifying ownership.
#[allow(clippy::large_enum_variant)]
pub enum EffectProperties {
    /// `<a:effectLst>` — the simple list form.
    EffectList(EffectListSpec),
    /// `<a:effectDag>` — recursive container form, preserved opaquely.
    ///
    /// TODO(typed OOXML preservation): type CT_EffectContainer.
    #[serde(rename_all = "camelCase")]
    EffectDag { raw_xml: String },
}

impl Default for EffectProperties {
    /// Default is an empty `EffectList` — matches the common "effects
    /// present but none set" shape.
    fn default() -> Self {
        Self::EffectList(EffectListSpec::default())
    }
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================
//
// The OOXML `EffectList` has two extra fields this domain-level list
// does not yet type (`fill_overlay`, `preset_shadow`) — they round-trip
// through `*_raw_xml` opaque passthroughs. The domain effect types
// (InnerShadow / Glow / SoftEdge / Blur / Reflection / OuterShadow)
// are simplified UI-ergonomic shapes (f64 + hex-string) and do not
// round-trip *structurally* with their `ooxml_types` counterparts.
// Rather than hide that gap behind a lossy converter, this module ships
// only the `EffectProperties` choice wrapper and `EffectListSpec`
// container. Per-effect converters can either widen the domain effect types to
// lossless forms, or keep the
// UI view and add lossless side-cars). Testing here exercises the
// container shape and the EffectDag raw-xml round-trip.
//
// What we *do* provide: round-trip of the top-level choice shape
// (EffectList vs EffectDag) against `ooxml_types::EffectProperties`,
// treating the `EffectList` body as opaque at the choice level (the
// container recognizes "is it list or dag" and preserves either).

use ooxml_types::drawings as odraw;

impl From<&odraw::EffectProperties> for EffectProperties {
    fn from(e: &odraw::EffectProperties) -> Self {
        match e {
            odraw::EffectProperties::EffectList(_) => {
                // Structural shape: recognized as EffectList, body left
                // to a domain-effect-aware converter on top of widened effect
                // primitives. For now, ship an empty EffectListSpec — callers writing
                // domain EffectList content construct it explicitly.
                Self::EffectList(EffectListSpec::default())
            }
            odraw::EffectProperties::EffectDag(_) => {
                // Same story — the DAG body is preserved via a
                // dedicated opaque XML pipeline on the parser side;
                // this converter shape only recognizes the choice.
                Self::EffectDag {
                    raw_xml: String::new(),
                }
            }
        }
    }
}

impl From<EffectProperties> for odraw::EffectProperties {
    fn from(e: EffectProperties) -> Self {
        match e {
            EffectProperties::EffectList(_) => {
                // Round-trip the choice shape; the body belongs to per-effect
                // converters once the domain effect primitives are widened.
                Self::EffectList(odraw::EffectList::default())
            }
            EffectProperties::EffectDag { .. } => {
                Self::EffectDag(odraw::EffectContainer::default())
            }
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
    fn default_is_empty_effect_list() {
        let e = EffectProperties::default();
        match e {
            EffectProperties::EffectList(l) => assert!(l.is_empty()),
            _ => panic!("expected EffectList default"),
        }
    }

    #[test]
    fn effect_list_spec_default_emits_no_keys() {
        let l = EffectListSpec::default();
        assert_eq!(serde_json::to_string(&l).unwrap(), "{}");
    }

    #[test]
    fn effect_list_spec_is_empty() {
        let l = EffectListSpec::default();
        assert!(l.is_empty());
        let with_blur = EffectListSpec {
            blur: Some(BlurEffect::default()),
            ..EffectListSpec::default()
        };
        assert!(!with_blur.is_empty());
    }

    #[test]
    fn tagged_enum_json_shape() {
        let list = EffectProperties::EffectList(EffectListSpec::default());
        let json = serde_json::to_string(&list).unwrap();
        assert_eq!(json, r#"{"type":"effectList"}"#);

        let dag = EffectProperties::EffectDag {
            raw_xml: "DAG".into(),
        };
        let json = serde_json::to_string(&dag).unwrap();
        // Serde internally-tagged enums: tag + inlined struct fields.
        assert!(
            json.contains(r#""type":"effectDag""#),
            "missing type discriminator in {json}"
        );
        assert!(
            json.contains(r#""rawXml":"DAG""#),
            "missing rawXml field in {json}"
        );
    }

    #[test]
    fn effect_list_spec_with_typed_fields_serializes_camelcase() {
        let l = EffectListSpec {
            blur: Some(BlurEffect {
                radius: 10.0,
                grow: false,
            }),
            outer_shadow: Some(OuterShadowEffect::default()),
            ..EffectListSpec::default()
        };
        let json = serde_json::to_string(&l).unwrap();
        assert!(json.contains("\"blur\""));
        assert!(json.contains("\"outerShadow\""));
    }

    #[test]
    fn effect_properties_choice_discriminates() {
        // Parsing an effectList variant and serializing back retains the
        // `effectList` tag, and the same for effectDag.
        let list_src = EffectProperties::EffectList(EffectListSpec {
            blur: Some(BlurEffect {
                radius: 5.0,
                grow: true,
            }),
            ..EffectListSpec::default()
        });
        let json = serde_json::to_string(&list_src).unwrap();
        let round: EffectProperties = serde_json::from_str(&json).unwrap();
        match round {
            EffectProperties::EffectList(l) => {
                assert_eq!(l.blur.map(|b| b.radius), Some(5.0));
            }
            _ => panic!("expected effectList"),
        }

        let dag_src = EffectProperties::EffectDag {
            raw_xml: "<a:effectDag/>".into(),
        };
        let json = serde_json::to_string(&dag_src).unwrap();
        let round: EffectProperties = serde_json::from_str(&json).unwrap();
        match round {
            EffectProperties::EffectDag { raw_xml } => {
                assert_eq!(raw_xml, "<a:effectDag/>");
            }
            _ => panic!("expected effectDag"),
        }
    }

    #[test]
    fn choice_shape_converts_to_ooxml() {
        // The container-choice converter recognizes effectList vs
        // effectDag; body parity belongs to per-effect converters.
        let list_dom = EffectProperties::EffectList(EffectListSpec::default());
        let list_ooxml: odraw::EffectProperties = list_dom.into();
        assert!(matches!(list_ooxml, odraw::EffectProperties::EffectList(_)));

        let dag_dom = EffectProperties::EffectDag {
            raw_xml: String::new(),
        };
        let dag_ooxml: odraw::EffectProperties = dag_dom.into();
        assert!(matches!(dag_ooxml, odraw::EffectProperties::EffectDag(_)));
    }
}
