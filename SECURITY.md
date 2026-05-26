# Security Policy

## Supported Versions

Mog is currently in the `experimental` release channel. Only the latest published version receives security fixes. There are no long-term support branches yet.

| Channel | Supported |
| --- | --- |
| Latest experimental release | Yes |
| Older experimental releases | No |
| Unreleased / main branch | Best-effort |

Once a `stable` release channel exists, this table will expand with backport commitments.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report vulnerabilities by email:

**security@mog.dev**

Include:

- Description of the vulnerability and its impact.
- Steps to reproduce or a proof-of-concept.
- Affected versions or commits, if known.
- Any suggested fix or mitigation.

You will receive an acknowledgment within 3 business days. We will work with you to understand the issue and coordinate a fix.

## Disclosure Timeline

We follow a 90-day coordinated disclosure process:

1. **Day 0**: Vulnerability report received and acknowledged.
2. **Day 1-7**: Initial triage and severity assessment.
3. **Day 7-60**: Fix development and internal validation.
4. **Day 60-90**: Patch release preparation and reporter notification.
5. **Day 90**: Public disclosure via security advisory, with or without a complete fix. If a fix is not ready, the advisory will include available mitigations.

We may request an extension for complex issues. We will not request extensions exceeding 30 additional days without the reporter's agreement.

## Security Advisories

Security fixes are published as GitHub Security Advisories on the repository. Each advisory includes:

- CVE identifier (requested when severity warrants).
- Affected versions.
- Description of the vulnerability and impact.
- Fixed versions and upgrade instructions.
- Workarounds, if available.

Subscribe to repository notifications to receive advisory alerts.

## Out of Scope

The following are generally out of scope for this policy:

- Vulnerabilities in dependencies that are already publicly disclosed and tracked upstream. (We still want to hear about them if we are shipping an affected version.)
- Issues that require physical access to the user's machine.
- Social engineering attacks against Mog maintainers or users.
- Denial-of-service attacks against self-hosted instances caused by resource exhaustion from authorized users.
- Issues in example code or documentation that do not affect the published packages.

## PGP Key

A PGP key for encrypting sensitive vulnerability reports will be published here once available. In the meantime, please use the email address above and mark your message as confidential.

## Scope

This policy covers:

- All packages published under `@mog-sdk/*` on npm.
- The `mog-sdk` package on PyPI (when published).
- Official Docker images (when published).
- The Mog source repository.

Third-party forks and unofficial distributions are not covered by this policy.
