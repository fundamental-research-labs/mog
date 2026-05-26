/// Options for sheet screenshot rendering.
#[derive(Debug, Clone)]
pub struct ScreenshotOptions {
    /// Device pixel ratio (1 = 96 DPI, 2 = Retina). Default: 1.
    pub dpr: f32,
    /// Whether to render row/column headers. Default: true.
    pub show_headers: bool,
    /// Whether to render gridlines. Default: true.
    pub show_gridlines: bool,
    /// Maximum width in pixels (scales down if exceeded). Default: no limit.
    pub max_width: Option<u32>,
    /// Maximum height in pixels. Default: no limit.
    pub max_height: Option<u32>,
}

impl Default for ScreenshotOptions {
    fn default() -> Self {
        Self {
            dpr: 1.0,
            show_headers: true,
            show_gridlines: true,
            max_width: None,
            max_height: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_options() {
        let opts = ScreenshotOptions::default();
        assert_eq!(opts.dpr, 1.0);
        assert!(opts.show_headers);
        assert!(opts.show_gridlines);
        assert!(opts.max_width.is_none());
        assert!(opts.max_height.is_none());
    }
}
