# Experiments Instructions

This directory is for public experiments that are safe to keep in the public
repository but are not part of shipped package surfaces.

Rules:

- Keep experiment inputs, outputs, and prose public-safe.
- Do not name internal sibling repositories, local machine paths, private run
  handles, or non-public workbook and dataset provenance.
- Prefer supported package entrypoints over deep imports when an experiment uses
  Mog code.
- Do not add a package manifest unless the package inventory explicitly covers
  the experiment package.
- Data files such as CSV or XLSX fixtures need a narrow public provenance note
  and scanner allowlist entry before they are committed.

Before committing experiment changes, run `pnpm check:private-leaks` and the
experiment's own reproducibility command.
