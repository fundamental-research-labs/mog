use crate::snapshot::{PolicyPreservedParseOutcome, PolicyPreservedParseSummary, RecalcResult};

pub(super) fn truncate_submitted_text(text: &str) -> String {
    const MAX_BYTES: usize = 128;
    if text.len() <= MAX_BYTES {
        return text.to_string();
    }
    let marker = "...";
    let limit = MAX_BYTES.saturating_sub(marker.len());
    let mut end = 0;
    for (idx, _) in text.char_indices() {
        if idx <= limit {
            end = idx;
        } else {
            break;
        }
    }
    format!("{}{}", text.get(..end).unwrap_or_default(), marker)
}

pub(super) fn attach_policy_preserved_outcomes(
    result: &mut RecalcResult,
    outcomes: Vec<PolicyPreservedParseOutcome>,
) {
    if outcomes.is_empty() {
        return;
    }
    let total = outcomes.len() as u64;
    let emitted = outcomes.len().min(1000);
    let submitted_text_truncated_count = outcomes
        .iter()
        .take(emitted)
        .filter(|outcome| outcome.submitted_text.ends_with("..."))
        .count() as u64;
    result.policy_preserved_parse_outcomes = outcomes.into_iter().take(emitted).collect();
    let emitted_count = result.policy_preserved_parse_outcomes.len() as u64;
    let omitted_count = total.saturating_sub(emitted_count);
    result.policy_preserved_parse_summary = Some(PolicyPreservedParseSummary {
        total_preserved: total,
        emitted_count,
        omitted_count,
        outcome_entries_truncated: omitted_count > 0,
        submitted_text_truncated_count,
    });
}
