#!/bin/sh
set -eu

cp docker/local_settings.py fss/local_settings.py

trap 'exit 0' INT TERM

while true
do
    ./manage.py prune_telemetry
    sleep 86400 &
    wait "$!"
done
