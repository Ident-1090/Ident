# AGENTS.md

This repository is public-facing. Treat every tracked file, issue template,
example, screenshot, and commit message as publishable.

## Privacy Rules

Do not include private receiver or station details in tracked content.

Avoid:

- feeder keys, claim tokens, or API credentials
- exact receiver coordinates
- home address or location hints
- private hostnames, tunnel URLs, or local network names
- local usernames, machine names, and absolute workstation paths
- screenshots that reveal private station details

Use placeholders such as `receiver.local`, `YOUR_LAT`, `YOUR_LON`, and
`YOUR_FEEDER_ID` when examples need concrete values.

## Documentation Rules

- Write for receiver owners first, then add technical detail.
- Keep install commands minimal and copyable.
- Mention optional network access when a feature calls outside the receiver.
- Do not compare Ident directly to other projects in public docs.
- Keep examples generic enough for readsb, ultrafeeder, dump1090-fa, and
  PiAware users. Use stack-specific examples only in stack-specific sections.

## Development Rules

- Keep changes focused.
- Add tests for behavior changes.
- Update docs when configuration, install shape, privacy behavior, or network
  access changes.
- Do not choose or change the project license without maintainer approval.
