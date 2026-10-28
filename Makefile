.PHONY: test lint build image

test:
	npm install
	npm test

lint:
	npm install
	npm run lint

build:
	npm install
	npm run build

image:
	docker build -t renderer-parser:local .

# Service-local commands; supplied Make values override shell and selected .env.
ENV_FILE ?= .env
export ENV_FILE
LOCAL_KEYS := MOCK_STORE_IMAGE_TAG MOCK_SOURCE_PORT MOCK_CONTROL_PORT MOCK_CONTROL_TOKEN COMPOSE_PROJECT_NAME GHCR_OWNER APP_PORT RABBITMQ_PORT RABBITMQ_MANAGEMENT_PORT RABBITMQ_DEFAULT_USER RABBITMQ_DEFAULT_PASS POSTGRES_PORT POSTGRES_PASSWORD KEYCLOAK_PORT KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD OIDC_BASE_URL USER_API_PORT READINESS_TIMEOUT_SECONDS RECONNECT_INITIAL_DELAY_SECONDS RECONNECT_MAX_DELAY_SECONDS WORKER_CONCURRENCY CRAWLER_IMAGE_TAG HTTP_ADDR DATABASE_URL RABBITMQ_URL WORKFLOW_PROFILES OIDC_ISSUER OIDC_JWKS_URL API_URL OIDC_CLIENT_ID
export $(filter $(LOCAL_KEYS),$(.VARIABLES))

.PHONY: local.init config deps.up app.up down run
local.init:
	@test -f "$(ENV_FILE)" || cp .env.example "$(ENV_FILE)"

config deps.up app.up down run: local.init
	@python3 scripts/local.py $@
