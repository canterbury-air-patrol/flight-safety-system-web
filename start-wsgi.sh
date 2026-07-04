#!/bin/bash
set -e

source venv/bin/activate

./manage.py migrate
./manage.py collectstatic --no-input
# --master supervises worker processes and restarts a crashed one; --die-on-term
# makes uWSGI actually exit on SIGTERM (its default remaps that to a graceful
# reload) so systemd's stop/restart actually stops it instead of reloading it.
exec uwsgi --socket 127.0.0.1:8090 --protocol=http -w fss.wsgi --master --processes 4 --die-on-term
