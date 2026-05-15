FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y libgdal-dev && rm -rf /var/lib/apt/lists/*
RUN mkdir /code
WORKDIR /code
COPY . /code/
RUN NODE_DONE=yes ./setup.sh

ENTRYPOINT ["/code/docker/start.sh"]
