#!/bin/bash -ex

rm -fr venv
python3 -m venv venv

source venv/bin/activate

pip install wheel
pip install -r requirements.txt

# Prepare the frontend
if [ "x${NODE_DONE}" != "xyes" ]
then
    npm ci
    npm run build
fi

# Create the local settings file from the template
if [ ! -f fss/local_settings.py ]
then
    cp fss/local_settings.py.template fss/local_settings.py

    echo ""
    echo "Create fss/local_settings.py from template"
    echo "You should check this reflects your required settings"
    echo "At a minimum you will need to set your postgis parameters"
fi

./setup-db.sh

if [ ! -f fss/secretkey.txt ]
then
    python -c 'import random; result = "".join([random.choice("abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*(-_=+)") for i in range(50)]); print(result)' > fss/secretkey.txt  $
    echo ""
    echo "Created new secretkey.txt in fss/secretkey.txt"
fi

echo "Start in development mode:"
echo "./start.sh"
echo "You may need to create an admin user with './manage.py createsuperuser'"

