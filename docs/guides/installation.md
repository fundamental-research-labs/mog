# Installation

Mog 1.0 is being prepared for release. The binary and npm instructions below
apply once that release is published. Build from source in the meantime.

## From source

Install stable Rust and a C compiler (QuickJS includes C code), then run from
this repository:

```sh
cargo install --path compute/officejs --locked
mog --version
```

This installs the native binary in Cargo's bin directory. For development, use
`cargo build -p mog --locked` and `target-native/debug/mog` instead.

## Standalone binary

Download the archive for your platform from
[GitHub Releases](https://github.com/fundamental-research-labs/mog/releases/tag/v1.0.0).
Verify it against `SHA256SUMS`, extract it, and put `mog` (or `mog.exe`) on your
`PATH`. No Node.js or Excel installation is needed.

| Platform | Archive | Minimum build baseline |
| --- | --- | --- |
| Linux x64 | `mog-1.0.0-linux-x64.tar.gz` | glibc 2.35 (Ubuntu 22.04) |
| Linux ARM64 | `mog-1.0.0-linux-arm64.tar.gz` | glibc 2.39 (Ubuntu 24.04) |
| macOS Apple Silicon | `mog-1.0.0-darwin-arm64.tar.gz` | macOS 14 |
| macOS Intel | `mog-1.0.0-darwin-x64.tar.gz` | macOS 14 |
| Windows x64 | `mog-1.0.0-win32-x64.zip` | Windows 10/Server 2022 |

Linux builds target glibc; Alpine/musl is not included. macOS binaries are
unsigned and not notarized. Windows binaries are unsigned.

## npm

With Node.js 22 or later:

```sh
npm install -g @mog-sdk/cli@1
mog --version
mog --help
```

Or run without a global install:

```sh
npx @mog-sdk/cli@1 -f formula.js -o result.xlsx
```

npm selects an optional package containing the binary for your OS and CPU.
Keep optional dependencies enabled. The launcher passes arguments, standard
input/output, and exit status through to that binary. There are no install
scripts, downloads at launch, Node bindings, or additional spreadsheet APIs.
Scripts still run in the binary's embedded QuickJS runtime, not in Node.js.
