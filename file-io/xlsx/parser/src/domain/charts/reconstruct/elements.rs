use domain_types::chart::{
    ChartDataTableData, ChartFontData, ChartFormatData, ChartView3DData, DataLabelData, LegendData,
    LegendEntryData,
};
use ooxml_types::charts::{
    self, ChartSurface, ChartText, DataLabelOptions, DataLabelPosition, DataTableConfig,
    LegendPosition, NumFmt, View3D,
};
use ooxml_types::drawings::{Paragraph, ParagraphProperties, TextBody, TextRun, TextRunContent};

use super::formatting::{build_run_properties, build_shape_properties, build_text_body};

pub(super) fn build_title(
    text: Option<&str>,
    format: Option<&ChartFormatData>,
) -> Option<charts::Title> {
    let text = text?;
    // Guard against the literal string "undefined" leaking from JS bridge serialization.
    if text == "undefined" || text.is_empty() {
        return None;
    }
    Some(build_title_element(text, format))
}

pub(super) fn build_title_element(text: &str, format: Option<&ChartFormatData>) -> charts::Title {
    let tx = Some(build_chart_text_rich(
        text,
        format.and_then(|f| f.font.as_ref()),
    ));
    let sp_pr = format.and_then(build_shape_properties);

    charts::Title {
        tx,
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

pub(super) fn build_legend(ld: &LegendData) -> Option<charts::Legend> {
    if !ld.visible && !ld.show {
        return None;
    }

    let legend_pos = Some(match ld.position.as_str() {
        "bottom" | "b" => LegendPosition::Bottom,
        "top" | "t" => LegendPosition::Top,
        "left" | "l" => LegendPosition::Left,
        "right" | "r" => LegendPosition::Right,
        "topRight" | "tr" => LegendPosition::TopRight,
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
        overlay: ld.overlay,
        sp_pr,
        tx_pr,
        ..Default::default()
    })
}

pub(super) fn build_legend_entry(entry: &LegendEntryData) -> charts::LegendEntry {
    let tx_pr = entry.format.as_ref().and_then(build_text_body);

    charts::LegendEntry {
        idx: entry.idx,
        delete: entry.delete,
        tx_pr,
        ..Default::default()
    }
}

pub(super) fn build_data_labels(dl: &DataLabelData) -> DataLabelOptions {
    let position = dl
        .position
        .as_deref()
        .map(|s| match s {
            "outside" | "outsideEnd" | "outEnd" => DataLabelPosition::OutsideEnd,
            "inside" | "insideEnd" | "inEnd" => DataLabelPosition::InsideEnd,
            "insideBase" | "inBase" => DataLabelPosition::InsideBase,
            "top" | "t" => DataLabelPosition::Top,
            "bottom" | "b" => DataLabelPosition::Bottom,
            "left" | "l" => DataLabelPosition::Left,
            "right" | "r" => DataLabelPosition::Right,
            "center" | "ctr" => DataLabelPosition::Center,
            _ => DataLabelPosition::BestFit,
        })
        .unwrap_or_default();

    let num_fmt = dl.number_format.clone();
    let num_fmt_obj = dl.number_format.as_ref().map(|code| NumFmt {
        format_code: code.clone(),
        source_linked: Some(false),
    });

    let sp_pr = dl.visual_format.as_ref().and_then(build_shape_properties);
    let tx_pr = dl.visual_format.as_ref().and_then(build_text_body);

    DataLabelOptions {
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
        sp_pr,
        tx_pr,
        show_leader_lines: dl.show_leader_lines,
        ..Default::default()
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
