# Flight Safety System - Web Frontend

The web frontend for [Flight Safety System](https://github.com/canterbury-air-patrol/flight-safety-system/) which shows the current status of known assets and allows safety critical commands to be sent to them.

## Deployment Requirements

These requirements apply to **all production and operational** install paths.
The Docker quickstart also provides an explicit plain-HTTP mode for local
development and evaluation on the Docker host. That mode must never be used
for operational deployment.

### HTTPS is mandatory in production

All production FSS web instances **must** be served over HTTPS. Session and
CSRF cookies are marked `Secure` in production (`SESSION_COOKIE_SECURE`,
`CSRF_COOKIE_SECURE`), so they will not be transmitted over plain HTTP at all.
Serving a production instance over HTTP means operators cannot log in and no
commands can be sent.

### Operator sessions expire after eight hours

Operator sessions use an eight-hour sliding expiry and a browser-session
cookie. Each request refreshes the eight-hour window, and closing the browser
normally removes the cookie. Because the status UI polls automatically, an
open tab counts as activity and can keep its session authenticated
indefinitely; operators must close the browser when leaving a console
unattended.

### Failed logins are temporarily locked

Each FSS web instance tracks failed authentication by submitted username. Five
failures within a rolling 15-minute window temporarily lock that username on
that instance. A successful login before the limit resets the failures.
Attempts made during a lockout do not extend it.

The login page always shows the same `Invalid username or password` message,
including during a lockout. Current failures and successful access records are
available through the Django admin's Axes pages, and lockouts emit a warning to
the application log. An administrator can clear a username before the cool-off
expires with:

```bash
./manage.py axes_reset_username USERNAME
```

In a multi-server deployment, each peer stores its own failure counter in its
own PostgreSQL database. The five-attempt limit therefore applies separately
on every peer, and an administrator must run the reset on every peer where the
username is locked. Deployments that require one aggregate threshold across
all peers must additionally enforce it at a shared, trusted reverse proxy.

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

## Installing with Docker

### Prerequisites

- Docker with Docker Compose

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

3. **Choose one access mode.**

   ### Local development or evaluation over HTTP

   This mode is only for a browser running on the Docker host. The raw web port
   is bound to `127.0.0.1`, and both secure-cookie settings must be deliberately
   disabled in `.env`:

   ```dotenv
   ALLOWED_HOSTS=localhost
   CSRF_TRUSTED_ORIGINS=
   CORS_ALLOWED_ORIGINS=
   SESSION_COOKIE_SECURE=false
   CSRF_COOKIE_SECURE=false
   SECURE_HSTS_SECONDS=0
   ```

   Start the base stack:

   ```bash
   docker compose up -d
   ```

   Open `http://localhost:8090`. Never use these cookie overrides for a
   production or operational instance.

   ### Production with the example HTTPS proxy

   The optional Compose file runs nginx in front of the application, redirects
   port 80 to HTTPS, and accepts operator-provided certificate files. Obtain a
   certificate whose names cover the deployment hostname, keep its private key
   out of version control, and set the production values in `.env`:

   ```dotenv
   ALLOWED_HOSTS=fss.example.com
   CSRF_TRUSTED_ORIGINS=https://fss.example.com
   CORS_ALLOWED_ORIGINS=
   SESSION_COOKIE_SECURE=true
   CSRF_COOKIE_SECURE=true
   SECURE_HSTS_SECONDS=31536000
   TLS_CERTIFICATE_PATH=./certs/fullchain.pem
   TLS_PRIVATE_KEY_PATH=./certs/privkey.pem
   ```

   The certificate must contain the complete chain expected by clients.
   `TLS_PRIVATE_KEY_PATH` must name its matching unencrypted private key. Start
   the stack with both Compose files:

   ```bash
   docker compose \
     -f docker-compose.yaml \
     -f docker-compose.tls.yaml \
     up -d
   ```

   Open `https://fss.example.com`. The application remains reachable over raw
   HTTP only from the Docker host for diagnostics; port 443 is the production
   entry point. Certificate renewal is the operator's responsibility. After
   replacing either certificate file, reload it with:

   ```bash
   docker compose \
     -f docker-compose.yaml \
     -f docker-compose.tls.yaml \
     restart tls-proxy
   ```

   For multi-server deployments, give each instance its own hostname and list
   all peer origins in `CORS_ALLOWED_ORIGINS` (comma-separated, `https://`
   required):

   ```dotenv
   ALLOWED_HOSTS=fss1.example.com
   CSRF_TRUSTED_ORIGINS=https://fss1.example.com
   CORS_ALLOWED_ORIGINS=https://fss2.example.com,https://fss3.example.com
   ```

### Verify a fresh Docker deployment

Run the Compose smoke test after changing the image, entrypoint, database
settings, or migrations:

```bash
./test-docker-compose.sh
```

The test renders the documented environment shape, checks that missing
database settings fail interpolation, and starts an isolated Compose project
with different database and user names. It proves migrations, authenticated
polling and command submission, named-volume persistence, logical backup and
restore, application readiness, and automatic recovery from web and database
process exits. The temporary containers, network, and database volumes are
removed when the test finishes; an existing Compose project is not used.

### Protect and recover the Compose database

Compose stores PostgreSQL 18 data in the project-scoped `db-data` named volume,
mounted at the image's persistent root, `/var/lib/postgresql`. `docker compose
stop`, `restart`, and `down` preserve this volume. **`docker compose down
--volumes` deletes it and all database data; never use that option against an
operational project unless a verified backup is available and deletion is
intentional.**

A named volume provides stable persistence, not a backup. Set an
installation-specific backup schedule and retention period, regularly copy
backups to encrypted off-host storage, and test restoration. Database dumps
are sensitive: in addition to users and command history they currently contain
plaintext SMM credentials.

Create a timestamped custom-format backup without putting the database password
in the host command line or dump artifact metadata:

```bash
install -d -m 700 backups
umask 077
backup_file="backups/fss-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' \
  > "${backup_file}"
test -s "${backup_file}"
```

Deployments created before `db-data` was added use an anonymous database
volume. Before updating their Compose configuration, run the backup command
above against the still-running old stack. After updating the checkout:

```bash
docker compose down
docker compose up -d --wait db
docker compose exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  < "${backup_file}"
docker compose up -d --wait
```

Do not start `web` before restoring: its normal entrypoint migrates whichever
database is attached, which could make a newly created empty database look like
a valid but data-free installation. Keep the old anonymous volume until the
restored application has been verified.

Test every backup in an isolated Compose project. The project name below gives
the drill its own network and `db-data` volume; only that drill volume is
removed at the end:

```bash
restore_compose=(
  docker compose
  --project-name fss-restore-drill
  --env-file .env
  --file docker-compose.yaml
)
"${restore_compose[@]}" up -d --wait db
"${restore_compose[@]}" exec --no-TTY db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  < "${backup_file}"
"${restore_compose[@]}" run --rm --no-deps --entrypoint /bin/sh web -c \
  'cp docker/local_settings.py fss/local_settings.py &&
   ./manage.py migrate &&
   ./manage.py check --deploy --fail-level WARNING &&
   ./manage.py shell -c "from django.contrib.auth import get_user_model; from assets.models import Asset, AssetCommand; print({\"users\": get_user_model().objects.count(), \"assets\": Asset.objects.count(), \"commands\": AssetCommand.objects.count(), \"commands_with_issuer\": AssetCommand.objects.exclude(issued_by=None).count()})"'
"${restore_compose[@]}" down --volumes
```

Compare the counts with the source installation and inspect representative
users, assets, command history, and command issuers before declaring the backup
usable. Run the drill with the same application version that created the dump,
then test the intended upgrade and migrations separately.

### Compose recovery and readiness

The `db`, `web`, TLS proxy, and optional maintenance service use
`restart: unless-stopped`. They return after a host or Docker daemon restart
and after an unexpected process exit, but an intentionally stopped service
stays stopped. `depends_on` and its health conditions order initial startup;
they are not ongoing supervision after a dependency restarts.

`GET /health/` is an unauthenticated, database-aware readiness probe. It
returns `200` only when Django can execute a query and otherwise returns `503`
without database details. The web container uses it for its Compose health
state, and the TLS proxy waits for that state during initial startup. Check an
installation with:

```bash
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:8090/health/
docker compose logs --tail=200 db web tls-proxy
```

Use the HTTPS deployment hostname instead of the loopback URL when checking
through the TLS proxy. A migration or startup failure leaves `web` restarting
and never healthy; inspect its logs rather than treating a running or listening
container as usable. `docker compose up -d --wait` returns only after enabled
health-checked services are healthy and other enabled services are running.

As a deployment recovery drill, restart the Docker daemon, wait for `db` and
`web` to become healthy, verify the HTTPS `/health/` response, log in, confirm
status polling resumes, and submit a non-destructive command to a connected
test asset. This full-stack drill is deliberately operator-run because it
interrupts every Docker workload on the host and requires the deployment's
real certificate and proxy configuration.

### Audit existing asset configuration before upgrading

Migration `config.0002_assetconfig_one_per_asset` deliberately stops when an
asset has multiple SMM credential rows; it reports only the conflicting asset
IDs and never chooses or prints a credential. Audit and resolve those rows
before applying migrations:

```bash
# Docker, after building/pulling the new web image but before normal startup
docker compose run --rm --no-deps --entrypoint /bin/sh web -c \
  'cp docker/local_settings.py fss/local_settings.py && ./manage.py audit_asset_configs'

# Direct/venv installation
venv/bin/python manage.py audit_asset_configs
```

No output beyond the success message means the database is ready. If conflicts
are listed, inspect those asset IDs and explicitly retain the intended row
before retrying the migration; do not automate credential selection.

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

### External PostgreSQL operations and recovery

The Compose volume, database restart policy, and container backup commands do
not apply when `fss/local_settings.py` points at a separately installed or
managed PostgreSQL server. That server's storage, replication, availability,
backup schedule, retention, encryption, and off-host copies remain the
database operator or provider's responsibility.

For a self-managed external server, use the matching PostgreSQL client tools
and a mode-0600 password file rather than putting a password in shell history:

```bash
install -d -m 700 backups
umask 077
export PGPASSFILE=/secure/path/to/fss.pgpass
pg_dump --host=POSTGRES_SERVER --username=POSTGRES_USER \
  --dbname=POSTGRES_DBNAME --format=custom \
  --file="backups/fss-$(date -u +%Y%m%dT%H%M%SZ).dump"
unset PGPASSFILE
```

Managed services may require their own snapshot or point-in-time recovery
workflow in addition to logical dumps. Restore into a separate database, make
the PostGIS extension available, and run a separate checkout against that
database. Run `./manage.py migrate`, `./manage.py check --deploy --fail-level
WARNING`, and the same user/asset/command/issuer verification described in the
Compose drill before accepting the backup.

The supplied `fss-web.service` assumes PostgreSQL is a local systemd service:
it contains `Requires=postgresql.service` and `After=postgresql.service`. For a
remote or managed database, remove those two directives from the installed
unit and use network readiness instead:

```ini
[Unit]
Wants=network-online.target
After=network-online.target
```

Then run `sudo systemctl daemon-reload` before enabling or restarting the web
service. `start-wsgi.sh` runs migrations before opening uWSGI, so an unavailable
database makes startup fail and the unit's existing `Restart=on-failure` policy
retries it. Inspect `systemctl status fss-web` and `journalctl -u fss-web` if it
does not recover.

Direct installations use the Psycopg pool configured in the local-settings
template. After an external database restart, requests using stale pooled
connections may fail while those connections are discarded. Retry `/health/`
until it returns `200`, then verify authenticated polling and command
submission. Per-checkout health queries are intentionally not enabled, avoiding
an extra database round trip on every request.

---

## Data retention

### Telemetry retention

Position, status, RTT, and search-progress retention is disabled by default.
Configure any combination of these settings with a non-negative number of
days to opt individual tables into pruning:

- `TELEMETRY_POSITION_RETENTION_DAYS`
- `TELEMETRY_STATUS_RETENTION_DAYS`
- `TELEMETRY_RTT_RETENTION_DAYS`
- `TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS`

Docker deployments set them in `.env`; direct installations set them in
`fss/local_settings.py`. An empty or `None` table value leaves that table
disabled. Zero days makes all rows before the command's start time eligible,
subject to the aligned-window safeguard.

`TELEMETRY_ALIGNED_WINDOW_HOURS` defaults to 24. For each asset, cleanup finds
the newest timestamp present in any of the four telemetry tables. Every
enabled table then preserves the same trailing window before that timestamp,
even when its normal age limit is shorter. A row is deleted only when it is
strictly older than both the table age cutoff and the asset's aligned-window
cutoff, so rows exactly on either effective boundary survive. Set the aligned
window to `0` to disable this safeguard and enforce only table age limits.

The aligned window cannot create missing samples: if a table has no rows in
the protected interval, it remains empty there. Commands, acknowledgements,
destructive-command confirmations, and other audit data are never pruned by
this command.

### Command audit retention

Command audit cleanup is disabled by default. Set
`COMMAND_AUDIT_RETENTION_DAYS` to a non-negative number of days to opt in.
This one policy covers a command and all of its `AssetCommandAck` rows as an
indivisible audit unit; it never deletes acknowledgement history separately
from its command.

An older command is eligible only when its issue time and its newest
acknowledgement receipt time are both strictly older than the configured
cutoff. Acknowledgements exactly on the cutoff remain. The newest command
timestamp for every asset is always preserved, even when it is older than the
limit, because FSS treats that row as the aircraft's persistent commanded
state and redelivers it after reconnect. If several rows share that newest
timestamp, all of them remain rather than relying on an ambiguous tie-break.

### Review and run cleanup manually

Pruning permanently deletes data; there is no archive or undo. Export any
history required for incident investigation before enabling it. Always review
the counts first:

```bash
# Docker (the web service must be running)
docker compose exec web ./manage.py prune_telemetry --dry-run
docker compose exec web ./manage.py prune_command_audit --dry-run

# Direct/venv installation
venv/bin/python manage.py prune_telemetry --dry-run
venv/bin/python manage.py prune_command_audit --dry-run
```

Remove `--dry-run` to delete the reported rows. The default delete batch is
1,000 rows; use `--batch-size N` to tune transaction size:

```bash
venv/bin/python manage.py prune_telemetry --batch-size 500
venv/bin/python manage.py prune_command_audit --batch-size 500
```

The command reports a count for every enabled table and a total. Invalid,
negative, or empty aligned-window values and invalid or negative table limits
stop the command without pruning.

### Enable daily Docker cleanup

The `telemetry-maintenance` service is behind an opt-in Compose profile. After
setting at least one retention limit in `.env`, recreate `web` so manual runs
receive the settings and enable the profile:

```bash
docker compose up -d --force-recreate web
docker compose --profile maintenance up -d telemetry-maintenance
```

The maintenance container runs telemetry and command-audit pruning immediately
when it starts and then every 24 hours. Each policy remains independently
disabled until its corresponding setting is configured. Inspect reports with:

```bash
docker compose logs telemetry-maintenance
```

Disable automatic cleanup with:

```bash
docker compose --profile maintenance stop telemetry-maintenance
```

### Enable the persistent systemd timer

For a direct installation, first edit the example user and paths in
`fss-telemetry-prune.service`, then install both units:

```bash
sudo cp fss-telemetry-prune.service fss-telemetry-prune.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fss-telemetry-prune.timer
systemctl list-timers fss-telemetry-prune.timer
```

The oneshot service uses the same `fss/local_settings.py` as the web service
and is restricted to the filesystem, capabilities, devices, namespaces, and
address families it needs. The timer is persistent: if the host is off at the
scheduled daily run, systemd starts the missed job after boot. Review runs
with `journalctl -u fss-telemetry-prune.service`.

---

## Authors
See the list of [contributors](https://github.com/canterbury-air-patrol/flight-safety-system-web/contributors).

## License
This project is licensed under GNU GPLv2 see the [LICENSE.md](LICENSE.md) file for details.
