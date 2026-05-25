# Contributing to Ident

Ident is built for people running their own ADS-B receivers. Good contributions
keep that audience in mind: the app should be understandable for receiver owners,
predictable for operators, and straightforward to install on common receiver
hosts.

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting issues

Search the existing issues and discussions first. For a security issue, do not
open a public issue; use
[private vulnerability reporting](https://github.com/Ident-1090/Ident/security/advisories/new).

Do not include private station details in public issues: feeder keys or claim
tokens, exact receiver coordinates, home or location hints, private hostnames or
tunnel URLs, or screenshots that reveal where you are. Use placeholders such as
`receiver.local`, `YOUR_LAT`, `YOUR_LON`, and `YOUR_FEEDER_ID`.

For install and compatibility reports, include the Ident version, your decoder and
where it writes `aircraft.json`, which optional files exist (`receiver.json`,
`stats.json`, `outline.json`), the operating system and hardware, the install
method, the browser and device used for the UI, and any relevant `identd` logs.
For UI issues, crop or redact screenshots that reveal your location.

## Pull requests

Keep pull requests focused. A small change with clear behavior, tests, and docs is
easier to review than a broad change that mixes unrelated work.

- Include tests for behavior changes.
- Update the docs when install, configuration, network access, or user-facing
  behavior changes.
- Do not add a new external service without documenting the network access.
- Do not add station-specific examples or private deployment assumptions.
- Keep receiver data read-only by default; document and justify any write path.

For local setup, builds, the checks to run, and the pre-commit hook, see the
[Development guide](https://ident-1090.github.io/Ident/development).

## Developer Certificate of Origin

Contributions are accepted under the
[Developer Certificate of Origin](https://developercertificate.org/) (DCO). It
certifies that you wrote the contribution, or otherwise have the right to submit
it under the project's license. You agree to it by signing off each commit:

```sh
git commit -s
```

This adds a `Signed-off-by: Your Name <you@example.com>` line to the commit
message, using the name and email from your Git configuration. The full
certificate is at <https://developercertificate.org/>.
