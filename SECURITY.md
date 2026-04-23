# Security Policy

Ident is a receiver-local web console. It reads local ADS-B receiver data and
serves it to browsers that can reach the service.

## Supported Versions

Security fixes are made for the latest stable release only. Older releases do
not receive fixes.

| Version | Supported |
| --- | --- |
| Latest stable release | Yes |
| Older releases | No |

## Reporting a Vulnerability

Please do not report security issues in public GitHub issues.

Use GitHub's private vulnerability reporting for this repository:

https://github.com/Ident-1090/Ident/security/advisories/new

If private vulnerability reporting is unavailable, open a minimal public issue
asking for a secure contact path. Do not include exploit details, credentials,
private receiver information, or exact station location in that public issue.

## What to Expect

Maintainers aim to acknowledge valid reports within seven days. After triage,
we coordinate fixes and disclosure through the private advisory thread.

Public details should wait until a fix, mitigation, or advisory is available.

## Sensitive Data

Reports should avoid including:

- feeder keys or claim tokens
- exact receiver coordinates
- private hostnames or tunnel URLs
- unredacted logs with credentials
- screenshots that reveal a private receiver location

Use placeholders where possible.

## Scope

In scope:

- vulnerabilities in `identd`
- browser-side issues in the Ident web UI
- unsafe defaults in Docker, systemd, or package configuration

Out of scope:

- vulnerabilities in receiver stacks that Ident only reads from
- vulnerabilities in third-party map, route, or photo services
- public data shown because a user intentionally exposed their receiver without
  authentication

## Operating Notes

Default operating posture:

- bind `identd` to localhost by default, including when a same-host reverse
  proxy is used
- bind to a LAN interface only when direct LAN access or a proxy on another host
  is intentional
- put authentication in front of public or shared deployments
- mount receiver data read-only
