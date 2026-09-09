use domain_types::chart::{ChartFontData, ChartFormatStringData};
use ooxml_types::charts::ChartText;
use ooxml_types::drawings::{Paragraph, ParagraphProperties, TextBody, TextRun, TextRunContent};

use super::formatting::build_run_properties;

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

/// Rebuild rich text with the current modeled string while retaining the
/// imported run segmentation and formatting as far as the new string allows.
///
/// `title_rich_text` is an imported snapshot. A chart title edit updates the
/// modeled `title` field first, so using the snapshot text here would silently
/// undo that edit during export. Keeping the run boundaries gives imported
/// rich formatting a stable place to land while making the modeled text
/// authoritative.
pub(super) fn build_chart_text_rich_runs_with_text(
    runs: &[ChartFormatStringData],
    text: &str,
    default_font: Option<&ChartFontData>,
) -> ChartText {
    let source_runs = runs
        .iter()
        .filter(|run| !run.text.is_empty())
        .collect::<Vec<_>>();
    if source_runs.is_empty() {
        return build_chart_text_rich(text, default_font);
    }

    let mut replacement_runs = Vec::with_capacity(source_runs.len());
    let mut remaining = text;
    for (index, source_run) in source_runs.iter().enumerate() {
        let replacement = if index + 1 == source_runs.len() {
            remaining.to_string()
        } else {
            let take = source_run
                .text
                .chars()
                .count()
                .min(remaining.chars().count());
            let (prefix, suffix) = split_text_at_char_count(remaining, take);
            remaining = suffix;
            prefix.to_string()
        };
        replacement_runs.push(ChartFormatStringData {
            text: replacement,
            font: source_run.font.clone(),
        });
    }

    build_chart_text_rich_runs(&replacement_runs, default_font)
}

fn split_text_at_char_count(value: &str, count: usize) -> (&str, &str) {
    if count == 0 {
        return ("", value);
    }
    value
        .char_indices()
        .nth(count)
        .map(|(index, _)| value.split_at(index))
        .unwrap_or((value, ""))
}

pub(super) fn rich_text_visible_text(runs: &[ChartFormatStringData]) -> String {
    runs.iter().map(|run| run.text.as_str()).collect()
}
