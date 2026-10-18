import tempfile
from pathlib import Path
from app import store
from app.models import ScopeVersion

tmp = Path(tempfile.mkdtemp()) / "t.db"
store.init_db(tmp)
store.create_project("P1", "Test project", tmp)

def expect_fail(fn, exc, label):
    try:
        fn()
    except exc as e:
        print("PASS", label, "->", type(e).__name__)
        return
    print("FAIL", label, "(no error raised)")

v1 = store.save_version(ScopeVersion(project_id="P1", version=0, scope_text="v1"), tmp)
expect_fail(lambda: store.simulate_send("P1", v1, tmp), store.SendBlocked, "send draft blocked")
expect_fail(lambda: store.review("P1", v1, "Alice", "approved", "", tmp), store.InvalidTransition, "approve a draft blocked")
store.submit_for_approval("P1", v1, tmp)
expect_fail(lambda: store.simulate_send("P1", v1, tmp), store.SendBlocked, "send pending blocked")
expect_fail(lambda: store.review("P1", v1, "  ", "approved", "", tmp), ValueError, "empty reviewer blocked")
store.review("P1", v1, "Alice", "approved", "ok", tmp)
print("PASS send approved at", store.simulate_send("P1", v1, tmp))

v2 = store.save_version(ScopeVersion(project_id="P1", version=0, scope_text="v2", based_on_version=v1), tmp)
expect_fail(lambda: store.simulate_send("P1", v2, tmp), store.SendBlocked, "send unapproved revision blocked")
print("baseline is still version", store.latest_approved("P1", tmp).version)
store.submit_for_approval("P1", v2, tmp)
store.review("P1", v2, "Alice", "approved", "", tmp)
print("versions:", [(x["version"], x["state"]) for x in store.list_versions("P1", tmp)])
print("audit rows:", len(store.audit_trail("P1", tmp)))