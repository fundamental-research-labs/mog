//! ChartEx OOXML dialect parsing and writing.
//!
//! ChartEx shares low-level XML scanner and writer infrastructure with standard
//! charts where the semantics are identical, but it remains a separate dialect
//! boundary from standard `c:chartSpace`.

pub mod read;
pub mod write;

use ooxml_types::chart_ex::{ChartExText, ChartExTitle};

pub use read::*;
pub use write::*;

pub(crate) fn chart_ex_title_text(title: &ChartExTitle) -> Option<String> {
    chart_ex_text_text(title.tx.as_ref())
}

pub(crate) fn chart_ex_text_text(text: Option<&ChartExText>) -> Option<String> {
    let text = text?;
    text.tx_data
        .as_ref()
        .and_then(|data| data.value.clone())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            text.rich.as_ref().and_then(|rich| {
                let parts = rich
                    .paragraphs
                    .iter()
                    .flat_map(|paragraph| &paragraph.runs)
                    .filter_map(|run| match run {
                        ooxml_types::drawings::TextRunContent::Run(run) if !run.text.is_empty() => {
                            Some(run.text.clone())
                        }
                        ooxml_types::drawings::TextRunContent::Field {
                            text: Some(text), ..
                        } if !text.is_empty() => Some(text.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>();
                (!parts.is_empty()).then(|| parts.join(""))
            })
        })
}
