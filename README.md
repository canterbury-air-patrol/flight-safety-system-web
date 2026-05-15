# Flight Safety System - Web Frontend

The web frontend for [Flight Safety System](https://github.com/canterbury-air-patrol/flight-safety-system/) which shows the current status of known assets and allows safety critical commands to be sent to them.

## Getting Started

### Prerequisites

* python3 with venv and pip
* postgresql with postgis

### Fetching and start

```
git clone https://github.com/canterbury-air-patrol/flight-safety-system-web.git
cd flight-safety-system-web
./setup.sh
# follow the instructions in the output from setup.sh
./start.sh
```

## Deployment Requirements

### HTTPS is mandatory

All FSS web instances **must** be served over HTTPS. Session and CSRF cookies
are marked `Secure` in production (`SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`),
so they will not be transmitted over plain HTTP at all. Serving any instance
over HTTP means operators cannot log in and no commands can be sent.

### Multi-server deployments must share a registered domain

When running more than one FSS web instance (for redundancy), every instance
must share the same *registered domain* (eTLD+1) — for example
`fss1.example.com` and `fss2.example.com` both have the registered domain
`example.com`. Browsers treat these as *same-site*, which means `SameSite=Lax`
session and CSRF cookies set by `fss2.example.com` are included in credentialed
`fetch()` requests issued from a page at `fss1.example.com`. This is what
allows a single browser tab to authenticate against multiple servers.

Servers on different registered domains (e.g. `fss.alpha.com` and
`fss.beta.com`) or bare IP addresses are *cross-site* and their cookies will
not be sent cross-origin under `SameSite=Lax`. Such deployments are not
supported.

### Configure CORS_ALLOWED_ORIGINS on each instance

Each instance must list its peer instances in `CORS_ALLOWED_ORIGINS` inside
its `local_settings.py`. This allows the browser to send credentials to peer
servers. Every peer must appear in every other peer's list.

```python
# local_settings.py
CORS_ALLOWED_ORIGINS = [
    'https://fss1.example.com',
    'https://fss2.example.com',
]
```

A server not listed in its peers' `CORS_ALLOWED_ORIGINS` will still receive
and store data from aircraft, but the UI loaded from a peer will not be able
to send authenticated commands to it.

## Deploying
[Refer to Django uWSGI documentation](https://docs.djangoproject.com/en/6.0/howto/deployment/wsgi/uwsgi/)

## Authors
See the list of [contributors](https://github.com/canterbury-air-patrol/flight-safety-system-web/contributors).

## License
This project is licensed under GNU GPLv2 see the [LICENSE.md](LICENSE.md) file for details.
