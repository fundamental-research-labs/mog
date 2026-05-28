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
