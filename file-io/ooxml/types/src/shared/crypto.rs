// ============================================================================
// AlgClass — ST_AlgClass
// ============================================================================

/// Algorithm class (ST_AlgClass).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum AlgClass {
    /// Hash algorithm (default).
    #[default]
    #[xml("hash")]
    Hash,
    /// Custom algorithm.
    #[xml("custom")]
    Custom,
}

// ============================================================================
// AlgType — ST_AlgType
// ============================================================================

/// Algorithm type (ST_AlgType).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum AlgType {
    /// Any type (default).
    #[default]
    #[xml("typeAny")]
    TypeAny,
    /// Custom type.
    #[xml("custom")]
    Custom,
}

// ============================================================================
// CryptProv — ST_CryptProv
// ============================================================================

/// Cryptographic provider type (ST_CryptProv).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum CryptProv {
    /// RSA AES provider (default).
    #[default]
    #[xml("rsaAES")]
    RsaAes,
    /// RSA Full provider.
    #[xml("rsaFull")]
    RsaFull,
    /// Custom provider.
    #[xml("custom")]
    Custom,
}
