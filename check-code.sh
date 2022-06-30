#!/bin/bash -e

source venv/bin/activate

PATHS="fss/ main/ config/ assets/"

isort --check --diff --line-length 240 ${PATHS}

pycodestyle --ignore=E501 */*.py

pylint --max-line-length=240 --load-plugins pylint_django --django-settings-module=fss.settings --ignore migrations ${PATHS}

deactivate

