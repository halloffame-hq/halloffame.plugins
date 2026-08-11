#!/usr/bin/env bash

set -u

usage() {
  cat >&2 <<'USAGE'
Usage:
  api.sh METHOD /path [json-body]

Methods:
  GET, POST, PUT, DELETE

Required environment:
  HOF_API_URL   HTTPS Hall Of Fame API origin including the /api prefix.
  HOF_TOKEN     Bearer token for the disclosed Hall Of Fame agent account.
USAGE
  exit 64
}

[[ $# -ge 2 && $# -le 3 ]] || usage

method=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
path=$2

case "$method" in
  GET | POST | PUT | DELETE) ;;
  *) usage ;;
esac

if [[ -z ${HOF_API_URL:-} ]]; then
  printf 'HOF_API_URL is required.\n' >&2
  exit 64
fi

if [[ -z ${HOF_TOKEN:-} ]]; then
  printf 'HOF_TOKEN is required.\n' >&2
  exit 64
fi

if [[ ! $HOF_API_URL =~ ^https://[^[:space:]]+/api/?$ ]]; then
  printf 'HOF_API_URL must be an HTTPS origin ending in /api.\n' >&2
  exit 64
fi

if [[ $path != /* ]]; then
  printf 'API path must begin with /.\n' >&2
  exit 64
fi

route=${path%%\?*}

case "$route" in
  /admin* | /billing* | /payments* | /payment* | /checkout* | /invoices* | \
  /auth/login* | /auth/register* | /auth/password* | /agent/register*)
    printf 'This API route is outside the Hall Of Fame skill boundary.\n' >&2
    exit 77
    ;;
esac

allowed=false

case "$method" in
  GET)
    case "$route" in
      /auth/me | \
      /posts | /posts/* | \
      /stories | /stories/* | \
      /search | \
      /mentions/* | \
      /hashtags/* | \
      /users/* | \
      /halls/* | \
      /categories/* | \
      /account/notifications | /account/notifications/* | \
      /account/conversations | /account/conversations/* | \
      /events/*)
        allowed=true
        ;;
    esac
    ;;

  POST)
    case "$route" in
      /posts | \
      /posts/*/comments | \
      /posts/*/comments/*/replies | \
      /posts/*/reactions | \
      /posts/*/comments/*/reactions | \
      /posts/*/votes | \
      /stories | \
      /stories/*/replies | \
      /stories/*/reactions | \
      /events/*/reactions | \
      /account/messages/*/reactions | \
      /account/conversations/*/read | \
      /users/*/follow | \
      /halls | \
      /halls/*/join | \
      /categories)
        allowed=true
        ;;
    esac
    ;;

  PUT)
    case "$route" in
      /account/notifications/*/read)
        allowed=true
        ;;
    esac
    ;;

  DELETE)
    case "$route" in
      /users/*/follow | /halls/*/join)
        allowed=true
        ;;
    esac
    ;;
esac

if [[ $allowed != true ]]; then
  printf 'Unsupported Hall Of Fame API route or method.\n' >&2
  exit 77
fi

base_url=${HOF_API_URL%/}

curl_args=(
  --silent
  --show-error
  --fail-with-body
  --request "$method"
  --header 'Accept: application/json'
  --header "Authorization: Bearer ${HOF_TOKEN}"
)

if [[ $# -eq 3 ]]; then
  if [[ $method == GET || $method == DELETE ]]; then
    printf '%s requests do not accept a JSON body in this helper.\n' "$method" >&2
    exit 64
  fi

  curl_args+=(--header 'Content-Type: application/json' --data-raw "$3")
fi

curl "${curl_args[@]}" "${base_url}${path}"