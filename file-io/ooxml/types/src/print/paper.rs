/// Standard paper sizes (ECMA-376 ST_PaperSize).
///
/// Excel uses numeric IDs to represent paper sizes. This enum covers
/// the most commonly used paper sizes (IDs 1-41). Unknown or vendor-specific
/// IDs are preserved via the `Other(u32)` variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub enum PaperSize {
    /// Letter (8.5" x 11") - US default
    #[default]
    Letter,
    /// Letter Small (8.5" x 11")
    LetterSmall,
    /// Tabloid (11" x 17")
    Tabloid,
    /// Ledger (17" x 11")
    Ledger,
    /// Legal (8.5" x 14")
    Legal,
    /// Statement (5.5" x 8.5")
    Statement,
    /// Executive (7.25" x 10.5")
    Executive,
    /// A3 (297mm x 420mm)
    A3,
    /// A4 (210mm x 297mm)
    A4,
    /// A4 Small (210mm x 297mm)
    A4Small,
    /// A5 (148mm x 210mm)
    A5,
    /// B4 JIS (257mm x 364mm)
    B4,
    /// B5 JIS (182mm x 257mm)
    B5,
    /// Folio (8.5" x 13")
    Folio,
    /// Quarto (215mm x 275mm)
    Quarto,
    /// 10" x 14"
    Size10x14,
    /// 11" x 17"
    Size11x17,
    /// Note (8.5" x 11")
    Note,
    /// Envelope #9 (3.875" x 8.875")
    Envelope9,
    /// Envelope #10 (4.125" x 9.5")
    Envelope10,
    /// Envelope #11 (4.5" x 10.375")
    Envelope11,
    /// Envelope #12 (4.75" x 11")
    Envelope12,
    /// Envelope #14 (5" x 11.5")
    Envelope14,
    /// C size sheet (17" x 22")
    CSheet,
    /// D size sheet (22" x 34")
    DSheet,
    /// E size sheet (34" x 44")
    ESheet,
    /// Envelope DL (110mm x 220mm)
    EnvelopeDL,
    /// Envelope C5 (162mm x 229mm)
    EnvelopeC5,
    /// Envelope C3 (324mm x 458mm)
    EnvelopeC3,
    /// Envelope C4 (229mm x 324mm)
    EnvelopeC4,
    /// Envelope C6 (114mm x 162mm)
    EnvelopeC6,
    /// Envelope C65 (114mm x 229mm)
    EnvelopeC65,
    /// Envelope B4 (250mm x 353mm)
    EnvelopeB4,
    /// Envelope B5 (176mm x 250mm)
    EnvelopeB5,
    /// Envelope B6 (176mm x 125mm)
    EnvelopeB6,
    /// Envelope Italy (110mm x 230mm)
    EnvelopeItaly,
    /// Envelope Monarch (3.875" x 7.5")
    EnvelopeMonarch,
    /// 6 3/4 Envelope (3.625" x 6.5")
    Envelope634,
    /// US Standard Fanfold (14.875" x 11")
    USStdFanfold,
    /// German Standard Fanfold (8.5" x 12")
    GermanStdFanfold,
    /// German Legal Fanfold (8.5" x 13")
    GermanLegalFanfold,
    /// Unknown or vendor-specific paper size ID not in the standard range 1-41.
    Other(u32),
}

impl PaperSize {
    /// Create from a numeric paper-size ID.
    pub fn from_u32(value: u32) -> Self {
        match value {
            1 => Self::Letter,
            2 => Self::LetterSmall,
            3 => Self::Tabloid,
            4 => Self::Ledger,
            5 => Self::Legal,
            6 => Self::Statement,
            7 => Self::Executive,
            8 => Self::A3,
            9 => Self::A4,
            10 => Self::A4Small,
            11 => Self::A5,
            12 => Self::B4,
            13 => Self::B5,
            14 => Self::Folio,
            15 => Self::Quarto,
            16 => Self::Size10x14,
            17 => Self::Size11x17,
            18 => Self::Note,
            19 => Self::Envelope9,
            20 => Self::Envelope10,
            21 => Self::Envelope11,
            22 => Self::Envelope12,
            23 => Self::Envelope14,
            24 => Self::CSheet,
            25 => Self::DSheet,
            26 => Self::ESheet,
            27 => Self::EnvelopeDL,
            28 => Self::EnvelopeC5,
            29 => Self::EnvelopeC3,
            30 => Self::EnvelopeC4,
            31 => Self::EnvelopeC6,
            32 => Self::EnvelopeC65,
            33 => Self::EnvelopeB4,
            34 => Self::EnvelopeB5,
            35 => Self::EnvelopeB6,
            36 => Self::EnvelopeItaly,
            37 => Self::EnvelopeMonarch,
            38 => Self::Envelope634,
            39 => Self::USStdFanfold,
            40 => Self::GermanStdFanfold,
            41 => Self::GermanLegalFanfold,
            n => Self::Other(n),
        }
    }

    /// Get the numeric ID for this paper size.
    pub fn as_u32(&self) -> u32 {
        match self {
            Self::Letter => 1,
            Self::LetterSmall => 2,
            Self::Tabloid => 3,
            Self::Ledger => 4,
            Self::Legal => 5,
            Self::Statement => 6,
            Self::Executive => 7,
            Self::A3 => 8,
            Self::A4 => 9,
            Self::A4Small => 10,
            Self::A5 => 11,
            Self::B4 => 12,
            Self::B5 => 13,
            Self::Folio => 14,
            Self::Quarto => 15,
            Self::Size10x14 => 16,
            Self::Size11x17 => 17,
            Self::Note => 18,
            Self::Envelope9 => 19,
            Self::Envelope10 => 20,
            Self::Envelope11 => 21,
            Self::Envelope12 => 22,
            Self::Envelope14 => 23,
            Self::CSheet => 24,
            Self::DSheet => 25,
            Self::ESheet => 26,
            Self::EnvelopeDL => 27,
            Self::EnvelopeC5 => 28,
            Self::EnvelopeC3 => 29,
            Self::EnvelopeC4 => 30,
            Self::EnvelopeC6 => 31,
            Self::EnvelopeC65 => 32,
            Self::EnvelopeB4 => 33,
            Self::EnvelopeB5 => 34,
            Self::EnvelopeB6 => 35,
            Self::EnvelopeItaly => 36,
            Self::EnvelopeMonarch => 37,
            Self::Envelope634 => 38,
            Self::USStdFanfold => 39,
            Self::GermanStdFanfold => 40,
            Self::GermanLegalFanfold => 41,
            Self::Other(n) => *n,
        }
    }

    /// Get the human-readable display name for this paper size.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Letter => "Letter",
            Self::LetterSmall => "Letter Small",
            Self::Tabloid => "Tabloid",
            Self::Ledger => "Ledger",
            Self::Legal => "Legal",
            Self::Statement => "Statement",
            Self::Executive => "Executive",
            Self::A3 => "A3",
            Self::A4 => "A4",
            Self::A4Small => "A4 Small",
            Self::A5 => "A5",
            Self::B4 => "B4 (JIS)",
            Self::B5 => "B5 (JIS)",
            Self::Folio => "Folio",
            Self::Quarto => "Quarto",
            Self::Size10x14 => "10x14",
            Self::Size11x17 => "11x17",
            Self::Note => "Note",
            Self::Envelope9 => "Envelope #9",
            Self::Envelope10 => "Envelope #10",
            Self::Envelope11 => "Envelope #11",
            Self::Envelope12 => "Envelope #12",
            Self::Envelope14 => "Envelope #14",
            Self::CSheet => "C Sheet",
            Self::DSheet => "D Sheet",
            Self::ESheet => "E Sheet",
            Self::EnvelopeDL => "Envelope DL",
            Self::EnvelopeC5 => "Envelope C5",
            Self::EnvelopeC3 => "Envelope C3",
            Self::EnvelopeC4 => "Envelope C4",
            Self::EnvelopeC6 => "Envelope C6",
            Self::EnvelopeC65 => "Envelope C65",
            Self::EnvelopeB4 => "Envelope B4",
            Self::EnvelopeB5 => "Envelope B5",
            Self::EnvelopeB6 => "Envelope B6",
            Self::EnvelopeItaly => "Envelope Italy",
            Self::EnvelopeMonarch => "Envelope Monarch",
            Self::Envelope634 => "6 3/4 Envelope",
            Self::USStdFanfold => "US Std Fanfold",
            Self::GermanStdFanfold => "German Std Fanfold",
            Self::GermanLegalFanfold => "German Legal Fanfold",
            Self::Other(_) => "Other",
        }
    }
}
