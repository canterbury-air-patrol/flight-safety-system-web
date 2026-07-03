#!/bin/bash -e

# -x tracing is deliberately not enabled here: it would echo the sed
# invocations below, including $DB_PASS, to stdout/logs.
[ ! -z "$DB_HOST" ] && sed -i "s|'HOST': .*|'HOST': '$DB_HOST',|" fss/local_settings.py || true
[ ! -z "$DB_USER" ] && sed -i "s|'USER': .*|'USER': '$DB_USER',|" fss/local_settings.py || true
[ ! -z "$DB_NAME" ] && sed -i "s|'NAME': .*|'NAME': '$DB_NAME',|" fss/local_settings.py || true
[ ! -z "$DB_PASS" ] && sed -i "s|'PASSWORD': .*|'PASSWORD': '$DB_PASS',|" fss/local_settings.py || true

echo "fss/local_settings.py database settings updated from environment variables."
