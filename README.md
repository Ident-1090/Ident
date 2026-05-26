# Ident

Live traffic from your own ADS-B receiver, in a fast modern display for desktop,
tablet, and phone.

<p align="center">
<a href="https://ident-1090.github.io/Ident/"><img width="864" height="498" alt="Ident demo" src="https://github.com/user-attachments/assets/3cc415d3-63b8-4214-bcf2-63d4a1dd30c8" /></a>
</p>

<p align="center">
<b><a href="https://ident-1090.github.io/Ident/">▶&nbsp; Try the live demo</a></b>
</p>

Ident gives a local receiver a clearer day-to-day screen: map, traffic list,
aircraft details, receiver status, and range overlays in one place. It runs
beside the decoder and feeder software you already use, so your receiver can
keep hearing and sharing aircraft the same way it does today.

## Documentation

Full documentation lives on [Ident docs](https://ident-1090.github.io/Ident/docs/).
Install, configuration, and design details are there. This README is a short
overview and a set of pointers.

## What you get

- A modern ADS-B traffic screen built around your receiver data.
- Omnibar search and filters for flights, registrations, squawks, aircraft
  types, altitude bands, and route hints.
- Day and night themes with map labels, panels, and telemetry tuned for each
  mode.
- First-class mobile views with the same map, filters, and aircraft details as
  desktop.
- Aircraft inspector for live telemetry, signal quality, message age, route
  context, photos, and raw receiver fields.
- One embedded `identd` service for Docker, systemd, packages, and standalone
  binary installs.

Ident is a display and operator console. It is not a radio decoder, feeder
client, or MLAT client.

## Receiver compatibility

Ident is built for common self-hosted ADS-B receiver stacks.

| Stack | Support |
| --- | --- |
| readsb native JSON | Live aircraft, receiver metadata, stats, and range outline. |
| dump1090-fa native JSON, including PiAware installs | Live aircraft, receiver metadata, stats, and range where the decoder provides enough data. |
| dump978-fa native JSON, including SkyAware978 installs | Live UAT aircraft and receiver metadata where available. |

The basic requirement is read-only access to the directory where your receiver
writes `aircraft.json`. If optional files are missing, Ident still shows live
traffic with fewer receiver details.

Other decoder layouts may work when they expose the same files, but they are not
part of the supported compatibility set yet.

## Install

Ident ships as `identd`, a single local service that serves the web app and
streams receiver updates to browsers. It installs as a Docker Compose service,
which is the tested path, or as a Debian package or standalone binary.

The [install guide](https://ident-1090.github.io/Ident/docs/getting-started/install)
walks through each method, points Ident at your receiver data, and covers
per-decoder setup.

## Configuration

Most installs only need an address and the directory where the receiver writes
`aircraft.json`. When that directory is unset, `identd` looks in common receiver
runtime paths such as `/run/readsb` and `/run/dump1090-fa`.

Environment variables and flags cover the receiver data location, upstream type,
base path for reverse proxies, station identity and overlays, trails, replay, and
update checks. See the
[configuration reference](https://ident-1090.github.io/Ident/docs/getting-started/configuration).

## Security

Ident reads local receiver data and serves it to browsers that can reach the
service. Bind `identd` to localhost by default, mount receiver data read-only,
and do not expose Ident publicly without authentication in front of it. Do not
paste feeder credentials, private station details, or exact receiver location
information into public issues.

Report vulnerabilities through GitHub private vulnerability reporting:

<https://github.com/Ident-1090/Ident/security/advisories/new>

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to
contribute, including the DCO sign-off. For local setup, builds, and the checks to
run, see the [development guide](https://ident-1090.github.io/Ident/docs/development);
for how the system fits together, the
[architecture overview](https://ident-1090.github.io/Ident/docs/architecture).

## License

See [LICENSE](LICENSE).
