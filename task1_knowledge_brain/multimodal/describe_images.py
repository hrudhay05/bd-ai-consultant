import os, json, sys, time
import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
MANIFEST = "data/manifest.json"
CACHE = "data/image_cache.json"
HEADERS = {"User-Agent": "CapstoneBot/1.0 (student project)"}
MODEL = os.getenv("VISION_MODEL", "gemini-2.5-flash")
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

PROMPT = ("This is a screenshot from the help article '{title}'. In 1-3 sentences, list the "
          "visible UI labels, buttons, menu names, and setting names/values that matter for "
          "following the instructions. Quote text exactly as shown. If text is unreadable, "
          "say 'unclear' instead of guessing. If the image is purely decorative (logo, icon, "
          "avatar), reply exactly: DECORATIVE")

def load(p, default):
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else default

if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 40   # new images per run
    manifest, cache = load(MANIFEST, {}), load(CACHE, {})
    done = 0
    for rec in manifest.values():
        if rec.get("status") != "done" or not os.path.exists(rec.get("file", "")):
            continue
        art = json.load(open(rec["file"], encoding="utf-8"))
        for img in art["images"]:
            src = img["src"]
            if done >= limit:
                break
            if src in cache or src.startswith("data:") or src.lower().endswith(".svg"):
                continue
            try:
                r = requests.get(src, headers=HEADERS, timeout=30)
                ctype = r.headers.get("content-type", "").split(";")[0]
                if r.status_code != 200 or not ctype.startswith("image/") \
                   or "svg" in ctype or len(r.content) > 4_000_000:
                    cache[src] = {"description": "", "decorative": True, "skipped": f"{r.status_code} {ctype}"}
                else:
                    resp = client.models.generate_content(
                        model=MODEL,
                        contents=[types.Part.from_bytes(data=r.content, mime_type=ctype),
                                  PROMPT.format(title=art["title"])])
                    text = (resp.text or "").strip()
                    cache[src] = {"description": text,
                                  "decorative": text.upper().startswith("DECORATIVE"),
                                  "article": art["url"]}
                    print(f"described: {text[:90]}")
                    done += 1
                    time.sleep(5)             # stay under free-tier rate limits
            except Exception as e:
                print(f"FAILED {src[:70]}: {str(e)[:120]}")
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    print("Daily quota reached. Run again tomorrow; cached images are kept.")
                    json.dump(cache, open(CACHE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
                    sys.exit(0)
                time.sleep(10)
            json.dump(cache, open(CACHE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"New descriptions this run: {done}. Cache size: {len(cache)}")