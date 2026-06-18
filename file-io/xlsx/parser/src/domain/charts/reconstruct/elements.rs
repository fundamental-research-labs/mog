use domain_types::chart::{
    ChartDataTableData, ChartFontData, ChartFormatData, ChartFormatStringData, ChartView3DData,
    DataLabelData, LegendData, LegendEntryData,
};
use ooxml_types::charts::{
    self, ChartLines, ChartSurface, ChartText, DataLabel, DataLabelOptions, DataLabelPosition,
    DataTableConfig, ExtensionEntry, LegendPosition, NumFmt, StrRef, View3D,
};
use ooxml_types::drawings::{
    ColorTransform, DrawingColor, EffectList, EffectProperties, OuterShadow, Paragraph,
    ParagraphProperties, ShapeProperties, StAngle, StPositiveCoordinate, TextAlign, TextAnchor,
    TextBody, TextRun, TextRunContent,
};

use super::formatting::{
    build_outline, build_run_properties, build_shape_properties, build_text_body,
};
use crate::domain::charts::data_label_contract_ext::build_data_label_contract_extension;

pub(super) fn build_title(
    text: Option<&str>,
    format: Option<&ChartFormatData>,
    rich_text: Option<&[ChartFormatStringData]>,
    layout: Option<&domain_types::domain::drawings::ManualLayout>,
    horizontal_alignment: Option<&str>,
    vertical_alignment: Option<&str>,
    show_shadow: Option<bool>,
) -> Option<charts::Title> {
    let default_font = format.and_then(|f| f.font.as_ref());
    if let Some(runs) = rich_text.filter(|runs| runs.iter().any(|run| !run.text.is_empty())) {
        return Some(build_title_with_text(
            build_chart_text_rich_runs(runs, default_font),
            format,
            layout,
            horizontal_alignment,
            vertical_alignment,
            show_shadow,
        ));
    }

    let text = text?;
    // Guard against the literal string "undefined" leaking from JS bridge serialization.
    if text == "undefined" || text.is_empty() {
        return None;
    }
    Some(build_title_element(
        text,
        format,
        layout,
        horizontal_alignment,
        vertical_alignment,
        show_shadow,
    ))
}

pub(super) fn build_title_element(
    text: &str,
    format: Option<&ChartFormatData>,
    layout: Option<&domain_types::domain::drawings::ManualLayout>,
    horizontal_alignment: Option<&str>,
    vertical_alignment: Option<&str>,
    show_shadow: Option<bool>,
) -> charts::Title {
    build_title_with_text(
        build_chart_text_rich(text, format.and_then(|f| f.font.as_ref())),
        format,
        layout,
        horizontal_alignment,
        vertical_alignment,
        show_shadow,
    )
}

fn build_title_with_text(
    mut tx: ChartText,
    format: Option<&ChartFormatData>,
    layout: Option<&domain_types::domain::drawings::ManualLayout>,
    horizontal_alignment: Option<&str>,
    vertical_alignment: Option<&str>,
    show_shadow: Option<bool>,
) -> charts::Title {
    apply_title_text_alignment(&mut tx, horizontal_alignment, vertical_alignment);
    let sp_pr = build_title_shape_properties(format, show_shadow);

    charts::Title {
        tx: Some(tx),
        layout: layout.cloned().map(Into::into),
        sp_pr,
        ..Default::default()
    }
}

fn apply_title_text_alignment(
    tx: &mut ChartText,
    horizontal_alignment: Option<&str>,
    vertical_alignment: Option<&str>,
) {
    let ChartText::Rich(body) = tx else {
        return;
    };
    if let Some(anchor) = vertical_alignment.and_then(title_vertical_alignment_to_ooxml) {
        body.body_props.anchor = Some(anchor);
    }
    if let Some(align) = horizontal_alignment.and_then(title_horizontal_alignment_to_ooxml) {
        for paragraph in &mut body.paragraphs {
            paragraph.props.align = Some(align);
        }
    }
}

fn build_title_shape_properties(
    format: Option<&ChartFormatData>,
    show_shadow: Option<bool>,
) -> Option<ShapeProperties> {
    let mut sp_pr = format.and_then(build_shape_properties);
    if show_shadow != Some(true) {
        return sp_pr;
    }

    let sp_pr = sp_pr.get_or_insert_with(ShapeProperties::default);
    sp_pr.effects = Some(EffectProperties::EffectList(EffectList {
        outer_shadow: Some(default_title_outer_shadow()),
        ..Default::default()
    }));
    Some(sp_pr.clone())
}

fn default_title_outer_shadow() -> OuterShadow {
    OuterShadow {
        blur_rad: StPositiveCoordinate::new_clamped(38_100),
        dist: StPositiveCoordinate::new_clamped(38_100),
        dir: StAngle::new(2_700_000),
        color: Some(DrawingColor::SrgbClr {
            val: "000000".to_string(),
            transforms: vec![ColorTransform::Alpha { val: 43_137 }],
        }),
        rot_with_shape: false,
        ..Default::default()
    }
}

fn title_horizontal_alignment_to_ooxml(value: &str) -> Option<TextAlign> {
    match value {
        "left" => Some(TextAlign::Left),
        "center" => Some(TextAlign::Center),
        "right" => Some(TextAlign::Right),
        _ => None,
    }
}

fn title_vertical_alignment_to_ooxml(value: &str) -> Option<TextAnchor> {
    match value {
        "top" => Some(TextAnchor::Top),
        "middle" => Some(TextAnchor::Center),
        "bottom" => Some(TextAnchor::Bottom),
        _ => None,
    }
}

fn angle_degrees_to_ooxml(value: f64) -> StAngle {
    StAngle::new((value * 60_000.0).round() as i32)
}

/// Build a ChartText::Rich from a plain string and optional font.
pub(super) fn build_chart_text_rich(text: &str, font: Option<&ChartFontData>) -> ChartText {
    let def_rpr = font.map(|f| Box::new(build_run_properties(f)));

    let run = TextRunContent::Run(TextRun {
        text: text.to_string(),
        props: font.map(build_run_properties).unwrap_or_default(),
    });

    let para = Paragraph {
        props: ParagraphProperties {
            def_run_props: def_rpr,
            ..Default::default()
        },
        runs: vec![run],
        end_para_rpr: None,
    };

    ChartText::Rich(TextBody {
        body_props: Default::default(),
        list_style: None,
        paragraphs: vec![para],
    })
}

/// Build a ChartText::Rich from already segmented rich-text runs.
pub(super) fn build_chart_text_rich_runs(
    runs: &[ChartFormatStringData],
    default_font: Option<&ChartFontData>,
) -> ChartText {
    let def_rpr = default_font.map(|f| Box::new(build_run_properties(f)));

    let runs = runs
        .iter()
        .filter(|run| !run.text.is_empty())
        .flat_map(|run| {
            let font = run.font.as_ref().or(default_font);
            run.text
                .split('\n')
                .enumerate()
                .flat_map(move |(index, text)| {
                    let line_break = (index > 0).then(|| TextRunContent::LineBreak {
                        props: font.map(build_run_properties),
                    });
                    let text_run = (!text.is_empty()).then(|| {
                        TextRunContent::Run(TextRun {
                            text: text.to_string(),
                            props: font.map(build_run_properties).unwrap_or_default(),
                        })
                    });
                    line_break.into_iter().chain(text_run)
                })
        })
        .collect();

    let para = Paragraph {
        props: ParagraphProperties {
            def_run_props: def_rpr,
            ..Default::default()
        },
        runs,
        end_para_rpr: None,
    };

    ChartText::Rich(TextBody {
        body_props: Default::default(),
        list_style: None,
        paragraphs: vec![para],
    })
}

pub(super) fn build_legend(ld: &LegendData) -> Option<charts::Legend> {
    if !ld.visible && !ld.show {
        return None;
    }

    let legend_pos = Some(match ld.position.as_str() {
        "bottom" | "b" => LegendPosition::Bottom,
        "top" | "t" => LegendPosition::Top,
        "left" | "l" => LegendPosition::Left,
        "right" | "r" => LegendPosition::Right,
        "topRight" | "top-right" | "corner" | "tr" => LegendPosition::TopRight,
        _ => LegendPosition::Right,
    });

    let legend_entry = ld
        .entries
        .as_ref()
        .map(|entries| entries.iter().map(build_legend_entry).collect())
        .unwrap_or_default();

    let sp_pr = ld.format.as_ref().and_then(build_shape_properties);
    let tx_pr = ld.format.as_ref().and_then(build_text_body);

    Some(charts::Legend {
        legend_pos,
        legend_entry,
        layout: ld.layout.clone().map(Into::into),
        overlay: ld.overlay,
        sp_pr,
        tx_pr,
        ..Default::default()
    })
}

pub(super) fn build_legend_entry(entry: &LegendEntryData) -> charts::LegendEntry {
    let tx_pr = entry.format.as_ref().and_then(build_text_body);
    let delete = match (entry.delete, entry.visible) {
        (Some(value), _) => Some(value),
        (None, Some(false)) => Some(true),
        _ => None,
    };

    charts::LegendEntry {
        idx: entry.idx,
        delete,
        tx_pr,
        ..Default::default()
    }
}

pub(super) fn build_data_labels(dl: &DataLabelData) -> DataLabelOptions {
    let position = dl
        .position
        .as_deref()
        .map(data_label_position_from_domain)
        .unwrap_or_default();

    let num_fmt = dl.number_format.clone();
    let num_fmt_obj = dl.number_format.as_ref().map(|code| NumFmt {
        format_code: code.clone(),
        source_linked: dl.link_number_format.or(Some(false)),
    });

    let sp_pr = dl.visual_format.as_ref().and_then(build_shape_properties);
    let tx_pr = build_data_label_text_body(dl);
    let extensions = build_data_label_extensions(dl);

    DataLabelOptions {
        delete: dl.delete,
        show_value: dl.show_value.unwrap_or(false),
        show_category: dl.show_category_name.unwrap_or(false),
        show_series_name: dl.show_series_name.unwrap_or(false),
        show_percent: dl.show_percentage.unwrap_or(false),
        show_bubble_size: dl.show_bubble_size.unwrap_or(false),
        show_legend_key: dl.show_legend_key.unwrap_or(false),
        show_value_present: dl.show_value.is_some(),
        show_category_present: dl.show_category_name.is_some(),
        show_series_name_present: dl.show_series_name.is_some(),
        show_percent_present: dl.show_percentage.is_some(),
        show_bubble_size_present: dl.show_bubble_size.is_some(),
        show_legend_key_present: dl.show_legend_key.is_some(),
        position,
        separator: dl.separator.clone(),
        num_fmt,
        num_fmt_obj,
        layout: dl.layout.clone().map(Into::into),
        sp_pr,
        tx_pr,
        show_leader_lines: dl.show_leader_lines,
        leader_lines: dl.leader_lines_format.as_ref().map(|line| ChartLines {
            sp_pr: Some(ooxml_types::drawings::ShapeProperties {
                ln: Some(build_outline(line)),
                ..Default::default()
            }),
        }),
        extensions,
        ..Default::default()
    }
}

pub(super) fn build_data_label_override(idx: u32, dl: &DataLabelData) -> DataLabel {
    let default_font = dl.visual_format.as_ref().and_then(|f| f.font.as_ref());
    let tx = dl
        .rich_text
        .as_deref()
        .filter(|runs| runs.iter().any(|run| !run.text.is_empty()))
        .map(|runs| build_chart_text_rich_runs(runs, default_font))
        .or_else(|| {
            dl.text
                .as_ref()
                .map(|text| build_chart_text_rich(text, default_font))
        })
        .or_else(|| {
            dl.formula.as_ref().map(|formula| {
                ChartText::StrRef(StrRef {
                    f: formula.clone(),
                    ..Default::default()
                })
            })
        });
    let sp_pr = dl.visual_format.as_ref().and_then(build_shape_properties);
    let tx_pr = build_data_label_text_body(dl);
    let num_fmt = dl.number_format.as_ref().map(|code| NumFmt {
        format_code: code.clone(),
        source_linked: dl.link_number_format,
    });

    DataLabel {
        idx,
        layout: dl.layout.clone().map(Into::into),
        text: tx,
        sp_pr,
        tx_pr,
        num_fmt,
        delete: dl.delete,
        show_value: dl.show_value,
        show_category: dl.show_category_name,
        show_series_name: dl.show_series_name,
        show_percent: dl.show_percentage,
        show_legend_key: dl.show_legend_key,
        show_bubble_size: dl.show_bubble_size,
        position: dl.position.as_deref().map(data_label_position_from_domain),
        separator: dl.separator.clone(),
        extensions: build_data_label_extensions(dl),
    }
}

fn build_data_label_extensions(dl: &DataLabelData) -> Vec<ExtensionEntry> {
    build_data_label_contract_extension(dl)
        .into_iter()
        .collect()
}

fn build_data_label_text_body(dl: &DataLabelData) -> Option<TextBody> {
    let default_font = dl
        .visual_format
        .as_ref()
        .and_then(|format| format.font.as_ref());
    let format_body = dl.visual_format.as_ref().and_then(build_text_body);
    let rich_body = dl
        .rich_text
        .as_deref()
        .filter(|runs| runs.iter().any(|run| !run.text.is_empty()))
        .and_then(
            |runs| match build_chart_text_rich_runs(runs, default_font) {
                ChartText::Rich(body) => Some(body),
                ChartText::StrRef(_) => None,
            },
        );

    let needs_text_properties = dl.horizontal_alignment.is_some()
        || dl.vertical_alignment.is_some()
        || dl.text_orientation.is_some();
    let mut body = match (rich_body, format_body) {
        (Some(mut rich_body), Some(format_body)) => {
            merge_data_label_text_body_format(&mut rich_body, &format_body);
            Some(rich_body)
        }
        (Some(rich_body), None) => Some(rich_body),
        (None, Some(format_body)) => Some(format_body),
        (None, None) if needs_text_properties => Some(empty_text_body(default_font)),
        (None, None) => None,
    }?;

    apply_data_label_text_properties(&mut body, dl);
    Some(body)
}

fn merge_data_label_text_body_format(target: &mut TextBody, format: &TextBody) {
    target.body_props = format.body_props.clone();
    if target.list_style.is_none() {
        target.list_style = format.list_style.clone();
    }

    let default_props = format
        .paragraphs
        .first()
        .and_then(|paragraph| paragraph.props.def_run_props.clone());
    let end_para_props = format
        .paragraphs
        .first()
        .and_then(|paragraph| paragraph.end_para_rpr.clone());
    for paragraph in &mut target.paragraphs {
        if paragraph.props.def_run_props.is_none() {
            paragraph.props.def_run_props = default_props.clone();
        }
        if paragraph.end_para_rpr.is_none() {
            paragraph.end_para_rpr = end_para_props.clone();
        }
    }
}

fn empty_text_body(default_font: Option<&ChartFontData>) -> TextBody {
    TextBody {
        body_props: Default::default(),
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties {
                def_run_props: default_font.map(|font| Box::new(build_run_properties(font))),
                ..Default::default()
            },
            runs: Vec::new(),
            end_para_rpr: None,
        }],
    }
}

fn apply_data_label_text_properties(body: &mut TextBody, dl: &DataLabelData) {
    if let Some(rotation) = dl.text_orientation {
        body.body_props.rot = Some(angle_degrees_to_ooxml(rotation));
    }
    if let Some(anchor) = dl
        .vertical_alignment
        .as_deref()
        .and_then(title_vertical_alignment_to_ooxml)
    {
        body.body_props.anchor = Some(anchor);
    }
    let Some(align) = dl
        .horizontal_alignment
        .as_deref()
        .and_then(title_horizontal_alignment_to_ooxml)
    else {
        return;
    };

    if body.paragraphs.is_empty() {
        body.paragraphs.push(Paragraph::default());
    }
    for paragraph in &mut body.paragraphs {
        paragraph.props.align = Some(align);
    }
}

fn data_label_position_from_domain(value: &str) -> DataLabelPosition {
    match value {
        "outside" | "outsideEnd" | "outEnd" => DataLabelPosition::OutsideEnd,
        "inside" | "insideEnd" | "inEnd" => DataLabelPosition::InsideEnd,
        "insideBase" | "inBase" => DataLabelPosition::InsideBase,
        "top" | "t" => DataLabelPosition::Top,
        "bottom" | "b" => DataLabelPosition::Bottom,
        "left" | "l" => DataLabelPosition::Left,
        "right" | "r" => DataLabelPosition::Right,
        "center" | "ctr" => DataLabelPosition::Center,
        "bestFit" => DataLabelPosition::BestFit,
        _ => DataLabelPosition::BestFit,
    }
}

pub(super) fn build_data_table(dt: &ChartDataTableData) -> DataTableConfig {
    let sp_pr = dt.format.as_ref().and_then(build_shape_properties);
    let tx_pr = dt.format.as_ref().and_then(build_text_body);

    DataTableConfig {
        show_horz_border: dt.show_horz_border,
        show_vert_border: dt.show_vert_border,
        show_outline: dt.show_outline,
        show_keys: dt.show_keys,
        sp_pr,
        tx_pr,
        ..Default::default()
    }
}

pub(super) fn build_view_3d(v: &ChartView3DData) -> View3D {
    View3D {
        rot_x: v.rot_x.map(|x| x as i8),
        rot_y: v.rot_y.map(|y| y as u16),
        right_angle_axes: v.r_ang_ax,
        perspective: v.perspective.map(|p| p as u8),
        height_percent: v.height_percent.map(|h| h as u16),
        depth_percent: v.depth_percent.map(|d| d as u16),
        ..Default::default()
    }
}

pub(super) fn build_surface(format: Option<&ChartFormatData>) -> Option<ChartSurface> {
    let fmt = format?;
    let sp_pr = build_shape_properties(fmt)?;
    Some(ChartSurface {
        sp_pr: Some(sp_pr),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn font(
        name: Option<&str>,
        size: Option<f64>,
        bold: Option<bool>,
        italic: Option<bool>,
    ) -> ChartFontData {
        ChartFontData {
            name: name.map(str::to_string),
            size,
            bold,
            italic,
            color: None,
            underline: None,
            strikethrough: None,
        }
    }

    fn format_with_font(font: ChartFontData) -> ChartFormatData {
        ChartFormatData {
            fill: None,
            line: None,
            font: Some(font),
            text_rotation: None,
            text_vertical_type: None,
            shadow: None,
        }
    }

    fn data_label_with_flags(
        show_value: Option<bool>,
        show_category_name: Option<bool>,
    ) -> DataLabelData {
        DataLabelData {
            show: true,
            delete: None,
            position: None,
            format: None,
            show_value,
            show_category_name,
            show_series_name: None,
            show_percentage: None,
            show_bubble_size: None,
            show_legend_key: None,
            separator: None,
            show_leader_lines: None,
            text: None,
            visual_format: None,
            number_format: None,
            text_orientation: None,
            rich_text: None,
            auto_text: None,
            horizontal_alignment: None,
            vertical_alignment: None,
            link_number_format: None,
            geometric_shape_type: None,
            formula: None,
            height: None,
            width: None,
            leader_lines_format: None,
            layout: None,
        }
    }

    #[test]
    fn build_data_labels_preserves_absent_and_explicit_false_show_flags() {
        let labels = build_data_labels(&data_label_with_flags(Some(false), None));

        assert!(!labels.show_value);
        assert!(labels.show_value_present);
        assert!(!labels.show_category);
        assert!(!labels.show_category_present);
    }

    #[test]
    fn build_title_preserves_rich_text_runs() {
        let default_format = format_with_font(font(Some("Aptos"), Some(11.0), None, None));
        let rich_text = vec![
            ChartFormatStringData {
                text: "Revenue ".to_string(),
                font: Some(font(None, None, Some(true), None)),
            },
            ChartFormatStringData {
                text: "FY26".to_string(),
                font: Some(font(None, Some(14.0), None, Some(true))),
            },
        ];

        let title = build_title(
            Some("Revenue FY26"),
            Some(&default_format),
            Some(&rich_text),
            None,
            None,
            None,
            None,
        )
        .expect("rich-text title should be reconstructed");

        let Some(ChartText::Rich(body)) = title.tx else {
            panic!("expected rich chart text");
        };
        assert_eq!(body.paragraphs.len(), 1);
        let paragraph = &body.paragraphs[0];
        assert_eq!(
            paragraph
                .props
                .def_run_props
                .as_ref()
                .and_then(|props| props.size)
                .map(|size| size.value()),
            Some(1100)
        );
        assert_eq!(paragraph.runs.len(), 2);

        let TextRunContent::Run(first) = &paragraph.runs[0] else {
            panic!("expected first rich-text run");
        };
        assert_eq!(first.text, "Revenue ");
        assert_eq!(first.props.bold, Some(true));

        let TextRunContent::Run(second) = &paragraph.runs[1] else {
            panic!("expected second rich-text run");
        };
        assert_eq!(second.text, "FY26");
        assert_eq!(second.props.italic, Some(true));
        assert_eq!(second.props.size.map(|size| size.value()), Some(1400));
    }

    #[test]
    fn title_preserves_imported_unmodeled_rich_text_properties() {
        let imported_body = crate::domain::charts::parse_text_body(
            br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr/>
                <a:p>
                    <a:pPr>
                        <a:defRPr lang="en-US" baseline="0" sz="1800"/>
                    </a:pPr>
                    <a:r>
                        <a:rPr lang="en-US" baseline="0" sz="2200"/>
                        <a:t>Revenue</a:t>
                    </a:r>
                </a:p>
            </c:rich>"#,
        );
        let imported_title = charts::Title {
            tx: Some(ChartText::Rich(imported_body)),
            ..Default::default()
        };
        let default_format = format_with_font(font(Some("Aptos"), Some(11.0), None, None));
        let rich_text = vec![ChartFormatStringData {
            text: "Revenue".to_string(),
            font: Some(font(None, Some(14.0), Some(true), None)),
        }];

        let mut title = build_title(
            Some("Revenue"),
            Some(&default_format),
            Some(&rich_text),
            None,
            None,
            None,
            None,
        )
        .expect("rich-text title should be reconstructed");
        super::super::text_body_fidelity::preserve_imported_title_text_properties(
            &mut title,
            Some(&imported_title),
        );

        let Some(ChartText::Rich(body)) = title.tx else {
            panic!("expected rich chart text");
        };
        let paragraph = &body.paragraphs[0];
        let def_rpr = paragraph
            .props
            .def_run_props
            .as_ref()
            .expect("default run properties");
        assert_eq!(def_rpr.lang.as_deref(), Some("en-US"));
        assert_eq!(def_rpr.baseline.map(|baseline| baseline.value()), Some(0));
        assert_eq!(def_rpr.size.map(|size| size.value()), Some(1100));

        let TextRunContent::Run(run) = &paragraph.runs[0] else {
            panic!("expected rich-text run");
        };
        assert_eq!(run.props.lang.as_deref(), Some("en-US"));
        assert_eq!(run.props.baseline.map(|baseline| baseline.value()), Some(0));
        assert_eq!(run.props.bold, Some(true));
        assert_eq!(run.props.size.map(|size| size.value()), Some(1400));
    }

    #[test]
    fn build_rich_text_runs_preserves_line_breaks() {
        let rich_text = vec![ChartFormatStringData {
            text: "Revenue\nFY26".to_string(),
            font: Some(font(Some("Aptos"), Some(11.0), None, None)),
        }];

        let ChartText::Rich(body) = build_chart_text_rich_runs(&rich_text, None) else {
            panic!("expected rich chart text");
        };

        let paragraph = &body.paragraphs[0];
        assert_eq!(paragraph.runs.len(), 3);
        let TextRunContent::Run(first) = &paragraph.runs[0] else {
            panic!("expected first text run");
        };
        assert_eq!(first.text, "Revenue");
        assert!(matches!(
            paragraph.runs[1],
            TextRunContent::LineBreak { props: Some(_) }
        ));
        let TextRunContent::Run(second) = &paragraph.runs[2] else {
            panic!("expected second text run");
        };
        assert_eq!(second.text, "FY26");
    }

    #[test]
    fn build_data_label_override_preserves_rich_text_runs() {
        let label = DataLabelData {
            show: true,
            delete: None,
            position: None,
            format: None,
            show_value: None,
            show_category_name: None,
            show_series_name: None,
            show_percentage: None,
            show_bubble_size: None,
            show_legend_key: None,
            separator: None,
            show_leader_lines: None,
            text: Some("plain fallback".to_string()),
            visual_format: None,
            number_format: None,
            text_orientation: None,
            rich_text: Some(vec![ChartFormatStringData {
                text: "Rich".to_string(),
                font: Some(font(None, Some(12.0), Some(true), None)),
            }]),
            auto_text: None,
            horizontal_alignment: None,
            vertical_alignment: None,
            link_number_format: None,
            geometric_shape_type: None,
            formula: Some("Sheet1!$A$1".to_string()),
            height: None,
            width: None,
            leader_lines_format: None,
            layout: None,
        };

        let label = build_data_label_override(0, &label);
        let Some(ChartText::Rich(body)) = label.text else {
            panic!("expected rich data-label text");
        };
        let TextRunContent::Run(run) = &body.paragraphs[0].runs[0] else {
            panic!("expected rich text run");
        };
        assert_eq!(run.text, "Rich");
        assert_eq!(run.props.bold, Some(true));
    }

    #[test]
    fn build_title_falls_back_to_plain_text_without_rich_runs() {
        let title = build_title(Some("Plain"), None, Some(&[]), None, None, None, None)
            .expect("plain title should be reconstructed");

        let Some(ChartText::Rich(body)) = title.tx else {
            panic!("expected rich chart text");
        };
        let TextRunContent::Run(run) = &body.paragraphs[0].runs[0] else {
            panic!("expected plain title run");
        };
        assert_eq!(run.text, "Plain");
    }

    #[test]
    fn build_title_preserves_alignment_and_shadow() {
        let title = build_title(
            Some("Aligned"),
            None,
            None,
            None,
            Some("center"),
            Some("top"),
            Some(true),
        )
        .expect("title should be reconstructed");

        let Some(ChartText::Rich(body)) = title.tx else {
            panic!("expected rich chart text");
        };
        assert_eq!(body.body_props.anchor, Some(TextAnchor::Top));
        assert_eq!(body.paragraphs[0].props.align, Some(TextAlign::Center));

        let effects = title
            .sp_pr
            .and_then(|sp_pr| sp_pr.effects)
            .expect("title shadow should emit shape effects");
        let EffectProperties::EffectList(list) = effects else {
            panic!("expected title shadow effect list");
        };
        assert!(list.outer_shadow.is_some());
    }
}
