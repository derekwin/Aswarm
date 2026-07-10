#!/bin/bash
# AgentSwarm API Test Suite
# Verifies all backend endpoints work correctly
set -e

BASE="http://localhost:8000"
WORKER="http://127.0.0.1:8001"
PASS=0; FAIL=0

check() {
  local desc="$1"; local expected="$2"; local actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✅ $desc"; PASS=$((PASS+1))
  else
    echo "  ❌ $desc (expected $expected, got $actual)"; FAIL=$((FAIL+1))
  fi
}

echo "=== AgentSwarm API Tests ==="
echo ""

# 1. Health
echo "1. Health Checks"
check "Next.js health" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/conversations)"
check "Python worker health" '{"status":"ok"}' "$(curl -s $WORKER/health)"

# 2. Conversations
echo "2. Conversations"
CID=$(curl -s -X POST $BASE/api/conversations -H "Content-Type: application/json" -d '{"title":"API Test"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
check "Create conversation" "conv_" "$(echo $CID | cut -c1-5)"

LIST=$(curl -s $BASE/api/conversations)
check "List conversations (includes new)" "$CID" "$(echo $LIST | python3 -c "import sys,json;ids=[c['id'] for c in json.load(sys.stdin)];print('$CID' if '$CID' in ids else 'MISSING')")"

DETAIL=$(curl -s $BASE/api/conversations/$CID)
check "Get conversation" "$CID" "$(echo $DETAIL | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")"
check "Conversation has messages" "list" "$(echo $DETAIL | python3 -c "import sys,json;print(type(json.load(sys.stdin)['messages']).__name__)")"

# 3. Tasks
echo "3. Tasks"
TASK=$(curl -s -X POST $BASE/api/tasks -H "Content-Type: application/json" -d "{\"query\":\"test query\",\"convId\":\"$CID\"}")
TID=$(echo $TASK | python3 -c "import sys,json;print(json.load(sys.stdin)['taskId'])")
check "Submit task" "task_" "$(echo $TID | cut -c1-5)"

# Check SSE events arrive
EVENTS=$(timeout 5 curl -s -N "$WORKER/events/$TID" 2>&1 | head -c 50 || true)
check "SSE events streaming" "data:" "$(echo $EVENTS | cut -c1-5)"

# 4. Cancel
echo "4. Cancel"
CANCEL=$(curl -s -X POST "$BASE/api/tasks/$TID/cancel")
check "Cancel task" '{"ok":true}' "$CANCEL"

# 5. Settings
echo "5. Settings"
SET=$(curl -s -X PUT $BASE/api/settings -H "Content-Type: application/json" -d '{"test_key":"test_value"}')
check "Write settings" '{"ok":true}' "$SET"
READ=$(curl -s $BASE/api/settings)
check "Read settings" "test_value" "$(echo $READ | python3 -c "import sys,json;print(json.load(sys.stdin).get('test_key',''))")"

# 6. Delete
echo "6. Delete"
DEL=$(curl -s -X DELETE "$BASE/api/conversations/$CID" -w "\n%{http_code}")
check "Delete conversation" "200" "$(echo "$DEL" | tail -1)"

# 7. Workspace
echo "7. Workspace"
WS=$(curl -s "$WORKER/workspace/nonexistent")
check "Workspace list (empty)" '{"files":[]' "$(echo $WS | cut -c1-11)"

# Summary
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && echo "All tests passed!" || echo "Some tests failed."
exit $FAIL
