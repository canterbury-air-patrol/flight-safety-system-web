#!/bin/bash
set -e

cp docker/local_settings.py fss/local_settings.py
source /venv/bin/activate

./manage.py migrate

if [ ! -z "$DJANGO_SUPERUSER_USERNAME" ] && [ ! -z "$DJANGO_SUPERUSER_PASSWORD" ]
then
    ./manage.py createsuperuser --noinput || true
fi

./manage.py collectstatic --noinput

exec uwsgi \
    --http 0.0.0.0:8080 \
    --module fss.wsgi \
    --master \
    --workers 4 \
    --threads 2 \
    --static-map /static/=/code/static/
