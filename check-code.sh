#!/bin/bash -ex

source venv/bin/activate

PATHS="fss/ main/ config/ assets/"

isort --check --diff --line-length 240 ${PATHS}

pycodestyle --ignore=E501 */*.py

pylint ${PATHS}

deactivate

