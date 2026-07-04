# Flight Safety System - Web Frontend

The web frontend for [Flight Safety System](https://github.com/canterbury-air-patrol/flight-safety-system/) which shows the current status of known assets and allows safety critical commands to be sent to them.

## Deployment Requirements

These requirements apply to **all** install paths.

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

Each instance must list its peer instances in `CORS_ALLOWED_ORIGINS`. This
allows the browser to send credentials to peer servers. Every peer must appear
in every other peer's list.

A server not listed in its peers' `CORS_ALLOWED_ORIGINS` will still receive
and store data from aircraft, but the UI loaded from a peer will not be able
to poll or send authenticated commands to it.

Every origin listed in `CORS_ALLOWED_ORIGINS` is automatically trusted for
CSRF as well (`CSRF_TRUSTED_ORIGINS` is extended with it at startup), so a
peer only needs to be listed once, here. This is what makes cross-server
command dispatch — not just polling — work between peers.

---

## Installing with Docker (recommended for production)

### Prerequisites

- Docker and docker-compose

### Steps

1. **Build the frontend** (must be done before the Docker build):

   ```bash
   ./build-frontend-docker.sh
   ```

2. **Create your `.env` file**:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in all values. Generate a secret key with:

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(50))"
   ```

   For a single-server deployment, set:

   ```
   ALLOWED_HOSTS=fss.example.com
   CSRF_TRUSTED_ORIGINS=https://fss.example.com
   CORS_ALLOWED_ORIGINS=
   ```

   For multi-server deployments, list all peer origins in `CORS_ALLOWED_ORIGINS`
   (comma-separated, `https://` required):

   ```
   ALLOWED_HOSTS=fss1.example.com
   CSRF_TRUSTED_ORIGINS=https://fss1.example.com
   CORS_ALLOWED_ORIGINS=https://fss2.example.com,https://fss3.example.com
   ```

3. **Start the stack**:

   ```bash
   docker-compose up -d
   ```

4. Access the UI at `http://localhost:8090` (put a TLS-terminating reverse proxy in front for production).

---

## Installing into a venv (for direct install / systemd service)

### Prerequisites

- python3 with venv and pip
- Node.js (for the frontend build)
- PostgreSQL with PostGIS

### Steps

1. **Run the setup script**:

   ```bash
   git clone https://github.com/canterbury-air-patrol/flight-safety-system-web.git
   cd flight-safety-system-web
   ./setup.sh
   ```

   This creates the venv, installs Python and Node dependencies, builds the
   frontend, generates a secret key in `fss/secretkey.txt`, and creates
   `fss/local_settings.py` from the template.

2. **Edit `fss/local_settings.py`** — at minimum set the database connection,
   `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, and (for multi-server deployments)
   `CORS_ALLOWED_ORIGINS`.

3. **Run the database migrations**:

   ```bash
   source venv/bin/activate
   ./manage.py migrate
   ./manage.py createsuperuser
   ```

4. **Start the server**:

   - Development: `./start.sh` (Django dev server, not for production)
   - Production: `./start-wsgi.sh` (uWSGI on `localhost:8090`; put behind nginx or Apache)

   A systemd unit file is provided in `fss-web.service` for running as a service.

---

## Authors
See the list of [contributors](https://github.com/canterbury-air-patrol/flight-safety-system-web/contributors).

## License
This project is licensed under GNU GPLv2 see the [LICENSE.md](LICENSE.md) file for details.
