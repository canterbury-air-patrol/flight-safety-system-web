#!/bin/bash -ex

if [ ! -d venv ]
then
	python3 -m venv venv
fi

source venv/bin/activate

pip install -r requirements.txt
pip install -r requirements-dev.txt

PATHS="fss/ main/ config/ assets/"

isort --check --diff --line-length 240 ${PATHS}

pycodestyle --ignore=E501 */*.py

pylint ${PATHS}

deactivate

