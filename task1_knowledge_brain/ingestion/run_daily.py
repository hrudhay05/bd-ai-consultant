import os, sys, json, shutil, subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)                       # so relative data/ paths work from any launcher
MANIFEST = Path("data/manifest.json")

def snapshot():
    if not MANIFEST.exists():
        return {}
    return {u: (r.get("status"), r.get("content_hash"))
            for u, r in json.loads(MANIFEST.read_text(encoding="utf-8")).items()}

if __name__ == "__main__":
    if MANIFEST.exists():
        shutil.copy(MANIFEST, "data/manifest.backup.json")     # rollback point
    before = snapshot()
    codes = {}
    for name, args in [("crawl", ["src/crawl.py"]),
                       ("images", ["src/describe_images.py", "40"]),
                       ("index", ["src/index.py"])]:
        codes[name] = subprocess.run([sys.executable] + args).returncode
    after = snapshot()

    report = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "added": [u for u, (s, h) in after.items() if s == "done" and before.get(u, (None,))[0] != "done"],
        "updated": [u for u, (s, h) in after.items()
                    if s == "done" and before.get(u, (None, None))[0] == "done" and before[u][1] != h],
        "removed": [u for u, (s, h) in after.items() if s == "removed" and before.get(u, (None,))[0] != "removed"],
        "failed": [u for u, (s, h) in after.items() if (s or "").startswith("failed")],
        "exit_codes": codes,
    }
    Path("data/reports").mkdir(exist_ok=True)
    out = Path(f"data/reports/{datetime.now():%Y-%m-%d}.json")
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nREPORT: added={len(report['added'])} updated={len(report['updated'])} "
          f"removed={len(report['removed'])} failed={len(report['failed'])}  -> {out}")