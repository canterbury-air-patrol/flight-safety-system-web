#!/bin/bash

source venv/bin/activate

./manage.py migrate
uwsgi --socket 127.0.0.1:8090 --protocol=http -w fss.wsgi
