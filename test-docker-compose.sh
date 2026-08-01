#!/bin/bash
set -euo pipefail

smoke_repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
smoke_compose_file="${smoke_repo_root}/docker-compose.yaml"
smoke_compose_override="${smoke_repo_root}/docker-compose.smoke.yaml"
smoke_tls_compose_file="${smoke_repo_root}/docker-compose.tls.yaml"
smoke_temp_dir=$(mktemp -d /tmp/fss-compose-smoke.XXXXXX)
smoke_env_file="${smoke_temp_dir}/smoke.env"
smoke_project="fss-bug08-smoke-$$"
smoke_web_container=""
smoke_backup_file="${smoke_temp_dir}/fss-smoke.dump"

smoke_db_user="fss_smoke_user"
smoke_db_name="fss_smoke_database"
smoke_db_password="fss_smoke_database_password"
smoke_admin_user="fss_smoke_admin"
smoke_admin_password="fss_smoke_admin_password"

cat > "${smoke_env_file}" <<EOF
DB_USER=${smoke_db_user}
DB_NAME=${smoke_db_name}
DB_PASS=${smoke_db_password}
DJANGO_SECRET_KEY=fss-smoke-secret-key-with-more-than-fifty-characters-1234567890
DJANGO_SUPERUSER_USERNAME=${smoke_admin_user}
DJANGO_SUPERUSER_PASSWORD=${smoke_admin_password}
DJANGO_SUPERUSER_EMAIL=smoke@example.com
ALLOWED_HOSTS=localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=
CORS_ALLOWED_ORIGINS=
SESSION_COOKIE_SECURE=false
CSRF_COOKIE_SECURE=false
SECURE_HSTS_SECONDS=0
TLS_CERTIFICATE_PATH=/tmp/fss-smoke-fullchain.pem
TLS_PRIVATE_KEY_PATH=/tmp/fss-smoke-privkey.pem
EOF

smoke_compose=(
    docker compose
    --project-name "${smoke_project}"
    --env-file "${smoke_env_file}"
    --file "${smoke_compose_file}"
    --file "${smoke_compose_override}"
)

cleanup() {
    smoke_result=$?
    trap - EXIT
    if [[ ${smoke_result} -ne 0 ]]
    then
        if [[ -n "${smoke_web_container}" ]]
        then
            docker logs "${smoke_web_container}" || true
        fi
        "${smoke_compose[@]}" logs db || true
    fi
    "${smoke_compose[@]}" down --rmi local --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf -- "${smoke_temp_dir}"
    exit "${smoke_result}"
}
trap cleanup EXIT

start_smoke_web() {
    "${smoke_compose[@]}" up --detach --wait web
    smoke_web_container=$("${smoke_compose[@]}" ps --quiet web)
}

run_web_check() {
    docker exec \
        "${smoke_web_container}" \
        /venv/bin/python \
        /code/docker/compose-smoke.py \
        "$@"
}

wait_for_health() {
    local container=$1
    local expected=$2
    local timeout=$3
    local deadline=$((SECONDS + timeout))
    local actual=""

    while ((SECONDS < deadline))
    do
        actual=$(docker inspect --format '{{.State.Health.Status}}' "${container}" 2>/dev/null || true)
        if [[ "${actual}" == "${expected}" ]]
        then
            return
        fi
        sleep 1
    done
    echo "Container ${container} did not become ${expected}; last health was ${actual}." >&2
    docker inspect "${container}" || true
    return 1
}

wait_for_restart() {
    local container=$1
    local previous_count=$2
    local timeout=$3
    local deadline=$((SECONDS + timeout))
    local actual=""

    while ((SECONDS < deadline))
    do
        actual=$(docker inspect --format '{{.RestartCount}}' "${container}" 2>/dev/null || true)
        if [[ "${actual}" =~ ^[0-9]+$ ]] && ((actual > previous_count))
        then
            return
        fi
        sleep 1
    done
    echo "Container ${container} did not restart; restart count remained ${actual}." >&2
    return 1
}

required_database_settings=(DB_USER DB_NAME DB_PASS)
for missing_setting in "${required_database_settings[@]}"
do
    smoke_environment=(-u DB_USER -u DB_NAME -u DB_PASS)
    for present_setting in "${required_database_settings[@]}"
    do
        if [[ "${present_setting}" != "${missing_setting}" ]]
        then
            smoke_environment+=("${present_setting}=smoke-required-setting")
        fi
    done
    if env "${smoke_environment[@]}" \
        docker compose \
        --env-file /dev/null \
        --file "${smoke_compose_file}" \
        config >/dev/null 2>&1
    then
        echo "Compose config unexpectedly accepted missing ${missing_setting}." >&2
        exit 1
    fi
done
echo "Compose rejects missing database settings."

"${smoke_compose[@]}" \
    --file "${smoke_tls_compose_file}" \
    --profile maintenance \
    config --format json |
    python3 "${smoke_repo_root}/docker/compose-smoke.py" \
        config \
        "${smoke_db_user}" \
        "${smoke_db_name}" \
        "${smoke_db_password}"

"${smoke_compose[@]}" build web
start_smoke_web

run_web_check endpoint
run_web_check seed
run_web_check audit

"${smoke_compose[@]}" down --remove-orphans
smoke_web_container=""
start_smoke_web
run_web_check audit

"${smoke_compose[@]}" exec --no-TTY db sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' \
    > "${smoke_backup_file}"
test -s "${smoke_backup_file}"

"${smoke_compose[@]}" down --volumes --remove-orphans
smoke_web_container=""
"${smoke_compose[@]}" up --detach --wait db
"${smoke_compose[@]}" exec --no-TTY db sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
    < "${smoke_backup_file}"
start_smoke_web
run_web_check audit

# Docker only activates a restart policy after a container has remained up for
# at least 10 seconds. Cross that guard before simulating an unexpected exit.
sleep 10
web_restart_count=$(docker inspect --format '{{.RestartCount}}' "${smoke_web_container}")
docker exec "${smoke_web_container}" sh -c 'kill -TERM 1' >/dev/null 2>&1 || true
wait_for_restart "${smoke_web_container}" "${web_restart_count}" 60
wait_for_health "${smoke_web_container}" healthy 60
run_web_check endpoint

smoke_db_container=$("${smoke_compose[@]}" ps --quiet db)
"${smoke_compose[@]}" stop db
wait_for_health "${smoke_web_container}" unhealthy 45
"${smoke_compose[@]}" start db
wait_for_health "${smoke_db_container}" healthy 60
wait_for_health "${smoke_web_container}" healthy 60
run_web_check seed
run_web_check endpoint --submit-command

db_restart_count=$(docker inspect --format '{{.RestartCount}}' "${smoke_db_container}")
docker exec "${smoke_db_container}" sh -c 'kill -TERM 1' >/dev/null 2>&1 || true
wait_for_restart "${smoke_db_container}" "${db_restart_count}" 60
wait_for_health "${smoke_db_container}" healthy 60
wait_for_health "${smoke_web_container}" healthy 60
run_web_check seed
run_web_check endpoint --submit-command

echo "Docker Compose persistence, restore, and restart recovery smoke test passed."
