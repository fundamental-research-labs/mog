use domain_types::chart::{
    ChartDataTableData, ChartFontData, ChartFormatData, ChartFormatStringData, ChartView3DData,
    DataLabelData, LegendData, LegendEntryData,
};
use ooxml_types::charts::{
    self, ChartLines, ChartSurface, ChartText, DataLabel, DataLabelOptions, DataLabelPosition,
    DataTableConfig, LegendPosition, NumFmt, StrRef, View3D,
};
use ooxml_types::drawings::{Paragraph, ParagraphProperties, TextBody, TextRun, TextRunContent};

use super::formatting::{
    build_outline, build_run_properties, build_shape_properties, build_text_body,
};

pub(super) fn build_title(
    text: Option<&str>,
    format: Option<&ChartFormatData>,
    rich_text: Option<&[ChartFormatStringData]>,
    layout: Option<&domain_types::domain::drawings::ManualLayout>,
) -> Option<charts::Title> {
    let default_font = format.and_then(|f| f.font.as_ref());
    if let Some(runs) = rich_text.filter(|runs| runs.iter().any(|run| !run.text.is_empty())) {
        return Some(build_title_with_text(
            build_chart_text_rich_runs(runs, default_font),
            format,
            layout,
        ));
    }

    let text = text?;
    // Guard against the literal string "undefined" leaking from JS bridge serialization.
    if text == "undefined" || text.is_empty() {
        return None;
    }
    Some(build_title_element(text, format, layout))
}

pub(super) fn build_title_element(
    text: &str,
    format: Option<&ChartFormatData>,
    layout: Option<&domain_types::domain::drawings::ManualLayout>,
) -> charts::Title {
    build_title_with_text(
        build_chart_text_rich(text, format.and_then(|f| f.font.as_ref())),
        format,
        layout,
    )
}

fn build_title_with_text(
    tx: ChartText,
    format: Option<&ChartFormatData>,
    layout: Option<&domain_types::domain::drawings::ManualLayout>,
) -> charts::Title {
    let sp_pr = format.and_then(build_shape_properties);

    charts::Title {
        tx: Some(tx),
        layout: layout.cloned().map(Into::into),
        sp_pr,
        ..Default::default()
    }
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
        source_linked: Some(false),
    });

    let sp_pr = dl.visual_format.as_ref().and_then(build_shape_properties);
    let tx_pr = dl.visual_format.as_ref().and_then(build_text_body);

    DataLabelOptions {
        delete: dl.delete,
        show_value: dl.show_value.unwrap_or(false),
        show_category: dl.show_category_name.unwrap_or(false),
        show_series_name: dl.show_series_name.unwrap_or(false),
        show_percent: dl.show_percentage.unwrap_or(false),
        show_bubble_size: dl.show_bubble_size.unwrap_or(false),
        show_legend_key: dl.show_legend_key.unwrap_or(false),
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
    let tx_pr = dl.visual_format.as_ref().and_then(build_text_body);
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
        extensions: Vec::new(),
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
        let title = build_title(Some("Plain"), None, Some(&[]), None)
            .expect("plain title should be reconstructed");

        let Some(ChartText::Rich(body)) = title.tx else {
            panic!("expected rich chart text");
        };
        let TextRunContent::Run(run) = &body.paragraphs[0].runs[0] else {
            panic!("expected plain title run");
        };
        assert_eq!(run.text, "Plain");
    }
}
