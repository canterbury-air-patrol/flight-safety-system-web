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

All FSS web instances **must** be served over HTTPS. The authentication and
CSRF security model depends on browser same-site cookie semantics: session and
CSRF cookies are sent cross-origin only when both the sending and receiving
origin are the same registered domain **and** the connection uses HTTPS.
Serving any instance over plain HTTP breaks cross-server authentication and
opens the session to eavesdropping on a safety-critical system.

### Multi-server deployments must share a registered domain

When running more than one FSS web instance (for redundancy), every instance
must be on the same registered domain — for example `fss1.example.com` and
`fss2.example.com`. Servers on different domains or bare IP addresses cannot
exchange credentials cross-origin and will not be able to send authenticated
commands to one another's assets.

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
