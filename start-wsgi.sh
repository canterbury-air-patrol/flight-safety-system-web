#!/bin/bash

source venv/bin/activate

./manage.py migrate
./manage.py collectstatic --no-input
uwsgi --socket 127.0.0.1:8090 --protocol=http -w fss.wsgi
