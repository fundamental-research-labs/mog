//! Nested gradient and border codecs for palette binary records.

use domain_types::{
    CellBorderSide, CellBorders, GradientCenter, GradientFillFormat, GradientStopFormat,
};

use super::PaletteBinaryError;
use super::layout::{
    BORDER_HAS_BOTTOM, BORDER_HAS_DIAGONAL, BORDER_HAS_DIAGONAL_DOWN, BORDER_HAS_DIAGONAL_UP,
    BORDER_HAS_HORIZONTAL, BORDER_HAS_LEFT, BORDER_HAS_OUTLINE, BORDER_HAS_RIGHT, BORDER_HAS_TOP,
    BORDER_HAS_VERTICAL, BORDER_SIDE_HAS_COLOR, BORDER_SIDE_HAS_STYLE, GRADIENT_HAS_CENTER,
    GRADIENT_HAS_DEGREE,
};
use super::read::{Cursor, read_string};
use super::string_pool::StringPool;
use super::write::{write_bool, write_f64, write_string, write_u16};

/// Write a `GradientFillRecord`.
pub(super) fn write_gradient_fill(
    buf: &mut Vec<u8>,
    gf: &GradientFillFormat,
    pool: &mut StringPool,
) {
    // gradient_type — always present
    write_string(buf, &gf.gradient_type, pool);

    // sub_presence byte
    let mut sub: u8 = 0;
    if gf.degree.is_some() {
        sub |= GRADIENT_HAS_DEGREE;
    }
    if gf.center.is_some() {
        sub |= GRADIENT_HAS_CENTER;
    }
    buf.push(sub);

    if let Some(deg) = gf.degree {
        write_f64(buf, deg);
    }
    if let Some(ref center) = gf.center {
        write_f64(buf, center.left);
        write_f64(buf, center.top);
    }

    // stops
    #[allow(clippy::cast_possible_truncation)]
    let stop_count = gf.stops.len() as u16;
    write_u16(buf, stop_count);
    for stop in &gf.stops {
        write_f64(buf, stop.position);
        write_string(buf, &stop.color, pool);
    }
}

/// Write a `BordersRecord`.
pub(super) fn write_borders(buf: &mut Vec<u8>, b: &CellBorders, pool: &mut StringPool) {
    let mut presence: u16 = 0;
    if b.top.is_some() {
        presence |= BORDER_HAS_TOP;
    }
    if b.right.is_some() {
        presence |= BORDER_HAS_RIGHT;
    }
    if b.bottom.is_some() {
        presence |= BORDER_HAS_BOTTOM;
    }
    if b.left.is_some() {
        presence |= BORDER_HAS_LEFT;
    }
    if b.diagonal.is_some() {
        presence |= BORDER_HAS_DIAGONAL;
    }
    if b.diagonal_up.is_some() {
        presence |= BORDER_HAS_DIAGONAL_UP;
    }
    if b.diagonal_down.is_some() {
        presence |= BORDER_HAS_DIAGONAL_DOWN;
    }
    if b.vertical.is_some() {
        presence |= BORDER_HAS_VERTICAL;
    }
    if b.horizontal.is_some() {
        presence |= BORDER_HAS_HORIZONTAL;
    }
    if b.outline.is_some() {
        presence |= BORDER_HAS_OUTLINE;
    }
    write_u16(buf, presence);

    // Fields in bit order.
    if let Some(ref side) = b.top {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.right {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.bottom {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.left {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.diagonal {
        write_border_side(buf, side, pool);
    }
    if let Some(v) = b.diagonal_up {
        write_bool(buf, v);
    }
    if let Some(v) = b.diagonal_down {
        write_bool(buf, v);
    }
    if let Some(ref side) = b.vertical {
        write_border_side(buf, side, pool);
    }
    if let Some(ref side) = b.horizontal {
        write_border_side(buf, side, pool);
    }
    if let Some(v) = b.outline {
        write_bool(buf, v);
    }
}

/// Write a [`CellBorderSide`].
fn write_border_side(buf: &mut Vec<u8>, side: &CellBorderSide, pool: &mut StringPool) {
    let mut sp: u8 = 0;
    if side.style.is_some() {
        sp |= BORDER_SIDE_HAS_STYLE;
    }
    if side.color.is_some() {
        sp |= BORDER_SIDE_HAS_COLOR;
    }
    buf.push(sp);
    if let Some(v) = side.style {
        write_string(buf, v.to_ooxml(), pool);
    }
    if let Some(ref s) = side.color {
        write_string(buf, s, pool);
    }
}

/// Read a `GradientFillRecord`.
pub(super) fn read_gradient_fill(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
) -> Result<GradientFillFormat, PaletteBinaryError> {
    let gradient_type = read_string(cursor, pool, pool_size, "gradient_type")?;

    let sub = cursor.read_u8("gradient sub_presence")?;

    let degree = if sub & GRADIENT_HAS_DEGREE != 0 {
        Some(cursor.read_f64("gradient degree")?)
    } else {
        None
    };

    let center = if sub & GRADIENT_HAS_CENTER != 0 {
        let left = cursor.read_f64("gradient center left")?;
        let top = cursor.read_f64("gradient center top")?;
        Some(GradientCenter { left, top })
    } else {
        None
    };

    let stop_count = cursor.read_u16("gradient stop_count")?;
    let mut stops = Vec::with_capacity(stop_count as usize);
    for _ in 0..stop_count {
        let position = cursor.read_f64("gradient stop position")?;
        let color = read_string(cursor, pool, pool_size, "gradient stop color")?;
        stops.push(GradientStopFormat { position, color });
    }

    Ok(GradientFillFormat {
        gradient_type,
        degree,
        center,
        stops,
    })
}

/// Read a `BordersRecord`.
pub(super) fn read_borders(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
) -> Result<CellBorders, PaletteBinaryError> {
    let presence = cursor.read_u16("borders presence")?;

    let top = if presence & BORDER_HAS_TOP != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let right = if presence & BORDER_HAS_RIGHT != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let bottom = if presence & BORDER_HAS_BOTTOM != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let left = if presence & BORDER_HAS_LEFT != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let diagonal = if presence & BORDER_HAS_DIAGONAL != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let diagonal_up = if presence & BORDER_HAS_DIAGONAL_UP != 0 {
        Some(cursor.read_bool("diagonal_up")?)
    } else {
        None
    };
    let diagonal_down = if presence & BORDER_HAS_DIAGONAL_DOWN != 0 {
        Some(cursor.read_bool("diagonal_down")?)
    } else {
        None
    };
    let vertical = if presence & BORDER_HAS_VERTICAL != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let horizontal = if presence & BORDER_HAS_HORIZONTAL != 0 {
        Some(read_border_side(cursor, pool, pool_size)?)
    } else {
        None
    };
    let outline = if presence & BORDER_HAS_OUTLINE != 0 {
        Some(cursor.read_bool("outline")?)
    } else {
        None
    };

    Ok(CellBorders {
        top,
        right,
        bottom,
        left,
        diagonal,
        diagonal_up,
        diagonal_down,
        vertical,
        horizontal,
        outline,
    })
}

/// Read a [`CellBorderSide`].
fn read_border_side(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
) -> Result<CellBorderSide, PaletteBinaryError> {
    let sp = cursor.read_u8("border side presence")?;

    let style = if sp & BORDER_SIDE_HAS_STYLE != 0 {
        let s = read_string(cursor, pool, pool_size, "border style")?;
        ooxml_types::styles::BorderStyle::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown BorderStyle in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let color = if sp & BORDER_SIDE_HAS_COLOR != 0 {
        Some(read_string(cursor, pool, pool_size, "border color")?)
    } else {
        None
    };

    Ok(CellBorderSide {
        style,
        color,
        color_tint: None,
    })
}
