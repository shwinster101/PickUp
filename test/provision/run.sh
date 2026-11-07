#!/usr/bin/env bash
# Tests scripts/provision-supabase.sh against test/provision/mock-api.py (a stand-in for the Supabase
# Management API; nothing here reaches supabase.com). Asserts, in order:
#   provision: exit 0; the temp config holds the mock's URL and the anon key; GOOGLE_MAP_ID/METRO/CAPTCHA_SITE_KEY kept;
#              neither privileged key appears in stdout, stderr or the config; the token never appears;
#              the migrations ran in order exactly once and were recorded; the seed ran; pg_cron in pg_catalog
#   second run: exit 0 and nothing new applied (history-based skip)
#   --check:   exit 0 on the provisioned project; exit 1 against an empty config
#   --dry-run: exit 0 and no POST/PATCH/PUT reached the mock
# Exit 0 only when every assertion passed. Run from anywhere:  bash test/provision/run.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/opencourt-provision.XXXXXX")
MOCK_PID=''
# shellcheck disable=SC2329  # invoked by the EXIT trap below
cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

TOKEN='dummy-token-for-the-mock-only'
python3 -I "$ROOT/test/provision/mock-api.py" --token "$TOKEN" --port-file "$WORK/port" >"$WORK/mock.log" 2>&1 &
MOCK_PID=$!
for _ in $(seq 1 50); do [ -s "$WORK/port" ] && break; sleep 0.1; done
[ -s "$WORK/port" ] || { echo "mock did not start:"; cat "$WORK/mock.log"; exit 1; }
PORT=$(cat "$WORK/port")
BASE="http://127.0.0.1:$PORT"
# the mock is local: keep any proxy out of the way
export no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}" NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"

# a config.js with values the provisioner must keep
cat >"$WORK/config.js" <<'EOF'
window.OPENCOURT_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  GOOGLE_MAP_ID: 'map-id-to-keep',
  METRO: 'LA',
  CAPTCHA_SITE_KEY: 'captcha-key-to-keep'
};
EOF

export SUPABASE_ACCESS_TOKEN="$TOKEN" SUPABASE_API_URL="$BASE" SUPABASE_PROJECT_URL="$BASE" \
       SUPABASE_POLL_SECONDS=1 SUPABASE_WAIT_SECONDS=30 CONFIG_OUT="$WORK/config.js"
unset SUPABASE_ORG_SLUG SUPABASE_DB_PASSWORD SUPABASE_REGION SUPABASE_PROJECT_NAME SUPABASE_KEY_KIND SUPABASE_RESEED SUPABASE_ASSUME_APPLIED

pass=0; fail=0
ok()  { printf '  ok   %s\n' "$*"; pass=$((pass + 1)); }
bad() { printf '  FAIL %s\n' "$*"; fail=$((fail + 1)); }
assert() { # assert "label" "shell test" [file to show on failure]
  if eval "$2"; then ok "$1"; else bad "$1"; if [ -n "${3:-}" ]; then sed 's/^/     | /' "$3" | tail -40; fi; fi
}
state() { curl -sS "$BASE/__state"; }
pyq() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
run() { # run LABEL ARGS… → $WORK/LABEL.out (stdout+stderr), $WORK/LABEL.rc
  local label=$1; shift
  set +e; bash "$ROOT/scripts/provision-supabase.sh" "$@" >"$WORK/$label.out" 2>&1; echo $? >"$WORK/$label.rc"; set -e
}

echo "== provision (first run) · mock at $BASE"
run first
assert 'exit 0' "[ \"$(cat "$WORK/first.rc")\" = 0 ]" "$WORK/first.out"
REF=$(state | pyq 'next(iter(d["projects"]))')
ANON="mock-anon-key-$REF"
assert 'config holds the mock URL' "grep -q \"SUPABASE_URL: '$BASE'\" '$WORK/config.js'"
assert 'config holds the anon key' "grep -q \"SUPABASE_ANON_KEY: '$ANON'\" '$WORK/config.js'"
assert 'config kept GOOGLE_MAP_ID' "grep -q \"GOOGLE_MAP_ID: 'map-id-to-keep'\" '$WORK/config.js'"
assert 'config kept METRO' "grep -q \"METRO: 'LA'\" '$WORK/config.js'"
assert 'config kept CAPTCHA_SITE_KEY' "grep -q \"CAPTCHA_SITE_KEY: 'captcha-key-to-keep'\" '$WORK/config.js'"
assert 'config.js still parses' "{ command -v node >/dev/null 2>&1 && node --check '$WORK/config.js'; } || python3 -I -c \"import sys; t=open('$WORK/config.js').read(); sys.exit(0 if 'window.OPENCOURT_CONFIG = {' in t else 1)\""
for s in $(state | pyq '" ".join(d["secrets_to_never_see"])'); do
  assert "privileged key ${s:0:22}… absent from output" "! grep -qF '$s' '$WORK/first.out'"
  assert "privileged key ${s:0:22}… absent from config" "! grep -qF '$s' '$WORK/config.js'"
done
assert 'token absent from output' "! grep -qF '$TOKEN' '$WORK/first.out'"
assert 'token absent from config' "! grep -qF '$TOKEN' '$WORK/config.js'"
assert 'database password printed once, with the store-it line' "[ \"$(grep -c 'STORE IT' "$WORK/first.out")\" = 1 ]"
DBPASS=$(python3 -I -c "import re,sys; m=re.search(r'│\s+([A-Za-z0-9]{32})\s+│', open('$WORK/first.out').read()); print(m.group(1) if m else '')")
assert 'generated password is 32 chars' "[ \${#DBPASS} = 32 ]"
assert 'password not written to the config' "! grep -qF \"$DBPASS\" '$WORK/config.js'"
# The expected migration list is derived from supabase/migrations/ so a new numbered file never
# needs a hand edit here (the mock still enforces contiguous numbering and in-order application).
MIG_NAMES=$(ls "$(cd "$(dirname "$0")/../.." && pwd)"/supabase/migrations/*.sql | xargs -n1 basename | sed 's/\.sql$//' | sort)
MIG_COUNT=$(printf '%s\n' $MIG_NAMES | wc -l | tr -d ' ')
EXP_APPLIED=$(printf '%s\n' $MIG_NAMES | sed "s/_.*//; s/.*/'&'/" | paste -sd, - | sed 's/,/, /g')
EXP_NAMES=$(printf '%s\n' $MIG_NAMES | sed "s/.*/'&'/" | paste -sd, - | sed 's/,/, /g')
assert 'migrations ran in order exactly once, then the seed' "[ \"$(state | pyq 'd["projects"]["'"$REF"'"]["_"]["applied"]')\" = \"[$EXP_APPLIED, 'seed']\" ]"
assert 'every migration recorded under its file name' "[ \"$(state | pyq '[m["name"] for m in d["projects"]["'"$REF"'"]["_"]["migrations"]]')\" = \"[$EXP_NAMES]\" ]"
assert 'pg_cron created in pg_catalog' "[ \"$(state | pyq 'd["projects"]["'"$REF"'"]["_"]["extensions"].get("pg_cron")')\" = pg_catalog ]"
assert 'anonymous sign-ins on, email on' "[ \"$(state | pyq 'd["projects"]["'"$REF"'"]["_"]["auth"]["external_anonymous_users_enabled"] and d["projects"]["'"$REF"'"]["_"]["auth"]["external_email_enabled"]')\" = True ]"
assert 'redirect list has the Pages URL and localhost' "[ \"$(state | pyq 'd["projects"]["'"$REF"'"]["_"]["auth"]["uri_allow_list"]')\" = 'https://shwinster101.github.io/PickUp/,https://shwinster101.github.io/PickUp/**,http://localhost:8000/**' ]"
assert 'site_url set to the Pages URL' "[ \"$(state | pyq 'd["projects"]["'"$REF"'"]["_"]["auth"]["site_url"]')\" = 'https://shwinster101.github.io/PickUp/' ]"
assert 'project created in us-west-1' "[ \"$(state | pyq 'd["projects"]["'"$REF"'"]["region"]')\" = us-west-1 ]"
assert 'waited through two COMING_UP polls' "[ \"$(grep -c 'waiting · project COMING_UP' "$WORK/first.out")\" = 2 ]"
assert 'REST verified with the anon key' "grep -q 'courts_live answers 200 with 1 row' '$WORK/first.out'"

echo "== provision (second run: reuse, apply nothing new)"
run second
assert 'exit 0' "[ \"$(cat "$WORK/second.rc")\" = 0 ]" "$WORK/second.out"
assert 'reused the project' "grep -q \"reuse: 'pickup' exists as $REF\" '$WORK/second.out'"
assert 'no new password generated' "! grep -q 'STORE IT' '$WORK/second.out'"
assert 'applied nothing new' "grep -q 'applied 0 migration file(s) this run' '$WORK/second.out' && [ \"$(state | pyq 'len(d["projects"]["'"$REF"'"]["_"]["applied"])')\" = $((MIG_COUNT + 1)) ]"
assert 'history still one record per migration' "[ \"$(state | pyq 'len(d["projects"]["'"$REF"'"]["_"]["migrations"])')\" = $MIG_COUNT ]"
assert 'auth already as needed' "grep -q 'already as needed' '$WORK/second.out'"
assert 'config unchanged in substance' "grep -q \"SUPABASE_ANON_KEY: '$ANON'\" '$WORK/config.js' && grep -q \"GOOGLE_MAP_ID: 'map-id-to-keep'\" '$WORK/config.js'"

echo "== --check"
run check --check
assert 'exit 0' "[ \"$(cat "$WORK/check.rc")\" = 0 ]" "$WORK/check.out"
assert 'CHECK PASSED with no MISS' "grep -q 'CHECK PASSED' '$WORK/check.out' && ! grep -q 'MISS' '$WORK/check.out'"
printf "window.OPENCOURT_CONFIG = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', GOOGLE_MAP_ID: '', METRO: 'LA' };\n" >"$WORK/empty.js"
CONFIG_OUT="$WORK/empty.js" run check-empty --check
assert 'exit 1 against an empty config' "[ \"$(cat "$WORK/check-empty.rc")\" = 1 ] && grep -q 'CHECK FAILED' '$WORK/check-empty.out'"

echo "== --dry-run"
before=$(state | pyq 'len(d["log"])')
run dry --dry-run
assert 'exit 0' "[ \"$(cat "$WORK/dry.rc")\" = 0 ]" "$WORK/dry.out"
writes=$(state | pyq '[e["method"] + " " + e["path"] for e in d["log"]['"$before"':] if e["method"] != "GET"]')
assert 'no POST/PATCH/PUT reached the mock' "[ \"$writes\" = '[]' ]"; [ "$writes" = '[]' ] || echo "     | $writes"
assert 'plan printed the skip of recorded migrations' "grep -q 'skip  0001_courts_and_reports (recorded)' '$WORK/dry.out'"
assert 'DRY RUN DONE' "grep -q 'DRY RUN DONE' '$WORK/dry.out'"

echo "== failure path: wrong token"
SUPABASE_ACCESS_TOKEN=wrong run wrong
assert 'exit non-zero and names the step' "[ \"$(cat "$WORK/wrong.rc")\" != 0 ] && grep -q 'FAILED at step 1 (organisation)' '$WORK/wrong.out' && grep -q 'HTTP 401' '$WORK/wrong.out'"
assert 'the wrong token is not echoed either' "! grep -q 'Bearer' '$WORK/wrong.out'"

echo
if [ "$fail" = 0 ]; then echo "PROVISION TESTS PASSED ($pass assertions)"; exit 0; fi
echo "PROVISION TESTS FAILED ($fail of $((pass + fail)))"; exit 1
