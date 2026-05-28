#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct DelimiterMatch {
    pub(super) start: usize,
    pub(super) len: usize,
}

pub(super) fn match_positions(text: &str, delimiter: &str, match_mode: i32) -> Vec<DelimiterMatch> {
    let search_chars: Vec<char> = if match_mode == 1 {
        text.to_lowercase().chars().collect()
    } else {
        text.chars().collect()
    };
    let delimiter_chars: Vec<char> = if match_mode == 1 {
        delimiter.to_lowercase().chars().collect()
    } else {
        delimiter.chars().collect()
    };

    let mut positions = Vec::new();
    let mut i = 0;
    while i + delimiter_chars.len() <= search_chars.len() {
        if search_chars[i..i + delimiter_chars.len()] == delimiter_chars[..] {
            positions.push(DelimiterMatch {
                start: i,
                len: delimiter_chars.len(),
            });
            i += delimiter_chars.len();
        } else {
            i += 1;
        }
    }
    positions
}

pub(super) fn split_by_delimiters(
    text: &str,
    delimiters: &[String],
    match_mode: i32,
) -> Vec<String> {
    let text_chars: Vec<char> = text.chars().collect();
    let search_chars: Vec<char> = if match_mode == 1 {
        text.to_lowercase().chars().collect()
    } else {
        text_chars.clone()
    };
    let delimiter_chars: Vec<Vec<char>> = delimiters
        .iter()
        .map(|delimiter| {
            if match_mode == 1 {
                delimiter.to_lowercase().chars().collect()
            } else {
                delimiter.chars().collect()
            }
        })
        .collect();

    let mut parts = Vec::new();
    let mut last = 0;
    let mut i = 0;
    while i < search_chars.len() {
        if let Some(matched_len) = delimiter_chars.iter().find_map(|delimiter| {
            if !delimiter.is_empty()
                && i + delimiter.len() <= search_chars.len()
                && search_chars[i..i + delimiter.len()] == delimiter[..]
            {
                Some(delimiter.len())
            } else {
                None
            }
        }) {
            parts.push(text_chars[last..i].iter().collect());
            last = i + matched_len;
            i = last;
        } else {
            i += 1;
        }
    }
    parts.push(text_chars[last..].iter().collect());
    parts
}
