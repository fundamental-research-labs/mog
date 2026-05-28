/// Helper: build a 12-element String array from a &str slice array.
pub(super) fn arr12(items: [&str; 12]) -> [String; 12] {
    items.map(Into::into)
}

/// Helper: build a 7-element String array from &str slices.
#[allow(clippy::many_single_char_names)] // short names are clear for array construction
pub(super) fn arr7(a: &str, b: &str, c: &str, d: &str, e: &str, f: &str, g: &str) -> [String; 7] {
    [
        a.into(),
        b.into(),
        c.into(),
        d.into(),
        e.into(),
        f.into(),
        g.into(),
    ]
}
