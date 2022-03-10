#!/bin/bash

cp docker/local_settings.py fss/local_settings.py
./setup-db.sh

source venv/bin/activate
./manage.py migrate

if [ "$1" == "test" ]
then
./manage.py test
else
    if [ ! -z "$DJANGO_SUPERUSER_USERNAME" ] && [ ! -z "$DJANGO_SUPERUSER_PASSWORD" ]
    then
        ./manage.py createsuperuser --noinput
    fi
    ./manage.py runserver 0.0.0.0:8080
fi
