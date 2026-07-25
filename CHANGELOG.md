# Changelog

## Unreleased

### Security

- **Server-side destructive-command confirmation** — `DISARM` and `TERM` now require a 60-second, single-use confirmation token bound to the authenticated user, asset, and exact command. Multi-server clients prepare and consume an independent token on each peer, and direct or replayed command submissions are rejected without creating a command.
- **Disconnected-asset command block** — command submission now requires a per-asset RTT response no more than 60 seconds old. The backend returns `409` without creating a command when that liveness proof is absent; the frontend disables controls with no live target and skips and reports unreachable, unauthenticated, or asset-disconnected peers.
- **Operator session expiry** — authenticated sessions now use an eight-hour request-sliding lifetime and a browser-session cookie. Expired sessions receive the API's authentication `403` and cannot create commands.
- **Login failure throttling** — each server now temporarily locks a submitted username after five failed authentications in a rolling 15-minute window. Lockout responses remain indistinguishable from invalid credentials, retries do not extend the lockout, and operators can inspect or clear attempts through Django Axes.

## 1.0.0 — 2026-05-17

First production release.

### Security

- **CSRF protection on command endpoint** — removed `@csrf_exempt` from `asset_command_set`; the frontend now reads the CSRF token from the `all_status_data` JSON response and sends it as `X-CSRFToken` on every command POST, supporting the multi-server architecture without weakening protection.
- **Authentication required on all API endpoints** — `asset_command_set`, `asset_add`, `asset_status_json`, `config_data_json`, `server_list`, `asset_list`, and `all_status_data` all return 403 JSON for unauthenticated requests; no endpoint redirects to the login page.
- **Secure cookie flags** — `SESSION_COOKIE_SECURE` and `CSRF_COOKIE_SECURE` set to `True` in Docker production settings; cookies are never transmitted over plain HTTP.
- **SameSite=Lax pinned explicitly** — `SESSION_COOKIE_SAMESITE` and `CSRF_COOKIE_SAMESITE` set to `'Lax'` so the multi-server session model is not vulnerable to a future Django default change.
- **HSTS support** — opt-in via `SECURE_HSTS_SECONDS` environment variable; enables `SECURE_PROXY_SSL_HEADER` and configurable `includeSubDomains`/`preload` flags. Disabled by default so non-proxy deployments are not affected.
- **Cache-Control on poll endpoint** — `private, no-store` prevents CSRF tokens being shared via proxy or browser cache.
- **Cryptographically secure secret key** — `setup.sh` uses `secrets.token_urlsafe(50)` instead of `random`; Docker containers read `DJANGO_SECRET_KEY` from the environment so all instances get a unique key.
- **Command input validation** — `asset_command_set` now validates the command against the allowlist before saving; rejects unknown command strings with 400. Latitude and longitude are bounds-checked (±90 / ±180) to match the existing altitude bounds check.
- **Unique asset names** — `Asset.name` is now unique within each server's database, preventing same-named assets from silently merging command targets across servers.

### Docker / Infrastructure

- **Production server** — Docker entrypoint switched from `manage.py runserver` to uWSGI (`--workers 4 --threads 2`) with `exec` so SIGTERM reaches the process directly.
- **Environment-variable configuration** — `docker/local_settings.py` reads all runtime config (`DB_*`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS`, `DJANGO_SECRET_KEY`, HSTS settings) from environment variables; sed-based patching removed.
- **No hardcoded credentials** — `docker-compose.yaml` references `${VAR}` placeholders; a `.env.example` template is provided for operators to copy.
- **Pinned base image** — `FROM python:3.12-slim` replaces the unpinned `FROM python:3` for reproducible builds and a smaller image.
- **`.dockerignore`** — excludes `venv/`, `node_modules/`, `.git/`, secrets, and dev artefacts from the build context.
- **`DEBUG=False`** and `ALLOWED_HOSTS` from environment variable in Docker settings.
- **`collectstatic`** run at container startup so static files are served correctly by uWSGI.

### Bug Fixes

- Server state and command dispatch targets are keyed by canonical URL origin rather than operator-assigned server names, preventing the local `direct` alias from causing duplicate polls and commands.
- Command status comparisons in the frontend now use the raw command code (`'GOTO'`, `'ALT'`, `'MAN'`) returned as `command_code` in the API response, rather than the Django display string (`'Goto Position'` etc.) which could silently break if wording changed.
- Poll requests are now cancelled with `AbortController` before the next poll fires, preventing stale responses from overwriting state when a server is slow.
- `window.location.origin` used for the direct server URL instead of the fragile `href.slice(0, -1)`.
- Login page shows an error message on failed login attempts.
- Altitude input on the Goto/Altitude dialogs accepts only integers and enforces the 0–999 ft range in the browser.
- `local_settings` is now imported after `BASE_DIR` is defined in `fss/settings.py`.

### Documentation

- README rewritten with step-by-step install guides for both Docker (recommended for production) and venv (direct install / systemd).
- Deployment requirements (HTTPS mandatory, same registered domain for multi-server, `CORS_ALLOWED_ORIGINS` configuration) moved to a prominent section before both install paths.
- `.env.example` documents all required and optional environment variables with comments.

### Known limitations (planned for future releases)

- SMM credentials are stored in plaintext in the database.
- Asset identity across servers uses the asset name as a key; coordinated unique naming across all servers is required in multi-server deployments.
