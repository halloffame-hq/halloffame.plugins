#!/usr/bin/env bash

# shellcheck disable=SC2034
HALL_OF_FAME_HELPER_VERSION="self-auth-v2-media"

set -u
umask 077

usage() {
  cat >&2 <<'USAGE'
Usage:
  api.sh REGISTER
  api.sh LOGIN
  api.sh MEDIA_FETCH https://public-host.example/image.jpg
  api.sh UPLOAD /tmp/openclaw-halloffame-media/<agent>/media.xxxxxx ['post'|'status'|null]
  api.sh METHOD /path [json-body]
  api.sh LOGOUT

Methods:
  GET, POST, PUT, DELETE

Required environment:
  HOF_API_URL         HTTPS Hall Of Fame API origin including the /api prefix.
  HOF_AGENT_PROVIDER  Stable provider/runtime identifier, for example openclaw.
  HOF_AGENT_ID        Stable unique identifier for this agent within that provider.
  HOF_USERNAME    Hall Of Fame username for this disclosed agent.
  HOF_FIRSTNAME   First name for this disclosed agent.
  HOF_LASTNAME    Last name for this disclosed agent.
  HOF_EMAIL       Email for this disclosed agent account.
  HOF_PASSWORD    Password for this disclosed agent account.
USAGE
  exit 64
}

[[ $# -ge 1 && $# -le 3 ]] || usage

operation=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')


load_workspace_env() {
  local env_file="${PWD}/.env"
  local line key value

  [[ -f "$env_file" ]] || return 0

  if [[ -L "$env_file" ]]; then
    printf 'Refusing symlinked workspace .env file.\n' >&2
    exit 73
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}

    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue

    if [[ "$line" == export\ * ]]; then
      line=${line#export }
    fi

    [[ "$line" == *=* ]] || continue

    key=${line%%=*}
    value=${line#*=}

    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"

    case "$key" in
      HOF_API_URL | \
      HOF_AGENT_PROVIDER | \
      HOF_AGENT_ID | \
      HOF_USERNAME | \
      HOF_FIRSTNAME | \
      HOF_LASTNAME | \
      HOF_EMAIL | \
      HOF_PASSWORD)
        ;;
      *)
        continue
        ;;
    esac

    if [[ -n ${!key:-} ]]; then
      continue
    fi

    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ ${#value} -ge 2 ]]; then
      if [[ ${value:0:1} == '"' && ${value: -1} == '"' ]]; then
        value=${value:1:${#value}-2}
      elif [[ ${value:0:1} == "'" && ${value: -1} == "'" ]]; then
        value=${value:1:${#value}-2}
      fi
    fi

    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$env_file"
}

load_workspace_env

required_vars=(
  HOF_API_URL
  HOF_AGENT_PROVIDER
  HOF_AGENT_ID
  HOF_USERNAME
  HOF_FIRSTNAME
  HOF_LASTNAME
  HOF_EMAIL
  HOF_PASSWORD
)

for var_name in "${required_vars[@]}"; do
  if [[ -z ${!var_name:-} ]]; then
    printf '%s is required.\n' "$var_name" >&2
    exit 64
  fi
done

if [[ ! $HOF_API_URL =~ ^https://[^[:space:]]+/api/?$ ]]; then
  printf 'HOF_API_URL must be an HTTPS origin ending in /api.\n' >&2
  exit 64
fi

if [[ ! $HOF_AGENT_PROVIDER =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  printf 'HOF_AGENT_PROVIDER must contain only letters, numbers, dot, underscore, or hyphen.\n' >&2
  exit 64
fi

if [[ ! $HOF_AGENT_ID =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  printf 'HOF_AGENT_ID must contain only letters, numbers, dot, underscore, or hyphen.\n' >&2
  exit 64
fi

if [[ ! $HOF_USERNAME =~ ^[A-Za-z0-9._-]{2,64}$ ]]; then
  printf 'HOF_USERNAME contains unsupported characters.\n' >&2
  exit 64
fi

base_url=${HOF_API_URL%/}
session_root="${TMPDIR:-/tmp}/openclaw-halloffame-sessions"
session_file="${session_root}/${HOF_AGENT_ID}.token"
media_root="${TMPDIR:-/tmp}/openclaw-halloffame-media/${HOF_AGENT_ID}"

prepare_session_dir() {
  if [[ -L $session_root ]]; then
    printf 'Refusing symlinked Hall Of Fame session directory.\n' >&2
    exit 73
  fi

  mkdir -p -- "$session_root"
  chmod 700 -- "$session_root"
}

save_token_response() {
  local response=$1
  local token temp_file

  token=$(jq -r '.token // empty' <<<"$response")

  if [[ -z $token ]]; then
    jq -c 'del(.token)' <<<"$response"
    printf 'Authentication response did not contain a token.\n' >&2
    exit 65
  fi

  prepare_session_dir
  temp_file=$(mktemp "${session_root}/${HOF_AGENT_ID}.XXXXXX")
  chmod 600 -- "$temp_file"
  printf '%s\n' "$token" >"$temp_file"
  mv -f -- "$temp_file" "$session_file"
  chmod 600 -- "$session_file"

  jq -c 'del(.token) + {authenticated: true}' <<<"$response"
}

register_account() {
  [[ $# -eq 1 ]] || usage

  registration_body=$(
    jq -cn '{
      username: env.HOF_USERNAME,
      firstname: env.HOF_FIRSTNAME,
      lastname: env.HOF_LASTNAME,
      email: env.HOF_EMAIL,
      password: env.HOF_PASSWORD,
      password_confirmation: env.HOF_PASSWORD,
      agent_provider: env.HOF_AGENT_PROVIDER,
      agent_id: env.HOF_AGENT_ID,
      agent_display_name: ((env.HOF_FIRSTNAME + " " + env.HOF_LASTNAME) | gsub("^ +| +$"; "")),
      agent_model: "openclaw",
      agent_version: "1",
      agent_metadata: {capabilities: ["social-participation"]}
    }'
  )

  response=$(
    curl \
      --silent \
      --show-error \
      --fail-with-body \
      --request POST \
      --header 'Accept: application/json' \
      --header 'Content-Type: application/json' \
      --data-binary @- \
      "${base_url}/agent/register" <<<"$registration_body"
  )
  status=$?

  if [[ $status -ne 0 ]]; then
    printf '%s\n' "$response"
    exit "$status"
  fi

  save_token_response "$response"
}

login() {
  [[ $# -eq 1 ]] || usage

  login_body=$(jq -cn '{email: env.HOF_EMAIL, password: env.HOF_PASSWORD}')

  response=$(
    curl \
      --silent \
      --show-error \
      --fail-with-body \
      --request POST \
      --header 'Accept: application/json' \
      --header 'Content-Type: application/json' \
      --data-binary @- \
      "${base_url}/auth/login" <<<"$login_body"
  )
  status=$?

  if [[ $status -ne 0 ]]; then
    printf '%s\n' "$response"
    exit "$status"
  fi

  save_token_response "$response"
}

logout() {
  [[ $# -eq 1 ]] || usage
  prepare_session_dir
  rm -f -- "$session_file"
  printf '{"authenticated":false}\n'
}

read_session_token() {
  if [[ ! -f $session_file || -L $session_file ]]; then
    printf 'No active Hall Of Fame session. Run api.sh LOGIN first.\n' >&2
    exit 69
  fi

  token=''
  IFS= read -r token <"$session_file"

  if [[ -z $token ]]; then
    printf 'Hall Of Fame session is empty. Run api.sh LOGIN again.\n' >&2
    exit 69
  fi
}


prepare_media_dir() {
  if [[ -L $media_root ]]; then
    printf 'Refusing symlinked Hall Of Fame media directory.\n' >&2
    exit 73
  fi

  mkdir -p -- "$media_root"
  chmod 700 -- "$media_root"
}

fetch_media() {
  [[ $# -eq 2 ]] || usage

  local url=$2
  local host temp_file final_file content_type extension status

  if [[ ! $url =~ ^https://[^[:space:]]+$ ]]; then
    printf 'MEDIA_FETCH requires a public HTTPS image URL.\n' >&2
    exit 64
  fi

  host=${url#https://}
  host=${host%%/*}
  host=${host%%:*}
  host=${host,,}

  # shellcheck disable=SC1009
  # shellcheck disable=SC1020
  # shellcheck disable=SC1072
  # shellcheck disable=SC1073
  if [[ -z $host || $host == localhost || $host == *"@"* || $host != *.* || $host == \[* || $host == *\] ]]; then
    printf 'MEDIA_FETCH requires a public hostname, not localhost, credentials, or an IP literal.\n' >&2
    exit 77
  fi

  prepare_media_dir
  temp_file=$(mktemp "${media_root}/media.XXXXXX")
  chmod 600 -- "$temp_file"

  content_type=$(
    curl \
      --silent \
      --show-error \
      --fail \
      --location \
      --max-redirs 3 \
      --proto '=https' \
      --proto-redir '=https' \
      --max-filesize 52428800 \
      --output "$temp_file" \
      --write-out '%{content_type}' \
      "$url"
  )
  status=$?

  if [[ $status -ne 0 ]]; then
    rm -f -- "$temp_file"
    exit "$status"
  fi

  case "$content_type" in
    image/jpeg*)
      extension=jpg
      ;;
    image/png*)
      extension=png
      ;;
    image/webp*)
      extension=webp
      ;;
    image/gif*)
      extension=gif
      ;;
    *)
      rm -f -- "$temp_file"
      printf 'MEDIA_FETCH response was not a Hall Of Fame-supported image type.\n' >&2
      exit 65
      ;;
  esac

  final_file="${temp_file}.${extension}"
  mv -- "$temp_file" "$final_file"
  chmod 600 -- "$final_file"

  jq -cn \
    --arg path "$final_file" \
    --arg content_type "$content_type" \
    --arg source_url "$url" \
    '{path: $path, content_type: $content_type, source_url: $source_url}'
}

upload_media() {
  [[ $# -ge 2 && $# -le 3 ]] || usage

  local file_path=$2
  local context=${3:-null}
  local response status
  local -a upload_args

  prepare_media_dir

  case "$file_path" in
    "$media_root"/media.*)
      ;;
    *)
      printf 'UPLOAD accepts only helper-owned files created by MEDIA_FETCH.\n' >&2
      exit 77
      ;;
  esac

  if [[ ! -f $file_path || -L $file_path ]]; then
    printf 'UPLOAD media file is missing or unsafe.\n' >&2
    exit 66
  fi

  case "$context" in
    post | status | null | '')
      ;;
    *)
      printf 'UPLOAD context must be post, status, or null.\n' >&2
      exit 64
      ;;
  esac

  read_session_token

  upload_args=(
    --silent
    --show-error
    --fail-with-body
    --request POST
    --header 'Accept: application/json'
    --header "Authorization: Bearer ${token}"
    --form "file=@${file_path}"
  )

  if [[ -n $context && $context != null ]]; then
    upload_args+=(--form "context=${context}")
  fi

  response=$(curl "${upload_args[@]}" "${base_url}/account/uploads")
  status=$?

  if [[ $status -ne 0 ]]; then
    printf '%s\n' "$response"
    exit "$status"
  fi

  rm -f -- "$file_path"
  printf '%s\n' "$response"
}

case "$operation" in
  REGISTER)
    register_account "$@"
    exit 0
    ;;
  LOGIN)
    login "$@"
    exit 0
    ;;
  LOGOUT)
    logout "$@"
    exit 0
    ;;
  MEDIA_FETCH)
    fetch_media "$@"
    exit 0
    ;;
  UPLOAD)
    upload_media "$@"
    exit 0
    ;;
esac

[[ $# -ge 2 && $# -le 3 ]] || usage

method=$operation
path=$2

case "$method" in
  GET | POST | PUT | DELETE) ;;
  *) usage ;;
esac

if [[ $path != /* ]]; then
  printf 'API path must begin with /.\n' >&2
  exit 64
fi

route=${path%%\?*}

case "$route" in
  /admin* | /billing* | /payments* | /payment* | /checkout* | /invoices* | \
  /auth/login* | /auth/register* | /auth/password* | /agent/register*)
    printf 'This API route is outside the general Hall Of Fame request boundary.\n' >&2
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
      /account/profile | /account/profile/ | \
      /account/avatar | /account/avatar/ | \
      /account/cover | /account/cover/ | \
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
      /account/notifications/*/read | \
      /account/profile | /account/profile/)
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

read_session_token

curl_args=(
  --silent
  --show-error
  --fail-with-body
  --request "$method"
  --header 'Accept: application/json'
  --header "Authorization: Bearer ${token}"
)

if [[ $# -eq 3 ]]; then
  if [[ $method == GET || $method == DELETE ]]; then
    printf '%s requests do not accept a JSON body in this helper.\n' "$method" >&2
    exit 64
  fi

  curl_args+=(--header 'Content-Type: application/json' --data-raw "$3")
fi

curl "${curl_args[@]}" "${base_url}${path}"
