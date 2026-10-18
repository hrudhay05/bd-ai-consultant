import re
import json
import sys
from pathlib import Path

from app.transcript import load_transcript

ROOT = Path(__file__).resolve().parent.parent

STOP = {"a", "an", "the", "to", "of", "for", "and", "or", "on", "in", "by", "be", "is", "are", "that",
        "with", "add", "allow", "customers", "users", "members", "option", "as", "it", "we", "our"}
VAGUE = {"improve", "improved", "improvement", "better", "faster", "feel", "experience", "nicer"}


def _stem(w: str) -> str:
    if w.startswith("mis") and len(w) > 6:
        w = w[3:]
    if w.endswith("s") and len(w) > 4:
        w = w[:-1]
    return w


def _tokens(s: str) -> set:
    words = re.findall(r"[a-z0-9]+", s.lower())
    return {_stem(w) for w in words if w not in STOP}


def _consultant_only(req: dict, consultants: set) -> bool:
    ev = req.get("evidence", [])
    return bool(ev) and all(e["speaker"].lower() in consultants for e in ev)


def _merge_consultant_repeats(reqs: list, consultants: set, notes: list):
    backed = [r for r in reqs if not _consultant_only(r, consultants)]
    keep, merged = [], []
    for r in reqs:
        if not _consultant_only(r, consultants):
            keep.append(r)
            continue
        rt = _tokens(r["description"])
        best, best_score = None, 0.0
        for b in backed:
            bt = _tokens(b["description"] + " " + " ".join(b.get("dependencies", [])))
            ov = len(rt & bt)
            if ov < 2:
                continue
            score = ov / min(len(rt), len(bt))
            if score > best_score:
                best, best_score = b, score
        if best is not None and best_score >= 0.5:
            for e in r["evidence"]:
                if e not in best["evidence"]:
                    best["evidence"].append(e)
            for d in r.get("dependencies", []):
                if d not in best["dependencies"]:
                    best["dependencies"].append(d)
            merged.append({"from": r["req_id"], "into": best["req_id"], "score": round(best_score, 2)})
            notes.append(r["req_id"] + " merged into " + best["req_id"] + " (consultant words only).")
        else:
            keep.append(r)
    return keep, merged


def _downgrade_vague(reqs: list, notes: list) -> list:
    flagged = []
    for r in reqs:
        text = r["description"].lower()
        words = set(re.findall(r"[a-z]+", text))
        has_digit = bool(re.search(r"\d", text)) or any(re.search(r"\d", e["quote"]) for e in r["evidence"])
        if (words & VAGUE) and not has_digit and r["status"] == "confirmed":
            r["status"] = "unclear"
            flagged.append(r["req_id"])
            notes.append(r["req_id"] + " has vague wording and no number. Set to unclear.")
    return flagged


def _uncited_client_lines(res: dict, consultants: set) -> list:
    path = Path(res["source_file"])
    if not path.exists():
        path = ROOT / res["source_file"]
    t = load_transcript(str(path))
    cited = set()
    for r in res["requirements"]:
        for e in r["evidence"]:
            cited.add(e["timestamp"])
    for key in ("constraints", "open_questions", "client_commitments"):
        for it in res.get(key, []):
            cited.add(it["timestamp"])
    out = []
    for turn in t["turns"]:
        if turn["speaker"].lower() in consultants:
            continue
        if turn["timestamp"] in cited:
            continue
        if len(turn["text"].split()) < 7:
            continue
        out.append({"timestamp": turn["timestamp"], "speaker": turn["speaker"], "text": turn["text"]})
    return out


def clean(res: dict) -> dict:
    res = json.loads(json.dumps(res))
    consultants = set(res.get("consultants", []))
    notes = []
    reqs, merged = _merge_consultant_repeats(res["requirements"], consultants, notes)
    res["requirements"] = reqs
    res["merged_requirements"] = merged
    res["vague_downgraded"] = _downgrade_vague(reqs, notes)
    res["cleanup_notes"] = notes
    res["uncited_client_lines"] = _uncited_client_lines(res, consultants)
    return res


def show(out: dict) -> None:
    print("complete:", out["complete"], "| requirements after cleanup:", len(out["requirements"]))
    for r in out["requirements"]:
        ev = r["evidence"][0]
        deps = "; ".join(r["dependencies"])
        print(" ", r["req_id"], "|", r["priority"], "|", r["status"], "|", r["origin"], "|",
              "evidence:", len(r["evidence"]), "|", ev["timestamp"], ev["speaker"], "|", r["description"],
              ("| DEPS: " + deps) if deps else "")
    print("MERGED:", out["merged_requirements"])
    print("VAGUE DOWNGRADED:", out["vague_downgraded"])
    print("CLIENT LINES NOT CITED BY ANY ITEM:", len(out["uncited_client_lines"]))
    for u in out["uncited_client_lines"]:
        print(" ", u["timestamp"], u["speaker"], "|", u["text"])


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m app.cleanup results\\<extract file>.json")
        sys.exit(1)
    src = Path(sys.argv[1])
    data = json.loads(src.read_text(encoding="utf-8"))
    result = clean(data)
    dest = src.with_name(src.stem + "_clean.json")
    dest.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    show(result)
    print("saved:", dest)