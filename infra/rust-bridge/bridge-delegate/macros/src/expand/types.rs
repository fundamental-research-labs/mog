use super::ir::ReturnInfo;

pub(super) fn classify_return(ty_str: &str) -> ReturnInfo {
    let trimmed = ty_str.trim();
    let (is_bytes_tuple, serde_inner_ty) = parse_bytes_tuple(trimmed);
    ReturnInfo {
        ty: trimmed.to_string(),
        is_bytes_tuple,
        serde_inner_ty,
    }
}

fn parse_bytes_tuple(ty: &str) -> (bool, Option<String>) {
    let trimmed = ty.trim();
    if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
        return (false, None);
    }
    let inner = trimmed[1..trimmed.len() - 1].trim();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut angle_depth: i32 = 0;
    for ch in inner.chars() {
        match ch {
            '<' => {
                angle_depth += 1;
                current.push(ch);
            }
            '>' => {
                angle_depth -= 1;
                current.push(ch);
            }
            ',' if angle_depth == 0 => {
                parts.push(current.trim().to_string());
                current = String::new();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    if parts.len() != 2 {
        return (false, None);
    }
    let first = parts[0].replace(' ', "");
    if first != "Vec<u8>" {
        return (false, None);
    }
    (true, Some(parts[1].clone()))
}

// ---------------------------------------------------------------------------
pub(super) fn join_type_tokens(tokens: &[String]) -> String {
    let mut result = String::new();
    for (i, tok) in tokens.iter().enumerate() {
        if i > 0 {
            let prev = &tokens[i - 1];
            let skip_space = prev == "&"
                || prev.ends_with('<')
                || prev.ends_with('(')
                || tok.starts_with('<')
                || tok.starts_with('>')
                || tok == "&"
                || (prev == ":" && tok == ":")
                || (tok == ":" && i + 1 < tokens.len() && tokens[i + 1] == ":");
            if !skip_space {
                result.push(' ');
            }
        }
        result.push_str(tok);
    }
    result
}
