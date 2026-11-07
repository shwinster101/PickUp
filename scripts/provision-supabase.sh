#!/usr/bin/env bash
# scripts/provision-supabase.sh — one command from "no project" to a filled assets/js/config.js.
#
# Turns the manual checklist in supabase/README.md into calls on the Supabase Management API
# (https://api.supabase.com; bearer = a personal access token). Needs bash, curl and python3 only.
# Field names come from the Management API's OpenAPI document (components.schemas.*), not memory.
#
#   SUPABASE_ACCESS_TOKEN=… scripts/provision-supabase.sh            provision (idempotent: reuse or create)
#   SUPABASE_ACCESS_TOKEN=… scripts/provision-supabase.sh --check    verify the project and config.js only
#   SUPABASE_ACCESS_TOKEN=… scripts/provision-supabase.sh --dry-run  print the plan and the calls; GETs only
#   SUPABASE_ACCESS_TOKEN=… scripts/provision-supabase.sh --schedule re-post 0004 (the pg_cron jobs) after enabling pg_cron in the dashboard
#
# Environment (all optional but the token):
#   SUPABASE_ACCESS_TOKEN   required. Never echoed, never written anywhere; sent to curl through a pipe.
#   SUPABASE_ORG_SLUG       the organisation; when the account has exactly one it is used, otherwise listed.
#   SUPABASE_PROJECT_NAME   default "pickup".          SUPABASE_REGION  default us-west-1 (validated).
#   SUPABASE_DB_PASSWORD    else 32 random chars are generated, printed ONCE, and never written to disk.
#   SUPABASE_API_URL        default https://api.supabase.com (the test points it at a mock).
#   SUPABASE_PROJECT_URL    default https://<ref>.supabase.co (the project's own API; the test overrides it).
#   SUPABASE_SITE_URL       auth site_url, default the Pages URL below.
#   SUPABASE_KEY_KIND       "anon" (legacy JWT, default) or "publishable"; the other is the fallback.
#   SUPABASE_WAIT_SECONDS   how long to wait for a new project's database (default 900); SUPABASE_POLL_SECONDS 10.
#   SUPABASE_RESEED=1       re-run seed.sql even when the courts are already there (it is an upsert).
#   SUPABASE_ASSUME_APPLIED=1  record the migrations as applied without running them (the schema was
#                           applied by hand per the README and the history is empty).
#   CONFIG_OUT              default assets/js/config.js; GOOGLE_MAP_ID and METRO in it are preserved.
#
# What it never does: print or store any key but the anon/publishable one; write the token or the
# database password to a file; touch a migration that the project's history already records.
set -Eeuo pipefail
umask 077

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PAGES_URL='https://shwinster101.github.io/PickUp/'
LOCAL_URL='http://localhost:8000'
PG_CRON_DOC='https://supabase.com/docs/guides/cron/install'
# Supabase's own instruction (PG_CRON_DOC, read 2026-10-17): "create extension pg_cron with schema
# pg_catalog;" then grant usage on schema cron and all privileges on its tables to postgres.
PG_CRON_SQL='create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;'

MODE=provision
for a in "$@"; do
  case "$a" in
    --check) MODE=check ;;
    --schedule) MODE=schedule ;;
    --dry-run) MODE=dry-run ;;
    -h|--help) awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    *) printf 'unknown argument: %s (try --help)\n' "$a" >&2; exit 2 ;;
  esac
done

TOKEN=${SUPABASE_ACCESS_TOKEN:-}
API_URL=${SUPABASE_API_URL:-https://api.supabase.com}; API_URL=${API_URL%/}
NAME=${SUPABASE_PROJECT_NAME:-pickup}
REGION=${SUPABASE_REGION:-us-west-1}
ORG=${SUPABASE_ORG_SLUG:-}
SITE_URL=${SUPABASE_SITE_URL:-$PAGES_URL}
KEY_KIND=${SUPABASE_KEY_KIND:-anon}
WAIT=${SUPABASE_WAIT_SECONDS:-900}
POLL=${SUPABASE_POLL_SECONDS:-10}
CONFIG_OUT=${CONFIG_OUT:-$ROOT/assets/js/config.js}
DB_PASS=${SUPABASE_DB_PASSWORD:-}
REF=''
HTTP_STATUS=''; HTTP_BODY=''; LAST_HTTP=''
STEP='0' ; STEP_TITLE='inputs'

# ---- output ------------------------------------------------------------------------------------
say()  { printf '%s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
step() { STEP=$1; STEP_TITLE=$2; printf '\n[%s] %s\n' "$1" "$2"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
on_err() {
  local rc=$?
  trap - ERR
  [ "$BASHPID" = "$$" ] || exit "$rc"   # inside $( … ) the parent reports; do not print twice
  printf '\nFAILED at step %s (%s), exit %s%s\n' "$STEP" "$STEP_TITLE" "$rc" "${LAST_HTTP:+ · last call: $LAST_HTTP}" >&2
  exit "$rc"
}
trap on_err ERR
# Anything printed from an API body goes through scrub(): the token and the password never appear.
scrub() {
  local s=$1
  [ -n "$TOKEN" ] && s=${s//"$TOKEN"/<token>}
  [ -n "$DB_PASS" ] && s=${s//"$DB_PASS"/<db password>}
  printf '%s' "$s"
}

# ---- JSON (python3 standard library; -I ignores any PYTHON* environment) ------------------------
# py EXPR [ARG…]: stdin is JSON as d, extra arguments are a[0], a[1]…; prints the expression.
py() {
  python3 -I -c '
import json, sys
d = json.load(sys.stdin)
a = sys.argv[2:]
v = eval(sys.argv[1])
if v is None: v = ""
elif isinstance(v, bool): v = "true" if v else "false"
elif isinstance(v, (dict, list)): v = json.dumps(v)
print(v)' "$@"
}
# json_file KEY=@path KEY=value …: builds {"key": <file contents or string>} without shell quoting trouble.
json_body() {
  python3 -I -c '
import json, sys
o = {}
for kv in sys.argv[1:]:
    k, _, v = kv.partition("=")
    o[k] = open(v[1:], encoding="utf-8").read() if v.startswith("@") else v
print(json.dumps(o))' "$@"
}

# ---- HTTP ---------------------------------------------------------------------------------------
# api METHOD PATH [JSON_BODY] [extra curl args…]: sets HTTP_STATUS and HTTP_BODY; returns 1 on a non-2xx.
# The token reaches curl through a process substitution (a pipe): never on the command line, never on disk.
api() {
  local method=$1 path=$2 body=${3:-}
  shift 3 2>/dev/null || shift $#
  local -a args=(-sS --max-time 180 -X "$method" -H 'Accept: application/json' "$@")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data-binary @-)
  local out
  if ! out=$(printf '%s' "$body" | curl "${args[@]}" --config <(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN") \
        -w $'\n__status__%{http_code}' "$API_URL$path" 2>&1); then
    HTTP_STATUS=000; HTTP_BODY=$out; LAST_HTTP="$method $path → no answer"; return 1
  fi
  HTTP_STATUS=${out##*__status__}
  HTTP_BODY=${out%$'\n'__status__*}
  LAST_HTTP="$method $path → HTTP $HTTP_STATUS"
  case $HTTP_STATUS in 2*) return 0 ;; *) return 1 ;; esac
}
# must: like api, but a non-2xx prints the API's error body (scrubbed) and stops the script.
must() {
  if ! api "$@"; then
    printf 'error: %s %s answered HTTP %s\n%s\n' "$1" "$2" "$HTTP_STATUS" "$(scrub "$(printf '%s' "$HTTP_BODY" | head -c 1500)")" >&2
    return 1
  fi
}
# sql "statement": runs it through the database/query endpoint; prints the rows (JSON).
sql() {
  local body
  body=$(json_body "query=$1")
  must POST "/v1/projects/$REF/database/query" "$body"
  printf '%s' "$HTTP_BODY"
}
# try_sql "statement": like sql, but a non-2xx returns 1 instead of stopping the script.
try_sql() {
  local body
  body=$(json_body "query=$1")
  api POST "/v1/projects/$REF/database/query" "$body" || return 1
  printf '%s' "$HTTP_BODY"
}
# rest PATH KEY: a GET on the project's own REST API with the given apikey; sets HTTP_STATUS/HTTP_BODY.
rest() {
  local out
  out=$(curl -sS --max-time 60 -H "apikey: $2" -H "Authorization: Bearer $2" -w $'\n__status__%{http_code}' "$PROJECT_URL$1" 2>&1) || { HTTP_STATUS=000; HTTP_BODY=$out; return 1; }
  HTTP_STATUS=${out##*__status__}; HTTP_BODY=${out%$'\n'__status__*}
  case $HTTP_STATUS in 2*) return 0 ;; *) return 1 ;; esac
}

# ---- shared pieces --------------------------------------------------------------------------------
seed_rows() { python3 -I -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["courts"]))' "$ROOT/assets/data/courts.json"; }
project_url() { printf '%s' "${SUPABASE_PROJECT_URL:-https://$REF.supabase.co}"; }
config_value() { # config_value KEY FILE → the quoted value in config.js, or nothing
  [ -f "$2" ] || return 0
  python3 -I -c '
import re, sys
m = re.search(sys.argv[1] + r"""\s*:\s*(["\x27])(.*?)\1""", open(sys.argv[2], encoding="utf-8").read())
print(m.group(2) if m else "")' "$1" "$2"
}

resolve_org() {
  must GET /v1/organizations
  local count; count=$(printf '%s' "$HTTP_BODY" | py 'len(d)')
  if [ -n "$ORG" ]; then
    [ "$(printf '%s' "$HTTP_BODY" | py 'any(o["slug"] == a[0] for o in d)' "$ORG")" = true ] \
      || die "organisation '$ORG' is not one of: $(printf '%s' "$HTTP_BODY" | py '", ".join(o["slug"] for o in d)')"
  elif [ "$count" = 1 ]; then
    ORG=$(printf '%s' "$HTTP_BODY" | py 'd[0]["slug"]')
  elif [ "$count" = 0 ]; then
    die "this token sees no organisation; create one at https://supabase.com/dashboard"
  else
    say "   this account has $count organisations; set SUPABASE_ORG_SLUG to one of:"
    printf '%s' "$HTTP_BODY" | py '"\n".join("     %-28s %s" % (o["slug"], o["name"]) for o in d)'
    exit 2
  fi
  note "organisation: $ORG"
}
find_project() { # sets REF when a project with NAME exists in ORG; prints its status
  must GET /v1/projects
  REF=$(printf '%s' "$HTTP_BODY" | py '" ".join(p["ref"] for p in d if p["name"] == a[0] and p["organization_slug"] == a[1])' "$NAME" "$ORG")
  if [ -n "$REF" ]; then
    case "$REF" in *" "*) note "several projects are named '$NAME'; using the first (${REF%% *})"; REF=${REF%% *} ;; esac
    PROJECT_STATUS=$(printf '%s' "$HTTP_BODY" | py '[p["status"] for p in d if p["ref"] == a[0]][0]' "$REF")
  fi
}
validate_region() {
  if api GET "/v1/projects/available-regions?organization_slug=$ORG"; then
    local codes; codes=$(printf '%s' "$HTTP_BODY" | py '" ".join(r["code"] for r in d.get("all", {}).get("specific", []))')
    if [ -n "$codes" ]; then
      case " $codes " in
        *" $REGION "*) note "region: $REGION (available)" ;;
        *) die "region '$REGION' is not available to $ORG; choose one of: $codes" ;;
      esac
    else
      note "region: $REGION (the regions endpoint listed none; not validated)"
    fi
  else
    note "region: $REGION (available-regions answered HTTP $HTTP_STATUS; not validated)"
  fi
}
ensure_db_pass() {
  if [ -z "$DB_PASS" ]; then
    DB_PASS=$(python3 -I -c 'import secrets, string; a = string.ascii_letters + string.digits; print("".join(secrets.choice(a) for _ in range(32)))')
    say ''
    say '   ┌──────────────────────────────────────────────────────────────────────────────┐'
    printf '   │ %-76s │\n' 'database password (shown once, stored nowhere by this script):' \
                            "  $DB_PASS" 'STORE IT in your password manager now; Supabase needs it for direct psql.'
    say '   └──────────────────────────────────────────────────────────────────────────────┘'
  else
    note 'database password: from SUPABASE_DB_PASSWORD'
  fi
}
create_body() { # the V1CreateProjectBody; the password enters python through the environment, not argv
  DB_PASS="$DB_PASS" python3 -I -c '
import json, os, sys
print(json.dumps({"name": sys.argv[1], "organization_slug": sys.argv[2], "db_pass": os.environ["DB_PASS"],
                  "region_selection": {"type": "specific", "code": sys.argv[3]}}))' "$NAME" "$ORG" "$REGION"
}
wait_healthy() {
  local deadline now left status svc tty=0
  [ -t 1 ] && tty=1
  deadline=$(( $(date +%s) + WAIT ))
  while :; do
    status=unreachable
    api GET "/v1/projects/$REF" && status=$(printf '%s' "$HTTP_BODY" | py 'd["status"]')
    case "$status" in
      INIT_FAILED|RESTORE_FAILED|REMOVED|PAUSE_FAILED) die "project $REF is $status; look at it in the dashboard" ;;
    esac
    svc=''
    if [ "$status" = ACTIVE_HEALTHY ]; then
      # The health endpoint's parameters have changed under us once (2026-10-18: a 400 on the query
      # string), so try the documented form, then without timeout_ms, then bare; a 4xx on all three
      # means the endpoint is not usable from this token and ACTIVE_HEALTHY alone is accepted.
      local hp ok=0
      for hp in '?services=db,rest,auth&timeout_ms=5000' '?services=db,rest,auth' ''; do
        if api GET "/v1/projects/$REF/health$hp"; then ok=1; break; fi
        case $HTTP_STATUS in 4*) continue ;; *) break ;; esac
      done
      if [ $ok = 1 ]; then
        svc=$(printf '%s' "$HTTP_BODY" | py '" ".join(s["name"] + ":" + s["status"] for s in d) if isinstance(d, list) else "?"')
        if [ "$(printf '%s' "$HTTP_BODY" | py 'isinstance(d, list) and len(d) > 0 and all(s["status"] == "ACTIVE_HEALTHY" for s in d)')" = true ]; then
          [ $tty = 1 ] && printf '\r%80s\r' ''
          note "healthy: project $status · $svc"
          return 0
        fi
      else
        case $HTTP_STATUS in
          4*) [ $tty = 1 ] && printf '\r%80s\r' ''
              note "healthy: project $status (the health endpoint answered HTTP $HTTP_STATUS to every form; accepted on the project status alone)"
              return 0 ;;
        esac
        svc="health HTTP $HTTP_STATUS"
      fi
    fi
    now=$(date +%s); left=$(( deadline - now ))
    if [ "$left" -le 0 ]; then
      [ $tty = 1 ] && printf '\n'
      die "the database was not healthy after ${WAIT}s (project $status${svc:+ · $svc}); re-run later, it will reuse the project"
    fi
    if [ $tty = 1 ]; then printf '\r   waiting · project %s%s · %ss left   ' "$status" "${svc:+ · $svc}" "$left"
    else note "waiting · project $status${svc:+ · $svc} · ${left}s left"; fi
    sleep "$POLL"
  done
}
# auth_patch_body → the UpdateAuthConfigBody that brings the config to what the page needs, or "" if nothing differs.
auth_patch_body() {
  printf '%s' "$HTTP_BODY" | python3 -I -c '
import json, sys
cur = json.load(sys.stdin)
site, pages, local = sys.argv[1], sys.argv[2], sys.argv[3]
want = {}
if cur.get("external_anonymous_users_enabled") is not True: want["external_anonymous_users_enabled"] = True
if cur.get("external_email_enabled") is not True: want["external_email_enabled"] = True
have = [u.strip() for u in (cur.get("uri_allow_list") or "").split(",") if u.strip()]
for u in (pages, pages.rstrip("/") + "/**", local.rstrip("/") + "/**"):
    if u not in have: have.append(u)
merged = ",".join(have)
if merged != (cur.get("uri_allow_list") or ""): want["uri_allow_list"] = merged
if (cur.get("site_url") or "") in ("", "http://localhost:3000") and site != (cur.get("site_url") or ""):
    want["site_url"] = site
print(json.dumps(want) if want else "")' "$SITE_URL" "$PAGES_URL" "$LOCAL_URL"
}
# applied_list → JSON [{version,name}] from the migrations endpoint, else from the table itself, else fails.
applied_list() {
  if api GET "/v1/projects/$REF/database/migrations"; then printf '%s' "$HTTP_BODY"; return 0; fi
  note "migration history endpoint answered HTTP $HTTP_STATUS; reading supabase_migrations.schema_migrations directly"
  local body
  body=$(json_body 'query=select version, name from supabase_migrations.schema_migrations order by version')
  if api POST "/v1/projects/$REF/database/query" "$body"; then printf '%s' "$HTTP_BODY"; return 0; fi
  case "$HTTP_BODY" in *"does not exist"*) printf '[]'; return 0 ;; esac
  printf 'error: cannot read the migration history (HTTP %s): %s\n' "$HTTP_STATUS" "$(scrub "$HTTP_BODY")" >&2
  return 1
}
is_recorded() { # is_recorded LIST_JSON BASENAME → true/false (by version prefix or by either name form)
  printf '%s' "$1" | py 'any(m.get("version") == a[0].split("_", 1)[0] or m.get("name") in (a[0], (a[0].split("_", 1) + [""])[1]) for m in d)' "$2"
}
select_anon_key() { # stdin: ApiKeyResponse[] → "<kind> <key>", the preferred public key first; "all" lists both kinds
  python3 -I -c '
import base64, json, sys
keys = json.load(sys.stdin)
def role(k):  # a legacy key is a JWT whose payload names its role; refuse anything but anon
    try:
        p = k.split(".")[1]; p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get("role")
    except Exception:
        return None
legacy = [("anon", k["api_key"]) for k in keys if k.get("type") == "legacy" and k.get("name") == "anon" and k.get("api_key") and role(k["api_key"]) in (None, "anon")]
pub = [("publishable", k["api_key"]) for k in keys if k.get("type") == "publishable" and k.get("api_key")]
found = [x for lst in ([pub, legacy] if sys.argv[1] == "publishable" else [legacy, pub]) for x in lst]
if not found: sys.exit(3)
for kind, key in (found if len(sys.argv) > 2 else found[:1]): print(kind, key)' "$KEY_KIND" "$@"
}
write_config() { # write_config URL KEY → CONFIG_OUT, keeping GOOGLE_MAP_ID, METRO and CAPTCHA_SITE_KEY from the current file
  local map_id metro captcha tmp
  map_id=$(config_value GOOGLE_MAP_ID "$CONFIG_OUT"); metro=$(config_value METRO "$CONFIG_OUT"); metro=${metro:-LA}
  captcha=$(config_value CAPTCHA_SITE_KEY "$CONFIG_OUT")
  mkdir -p "$(dirname "$CONFIG_OUT")"
  tmp="$CONFIG_OUT.tmp.$$"
  python3 -I -c '
import json, sys
url, key, map_id, metro, captcha, out = sys.argv[1:7]
q = lambda s: json.dumps(s).replace("\x27", "\\u0027")[1:-1]  # JS-safe inside single quotes
text = """/* ============================================================
   OPENCOURT — runtime configuration (client-side values only)
   ============================================================
   The Supabase anon key is a public, publishable credential: row-level
   security in the database is the boundary (docs/MIGRATION.md §3).
   Service-role keys never belong here or anywhere in this repository.

   Empty SUPABASE values mean "no backend": the page serves
   assets/data/courts.json, keeps reports on this device, says so in the
   sidebar, and hides the pickups features.

   Written by scripts/provision-supabase.sh; GOOGLE_MAP_ID, METRO and CAPTCHA_SITE_KEY are kept across runs.
   ============================================================ */
window.OPENCOURT_CONFIG = {
  SUPABASE_URL: \x27%s\x27,
  SUPABASE_ANON_KEY: \x27%s\x27,   // the project\x27s anon / publishable key
  GOOGLE_MAP_ID: \x27%s\x27,       // optional: a Map ID enables Advanced Markers (Google then ignores the JSON map style)
  METRO: \x27%s\x27,
  CAPTCHA_SITE_KEY: \x27%s\x27     // optional: a Cloudflare Turnstile site key; set it before enabling CAPTCHA in Supabase (supabase/README.md)
};
""" % (q(url), q(key), q(map_id), q(metro), q(captcha))
open(out, "w", encoding="utf-8").write(text)' "$1" "$2" "$map_id" "$metro" "$captcha" "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$CONFIG_OUT"
  note "wrote $CONFIG_OUT (GOOGLE_MAP_ID '${map_id}', METRO '${metro}' and CAPTCHA_SITE_KEY '${captcha}' kept)"
}

# =================================================================================================
[ -n "$TOKEN" ] || die 'SUPABASE_ACCESS_TOKEN is not set. Make one at https://supabase.com/dashboard/account/tokens and export it; it is read from the environment only.'
for t in curl python3; do command -v "$t" >/dev/null 2>&1 || die "$t is required"; done
SEED_ROWS=$(seed_rows)
say "PickUp · Supabase provisioner · mode: $MODE · API: $API_URL"

# ---- --schedule ------------------------------------------------------------------------------------
# After the owner enables pg_cron in the dashboard: re-post 0004 (cron.schedule upserts by job name, so
# this is idempotent) and show the jobs. Resolves the project from config.js when it is filled, else by name.
if [ "$MODE" = schedule ]; then
  CFG_URL=$(config_value SUPABASE_URL "$CONFIG_OUT")
  if [[ "$CFG_URL" =~ ^https://([a-z]{20})\.supabase\.co$ ]]; then REF=${BASH_REMATCH[1]}; else resolve_org; find_project >/dev/null; fi
  [ -n "$REF" ] || die "no project found (config.js is empty and no project named $NAME exists in the organisation)"
  step 1 "pg_cron on $REF"
  probe=$(try_sql "select exists(select 1 from pg_extension where extname = 'pg_cron') as installed, has_schema_privilege('cron', 'usage') as usable" 2>/dev/null || printf '[]')
  if [ "$(printf '%s' "$probe" | py 'bool(isinstance(d, list) and d and d[0].get("installed") and d[0].get("usable"))')" != true ]; then
    die "pg_cron is not usable yet ($(printf '%s' "$probe" | py 'json.dumps(d[0]) if isinstance(d, list) and d else "no answer"')); enable it in the dashboard (Database → Extensions → pg_cron) and re-run"
  fi
  step 2 'post supabase/migrations/0004_schedules.sql'
  f=$(ls "$ROOT"/supabase/migrations/0004_*.sql | head -1)
  body=$(json_body "query=@$f"); must POST "/v1/projects/$REF/database/query" "$body" >/dev/null
  jobs=$(sql "select jobname, schedule from cron.job where jobname like 'pickups-%' order by jobname")
  note "jobs: $(printf '%s' "$jobs" | py '", ".join("%s (%s)" % (j["jobname"], j["schedule"]) for j in d) if isinstance(d, list) and d else "none"')"
  [ "$(printf '%s' "$jobs" | py 'len(d) if isinstance(d, list) else 0')" = 3 ] && say 'SCHEDULE DONE' || die 'expected the three pickups-* jobs'
  exit 0
fi

# ---- --check ---------------------------------------------------------------------------------------
if [ "$MODE" = check ]; then
  miss=0
  ok()   { printf '   ok    %s\n' "$*"; }
  bad()  { printf '   MISS  %s\n' "$*"; miss=$((miss + 1)); }
  expect() { local okm=$1 badm=$2; shift 2; if "$@"; then ok "$okm"; else bad "$badm"; fi; }  # expect OK_MSG MISS_MSG test…
  step 1 "config.js ($CONFIG_OUT)"
  CFG_URL=$(config_value SUPABASE_URL "$CONFIG_OUT"); CFG_KEY=$(config_value SUPABASE_ANON_KEY "$CONFIG_OUT")
  expect "SUPABASE_URL $CFG_URL" 'SUPABASE_URL is empty' test -n "$CFG_URL"
  expect "SUPABASE_ANON_KEY present (${CFG_KEY:0:12}…)" 'SUPABASE_ANON_KEY is empty' test -n "$CFG_KEY"
  step 2 'project'
  if [[ "$CFG_URL" =~ ^https://([a-z]{20})\.supabase\.co$ ]]; then REF=${BASH_REMATCH[1]}; else resolve_org; find_project; fi
  if [ -z "$REF" ]; then bad "no project named '$NAME' and no ref in SUPABASE_URL"; else
    if api GET "/v1/projects/$REF"; then
      st=$(printf '%s' "$HTTP_BODY" | py 'd["status"]')
      expect "project $REF is $st" "project $REF is $st" test "$st" = ACTIVE_HEALTHY
    else bad "GET /v1/projects/$REF answered HTTP $HTTP_STATUS"; fi
  fi
  if [ -n "$REF" ]; then
    PROJECT_URL=$(project_url)
    step 3 'anon key'
    if api GET "/v1/projects/$REF/api-keys?reveal=true"; then
      if sel=$(printf '%s' "$HTTP_BODY" | select_anon_key all); then
        kind=$(printf '%s\n' "$sel" | awk -v k="$CFG_KEY" '$2 == k { print $1; exit }')
        expect "config.js holds the project's $kind key" "config.js key is neither the project's anon nor its publishable key" test -n "$kind"
      else bad 'the project lists no anon/publishable key'; fi
      HTTP_BODY=''
    else bad "GET api-keys answered HTTP $HTTP_STATUS"; fi
    step 4 'courts_live'
    if [ -n "$CFG_KEY" ] && rest '/rest/v1/courts_live?select=id' "$CFG_KEY"; then
      n=$(printf '%s' "$HTTP_BODY" | py 'len(d)')
      expect "courts_live returns $n rows" "courts_live returns $n rows, expected $SEED_ROWS" test "$n" = "$SEED_ROWS"
    else bad "GET $PROJECT_URL/rest/v1/courts_live answered HTTP $HTTP_STATUS"; fi
    step 5 'auth config'
    if api GET "/v1/projects/$REF/config/auth"; then
      expect 'anonymous sign-ins on' 'anonymous sign-ins off' test "$(printf '%s' "$HTTP_BODY" | py 'd.get("external_anonymous_users_enabled")')" = true
      expect 'email sign-in on' 'email sign-in off' test "$(printf '%s' "$HTTP_BODY" | py 'd.get("external_email_enabled")')" = true
      case ",$(printf '%s' "$HTTP_BODY" | py 'd.get("uri_allow_list")')," in
        *",$PAGES_URL,"*|*",${PAGES_URL%/}/**,"*) ok 'redirect allow list has the Pages URL' ;;
        *) bad 'redirect allow list lacks the Pages URL' ;;
      esac
    else bad "GET config/auth answered HTTP $HTTP_STATUS"; fi
  fi
  say ''
  if [ "$miss" = 0 ]; then say 'CHECK PASSED'; exit 0; fi
  say "CHECK FAILED · $miss miss(es)"; exit 1
fi

# ---- --dry-run -------------------------------------------------------------------------------------
if [ "$MODE" = dry-run ]; then
  say 'DRY RUN · reads only (GET); every write below is printed, not sent'
  step 1 'organisation';            resolve_org
  step 2 'project create-or-reuse'; find_project
  if [ -n "$REF" ]; then note "reuse $REF (status ${PROJECT_STATUS:-?})"; r=$REF; else
    validate_region
    r='<ref>'
    note "would POST /v1/projects  $(DB_PASS='<generated, printed once>' create_body)"
  fi
  step 3 'wait healthy';            note "GET /v1/projects/$r and GET /v1/projects/$r/health?services=db,rest,auth every ${POLL}s, up to ${WAIT}s"
  step 4 'auth config'
  if [ -n "$REF" ] && api GET "/v1/projects/$REF/config/auth"; then
    body=$(auth_patch_body)
    if [ -n "$body" ]; then note "would PATCH /v1/projects/$r/config/auth  $body"; else note 'already as needed; no PATCH'; fi
  else note "would PATCH /v1/projects/$r/config/auth  {\"external_anonymous_users_enabled\": true, \"external_email_enabled\": true, \"site_url\": \"$SITE_URL\", \"uri_allow_list\": \"$PAGES_URL,${PAGES_URL%/}/**,$LOCAL_URL/**\"}"; fi
  step 5 'pg_cron';                 note "would POST /v1/projects/$r/database/query  {\"query\": \"$(printf '%s' "$PG_CRON_SQL" | tr '\n' ' ')\"}"
  step 6 'migrations and seed'
  list='[]'; [ -n "$REF" ] && list=$(applied_list)
  for f in "$ROOT"/supabase/migrations/*.sql; do
    b=$(basename "$f" .sql)
    if [ "$(is_recorded "$list" "$b")" = true ]; then note "skip  $b (recorded)"; else
      note "would POST /v1/projects/$r/database/query  {\"query\": @$f}"
      note "would PUT  /v1/projects/$r/database/migrations  {\"query\": @$f, \"name\": \"$b\"}"
    fi
  done
  note "would POST /v1/projects/$r/database/query  {\"query\": @$ROOT/supabase/seed.sql} when select count(*) from public.courts < $SEED_ROWS"
  step 7 'anon key';                note "GET /v1/projects/$r/api-keys?reveal=true → the ${KEY_KIND} key only; nothing else is printed or stored"
  step 8 'verify from outside';     note "GET ${SUPABASE_PROJECT_URL:-https://$r.supabase.co}/rest/v1/courts_live?select=id&limit=1 (apikey) → 200, 1 row; count(*) → $SEED_ROWS"
  step 9 'config';                  note "would write $CONFIG_OUT keeping GOOGLE_MAP_ID '$(config_value GOOGLE_MAP_ID "$CONFIG_OUT")' and METRO '$(config_value METRO "$CONFIG_OUT")'"
  say ''; say 'DRY RUN DONE · nothing was created or changed'
  exit 0
fi

# ---- provision -------------------------------------------------------------------------------------
step 1 'organisation'
resolve_org

step 2 'project create-or-reuse'
find_project
if [ -n "$REF" ]; then
  note "reuse: '$NAME' exists as $REF (status ${PROJECT_STATUS:-?})"
else
  validate_region
  ensure_db_pass
  must POST /v1/projects "$(create_body)"
  REF=$(printf '%s' "$HTTP_BODY" | py 'd["ref"]')
  note "created: $REF in $(printf '%s' "$HTTP_BODY" | py 'd["region"]') (status $(printf '%s' "$HTTP_BODY" | py 'd["status"]'))"
fi
PROJECT_URL=$(project_url)
note "project URL: $PROJECT_URL"

step 3 'wait until the database is healthy'
wait_healthy

step 4 'auth: anonymous sign-ins on, email kept on, redirect URLs'
must GET "/v1/projects/$REF/config/auth"
body=$(auth_patch_body)
if [ -n "$body" ]; then
  must PATCH "/v1/projects/$REF/config/auth" "$body"
  note "patched: $body"
else
  note 'already as needed'
fi
note "now: anonymous $(printf '%s' "$HTTP_BODY" | py 'd.get("external_anonymous_users_enabled")') · email $(printf '%s' "$HTTP_BODY" | py 'd.get("external_email_enabled")') · site_url $(printf '%s' "$HTTP_BODY" | py 'd.get("site_url")')"

step 5 "pg_cron (per $PG_CRON_DOC)"
# Each statement on its own and best-effort: the query endpoint runs as postgres, and on 2026-10-18 a
# privilege error here aborted a real run with the project half-provisioned. 0004 now tolerates a
# missing or unusable pg_cron (it prints a notice), so this step never stops the run; --schedule
# re-posts 0004 once the extension is enabled (Dashboard → Database → Extensions → pg_cron).
cron_ok=0
if try_sql "create extension if not exists pg_cron with schema pg_catalog" >/dev/null; then :; else
  note "create extension pg_cron: HTTP $HTTP_STATUS · $(scrub "$(printf '%s' "$HTTP_BODY" | head -c 300)")"
fi
try_sql "grant usage on schema cron to postgres" >/dev/null || note "grant usage on schema cron: not permitted from here (fine when the dashboard enabled it)"
try_sql "grant all privileges on all tables in schema cron to postgres" >/dev/null || true
probe=$(try_sql "select exists(select 1 from pg_extension where extname = 'pg_cron') as installed, has_schema_privilege('cron', 'usage') as usable" 2>/dev/null || printf '[]')
if [ "$(printf '%s' "$probe" | py 'bool(isinstance(d, list) and d and d[0].get("installed") and d[0].get("usable"))')" = true ]; then
  cron_ok=1; note "pg_cron: installed and usable; 0004 will schedule the three jobs"
else
  note "pg_cron: NOT usable from the query endpoint ($(printf '%s' "$probe" | py 'json.dumps(d[0]) if isinstance(d, list) and d else "no answer"')). Continuing: 0004 prints a notice instead of scheduling."
  note "        → enable it in the dashboard (Database → Extensions → pg_cron), then: scripts/provision-supabase.sh --schedule"
fi

step 6 'migrations in order, then the seed (idempotent: recorded versions are skipped)'
list=$(applied_list)
note "history: $(printf '%s' "$list" | py 'len(d)') recorded"
if [ "$(printf '%s' "$list" | py 'len(d)')" = 0 ] && [ "${SUPABASE_ASSUME_APPLIED:-}" != 1 ]; then
  exists=$(sql "select exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'courts') as exists")
  if [ "$(printf '%s' "$exists" | py 'bool(d and d[0].get("exists"))')" = true ]; then
    first=$(ls "$ROOT"/supabase/migrations/*.sql | head -1 | xargs -n1 basename | sed 's/_.*//')
    last=$(ls "$ROOT"/supabase/migrations/*.sql | tail -1 | xargs -n1 basename | sed 's/_.*//')
    die "public.courts exists but the migration history is empty (applied by hand per the README?). Re-run with SUPABASE_ASSUME_APPLIED=1 to record every file in supabase/migrations/ ($first–$last) as applied without running them."
  fi
fi
applied=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  b=$(basename "$f" .sql)
  if [ "$(is_recorded "$list" "$b")" = true ]; then note "skip   $b (recorded)"; continue; fi
  if [ "${SUPABASE_ASSUME_APPLIED:-}" = 1 ]; then
    must PUT "/v1/projects/$REF/database/migrations" "$(json_body "query=@$f" "name=$b")" -H "Idempotency-Key: $b"
    note "record $b (assumed applied; not run)"; continue
  fi
  must POST "/v1/projects/$REF/database/query" "$(json_body "query=@$f")"
  must PUT "/v1/projects/$REF/database/migrations" "$(json_body "query=@$f" "name=$b")" -H "Idempotency-Key: $b"
  note "apply  $b · recorded"
  applied=$((applied + 1))
done
count=$(sql 'select count(*) from public.courts' | py 'int(d[0]["count"]) if isinstance(d, list) and d else -1')
if [ "$count" -lt "$SEED_ROWS" ] || [ "${SUPABASE_RESEED:-}" = 1 ]; then
  must POST "/v1/projects/$REF/database/query" "$(json_body "query=@$ROOT/supabase/seed.sql")"
  count=$(sql 'select count(*) from public.courts' | py 'int(d[0]["count"]) if isinstance(d, list) and d else -1')
  note "seed   courts: $count rows"
else
  note "seed   skipped · courts already holds $count rows (SUPABASE_RESEED=1 to upsert again)"
fi
note "applied $applied migration file(s) this run; history now $(applied_list | py 'len(d)') recorded"

step 7 'the anon key (and nothing else)'
must GET "/v1/projects/$REF/api-keys?reveal=true"
if ! sel=$(printf '%s' "$HTTP_BODY" | select_anon_key); then HTTP_BODY=''; die 'the project lists no anon/publishable key'; fi
HTTP_BODY=''   # the full list held other keys; drop it now
ANON_KIND=${sel%% *}; ANON=${sel#* }; unset sel
note "selected the $ANON_KIND key (${ANON:0:12}…)"

step 8 'verify from the outside'
if rest '/rest/v1/courts_live?select=id&limit=1' "$ANON"; then
  n=$(printf '%s' "$HTTP_BODY" | py 'len(d) if isinstance(d, list) else -1')
  [ "$n" = 1 ] || die "GET $PROJECT_URL/rest/v1/courts_live?select=id&limit=1 answered 200 with $n rows, expected 1"
  note "REST: courts_live answers 200 with 1 row for the $ANON_KIND key"
else
  die "GET $PROJECT_URL/rest/v1/courts_live answered HTTP $HTTP_STATUS: $(printf '%s' "$HTTP_BODY" | head -c 400)"
fi
count=$(sql 'select count(*) from public.courts' | py 'int(d[0]["count"]) if isinstance(d, list) and d else -1')
[ "$count" = "$SEED_ROWS" ] || die "select count(*) from public.courts = $count, expected $SEED_ROWS"
note "SQL: public.courts holds $count rows"

step 9 'config.js'
write_config "$PROJECT_URL" "$ANON"

say ''
say "DONE · project $REF · $PROJECT_URL"
say "Next: open $PAGES_URL (or: python3 -m http.server 8000 → $LOCAL_URL). The sidebar reads \"Shared data\";"
say '      a report in one browser shows in another within 5 minutes or on reload. Commit the config file: it holds'
say '      public values only. Re-running this script is safe; --check verifies without changing anything.'
