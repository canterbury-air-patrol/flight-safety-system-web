FROM python:3
ENV PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y libgdal-dev nodejs npm && rm -fr /var/lib/apt/lists/*
RUN mkdir /code
WORKDIR /code
COPY . /code/
RUN ./setup.sh

ENTRYPOINT /code/docker/start.sh
