use crate::scheduler::ComputeCore;

pub(super) fn snapshot_version(
    compute: &ComputeCore,
    document_id: &str,
    external_version: &str,
) -> String {
    let mut formulas: Vec<_> = compute
        .formula_texts_for_diagnostics()
        .map(|(cell, formula)| format!("{}={}", cell.to_uuid_string(), formula))
        .collect();
    formulas.sort();
    let mut parts = Vec::with_capacity(formulas.len() + 2);
    parts.push(document_id);
    parts.push(external_version);
    parts.extend(formulas.iter().map(String::as_str));
    stable_hash_parts(&parts)
}

pub(super) fn encode_cursor(snapshot_version: &str, offset: usize) -> String {
    format!("{snapshot_version}:{offset}")
}

pub(super) fn decode_cursor(
    cursor: Option<&str>,
    snapshot_version: &str,
) -> Result<usize, value_types::ComputeError> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    let Some((version, offset)) = cursor.rsplit_once(':') else {
        return stale_cursor();
    };
    if version != snapshot_version {
        return stale_cursor();
    }
    offset
        .parse::<usize>()
        .map_err(|_| value_types::ComputeError::Eval {
            message: "diagnostics.staleCursor".to_string(),
        })
}

fn stale_cursor<T>() -> Result<T, value_types::ComputeError> {
    Err(value_types::ComputeError::Eval {
        message: "diagnostics.staleCursor".to_string(),
    })
}

pub(super) fn stable_hash_parts(parts: &[&str]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for part in parts {
        for byte in part.as_bytes().iter().copied().chain([0xff]) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{hash:016x}")
}
