/// Extract title text from a Title element.
pub(super) fn extract_title_text_from_title(title: &ooxml_types::charts::Title) -> Option<String> {
    use ooxml_types::charts::ChartText;
    use ooxml_types::drawings::TextRunContent;

    match &title.tx {
        Some(ChartText::Rich(body)) => {
            let mut parts = Vec::new();
            for para in &body.paragraphs {
                for run_content in &para.runs {
                    if let TextRunContent::Run(run) = run_content {
                        if !run.text.is_empty() {
                            parts.push(run.text.clone());
                        }
                    }
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(""))
            }
        }
        Some(ChartText::StrRef(str_ref)) => str_ref
            .str_cache
            .as_ref()
            .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
        None => None,
    }
}

pub(super) fn extract_chart_text_string(ct: &ooxml_types::charts::ChartText) -> Option<String> {
    use ooxml_types::charts::ChartText;
    use ooxml_types::drawings::TextRunContent;

    match ct {
        ChartText::Rich(body) => {
            let mut parts = Vec::new();
            for para in &body.paragraphs {
                for run_content in &para.runs {
                    if let TextRunContent::Run(run) = run_content {
                        if !run.text.is_empty() {
                            parts.push(run.text.clone());
                        }
                    }
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(""))
            }
        }
        ChartText::StrRef(str_ref) => str_ref
            .str_cache
            .as_ref()
            .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
    }
}

pub(super) fn extract_title_h_align(title: &ooxml_types::charts::Title) -> Option<String> {
    let align = title
        .tx
        .as_ref()
        .and_then(chart_text_body)
        .and_then(first_text_body_paragraph_align)
        .or_else(|| {
            title
                .tx_pr
                .as_ref()
                .and_then(first_text_body_paragraph_align)
        })?;
    title_horizontal_alignment_from_ooxml(align).map(str::to_string)
}

pub(super) fn extract_title_v_align(title: &ooxml_types::charts::Title) -> Option<String> {
    let anchor = title
        .tx
        .as_ref()
        .and_then(chart_text_body)
        .and_then(|body| body.body_props.anchor)
        .or_else(|| title.tx_pr.as_ref().and_then(|body| body.body_props.anchor))?;
    title_vertical_alignment_from_ooxml(anchor).map(str::to_string)
}

pub(super) fn extract_title_show_shadow(title: &ooxml_types::charts::Title) -> Option<bool> {
    title
        .sp_pr
        .as_ref()
        .and_then(|sp_pr| sp_pr.effects.as_ref())
        .is_some_and(effect_properties_has_shadow)
        .then_some(true)
}

fn chart_text_body(
    text: &ooxml_types::charts::ChartText,
) -> Option<&ooxml_types::drawings::TextBody> {
    match text {
        ooxml_types::charts::ChartText::Rich(body) => Some(body),
        ooxml_types::charts::ChartText::StrRef(_) => None,
    }
}

fn first_text_body_paragraph_align(
    body: &ooxml_types::drawings::TextBody,
) -> Option<ooxml_types::drawings::TextAlign> {
    body.paragraphs
        .iter()
        .find_map(|paragraph| paragraph.props.align)
}

fn title_horizontal_alignment_from_ooxml(
    align: ooxml_types::drawings::TextAlign,
) -> Option<&'static str> {
    match align {
        ooxml_types::drawings::TextAlign::Left => Some("left"),
        ooxml_types::drawings::TextAlign::Center => Some("center"),
        ooxml_types::drawings::TextAlign::Right => Some("right"),
        _ => None,
    }
}

fn title_vertical_alignment_from_ooxml(
    anchor: ooxml_types::drawings::TextAnchor,
) -> Option<&'static str> {
    match anchor {
        ooxml_types::drawings::TextAnchor::Top => Some("top"),
        ooxml_types::drawings::TextAnchor::Center => Some("middle"),
        ooxml_types::drawings::TextAnchor::Bottom => Some("bottom"),
        _ => None,
    }
}

fn effect_properties_has_shadow(effects: &ooxml_types::drawings::EffectProperties) -> bool {
    match effects {
        ooxml_types::drawings::EffectProperties::EffectList(list) => {
            list.outer_shadow.is_some()
                || list.inner_shadow.is_some()
                || list.preset_shadow.is_some()
        }
        ooxml_types::drawings::EffectProperties::EffectDag(container) => {
            container.effects.iter().any(dag_effect_has_shadow)
        }
    }
}

fn dag_effect_has_shadow(effect: &ooxml_types::drawings::DagEffect) -> bool {
    match effect {
        ooxml_types::drawings::DagEffect::OuterShadow(_)
        | ooxml_types::drawings::DagEffect::InnerShadow(_)
        | ooxml_types::drawings::DagEffect::PresetShadow(_) => true,
        ooxml_types::drawings::DagEffect::Container(container) => {
            container.effects.iter().any(dag_effect_has_shadow)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use ooxml_types::charts::{ChartText, Title};
    use ooxml_types::drawings::{
        EffectList, EffectProperties, OuterShadow, Paragraph, ParagraphProperties, ShapeProperties,
        TextAlign, TextAnchor, TextBody, TextBodyProperties,
    };

    use super::{extract_title_h_align, extract_title_show_shadow, extract_title_v_align};

    #[test]
    fn extracts_title_alignment_and_shadow() {
        let title = Title {
            tx: Some(ChartText::Rich(TextBody {
                body_props: TextBodyProperties {
                    anchor: Some(TextAnchor::Top),
                    ..Default::default()
                },
                paragraphs: vec![Paragraph {
                    props: ParagraphProperties {
                        align: Some(TextAlign::Center),
                        ..Default::default()
                    },
                    ..Default::default()
                }],
                ..Default::default()
            })),
            sp_pr: Some(ShapeProperties {
                effects: Some(EffectProperties::EffectList(EffectList {
                    outer_shadow: Some(OuterShadow::default()),
                    ..Default::default()
                })),
                ..Default::default()
            }),
            ..Default::default()
        };

        assert_eq!(extract_title_h_align(&title), Some("center".to_string()));
        assert_eq!(extract_title_v_align(&title), Some("top".to_string()));
        assert_eq!(extract_title_show_shadow(&title), Some(true));
    }
}
