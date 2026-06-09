# Contributing to Mog

Thank you for caring enough about Mog to help shape it.

Mog is moving quickly, and the highest-leverage contribution right now is an
agent-assisted GitHub issue: a bug report, feature request, rough workflow,
confusing edge case, or example of a spreadsheet/agent task Mog should handle
better.

You do not need to diagnose the root cause. A small workbook, exact formula, API
call, screenshot, log, or plain description of what you expected is often enough
to turn a vague problem into something we can reproduce and fix.

## Open an Issue First

Please use GitHub Issues for:

- Bugs and regressions.
- Feature requests.
- Excel, Sheets, Airtable, BI, or SDK behavior Mog should match or improve on.
- Workflows where you tried to use Mog and hit friction.
- Documentation gaps that blocked you.

Before opening a new issue, search existing issues if you can. If you are
reporting a security vulnerability, do not open a public issue; follow
[SECURITY.md](SECURITY.md) instead.

## What Makes an Issue Useful

For a bug report, include:

- What you were trying to do.
- The smallest reproduction you have: steps, workbook, formula, code snippet, or
  screen recording.
- What you expected to happen.
- What actually happened.
- Your environment: browser or Node version, OS, package version, and any
  relevant file type.
- Whether this used to work, if you know.

For a feature request, include:

- The job you need Mog to do.
- Why the current behavior or API does not get you there.
- What good would look like from a user's point of view.
- Any reference behavior from Excel, Google Sheets, Airtable, Notion, a BI tool,
  or another product.
- How important it is to your workflow.

## Start With Your Coding Agent

Before opening an issue, have your coding agent help turn the rough report into
something a maintainer can reproduce, evaluate, and act on. This prompt works
well:

```text
Help me write a high-quality GitHub issue for Mog.

First, ask me any missing questions needed to make the report clear and
reproducible. Then draft the issue with:

- A specific title.
- A short summary of the problem or request.
- The user workflow or goal.
- Reproduction steps, sample input, code, workbook, screenshots, or logs.
- Expected behavior.
- Actual behavior, if this is a bug.
- Environment and package versions, if relevant.
- Impact: who is blocked and how often this matters.

Rules:
- Do not invent details.
- Separate facts from guesses.
- Keep the issue concise enough for a maintainer to act on.
- Call out missing information instead of hiding it.
```

## Pull Requests

We are not optimizing for drive-by pull requests yet. The codebase, branch
layout, and verification gates change quickly enough that generic instructions
go stale.

Start with a GitHub issue. If a maintainer asks for a pull request, they will
give the current branch, scope, and verification expectations in that thread.

## Community

Be direct, kind, and concrete. We care about reports from people who are trying
to get real work done with Mog, even when the report is messy or incomplete.

By contributing, you agree that your contributions will be licensed under the
same [Apache License 2.0](LICENSE) that covers the project. The Mog name and logo are
trademarks of Fundamental Research Labs, Inc.; see [TRADEMARKS.md](TRADEMARKS.md)
for usage guidelines.
