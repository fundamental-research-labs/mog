# Contributing to Mog

Start with a GitHub issue for bugs, feature requests, or documentation gaps.
Search existing issues first. For security reports, follow
[SECURITY.md](SECURITY.md).

For a bug, include the smallest workbook or Office.js script that reproduces
it, the exact command, expected and actual results, `mog --version`, and your
operating system. Remove private data from workbooks and logs before sharing.
For a feature request, describe the workflow and the behavior you need.

If a maintainer asks for a pull request, agree on its scope in the issue. Keep
changes focused on the native CLI, Office.js scripting, and XLSX support. Run
the checks relevant to the change; common commands from the repository root are:

```sh
cargo test -p mog --locked
cargo test -p compute-api --locked
cargo check --workspace --locked
```

See [architecture](docs/guides/architecture-overview.md) and
[verification](docs/guides/verification.md) for more detail. Describe the problem,
resulting behavior, and validation in the pull request.

Contributions use the project's [Apache-2.0 license](LICENSE). See
[TRADEMARKS.md](TRADEMARKS.md) for use of the Mog name and logo.
