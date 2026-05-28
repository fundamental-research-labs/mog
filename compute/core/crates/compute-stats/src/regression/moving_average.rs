use crate::Point;

use super::types::MovingAverageResult;

/// Simple Moving Average (SMA) with trailing window.
///
/// Returns empty if `data.len() < period` or `period < 1`.
#[must_use]
pub fn moving_average(data: &[Point], period: usize) -> MovingAverageResult {
    if period < 1 || data.len() < period {
        return MovingAverageResult { points: vec![] };
    }

    let mut points = Vec::with_capacity(data.len() - period + 1);

    for i in (period - 1)..data.len() {
        let mut sum_y = 0.0;
        for j in 0..period {
            sum_y += data[i - j].y;
        }
        // Trailing x (the current point's x) for Excel compatibility
        points.push(Point {
            x: data[i].x,
            y: sum_y / period as f64,
        });
    }

    MovingAverageResult { points }
}
