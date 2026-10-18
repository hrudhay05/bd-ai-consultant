import os, json, hashlib, time, re, sys
from datetime import datetime, timezone
from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()
SITEMAP_URL = os.getenv("SITEMAP_URL")
OUT_DIR = "data/articles"
MANIFEST = "data/manifest.json"
DELAY = float(os.getenv("CRAWL_DELAY", "1.0"))
HEADERS = {"User-Agent": "CapstoneBot/1.0 (student project)"}
os.makedirs(OUT_DIR, exist_ok=True)


class PermanentError(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


# ---------- robots.txt ----------
def load_robots(sitemap_url):
    base = "/".join(sitemap_url.split("/")[:3])
    rp = RobotFileParser()
    try:
        rp.set_url(base + "/robots.txt")
        rp.read()
    except Exception:
        return None
    return rp


# ---------- http with retries ----------
def fetch(url, max_attempts=3):
    for attempt in range(1, max_attempts + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            if r.status_code in (404, 403, 410):
                raise PermanentError(f"HTTP {r.status_code}")
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.RequestException(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r.text
        except PermanentError:
            raise
        except requests.RequestException as e:
            if attempt == max_attempts:
                raise
            wait = 2 ** attempt
            print(f"   retry {attempt} in {wait}s ({e})")
            time.sleep(wait)


# ---------- sitemap ----------
def get_entries(sitemap_url):
    """Return list of (url, lastmod), following nested sitemaps."""
    soup = BeautifulSoup(fetch(sitemap_url), "xml")
    entries = []
    for sm in soup.find_all("sitemap"):
        entries += get_entries(sm.find("loc").text.strip())
    for u in soup.find_all("url"):
        loc = u.find("loc").text.strip()
        lm = u.find("lastmod")
        entries.append((loc, lm.text.strip() if lm else None))
    return entries


# ---------- parsing ----------
def extract_article(url, html):
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else ""
    main = soup.find("article") or soup.find("main") or soup.body

    parts, images = [], []
    for el in main.find_all(["h1", "h2", "h3", "p", "li", "table", "img"]):
        if el.name == "img":
            src = el.get("src")
            if src:
                full = urljoin(url, src)
                images.append({"src": full, "alt": el.get("alt", "")})
                parts.append(f"[IMAGE: {full} | alt: {el.get('alt', '')}]")
            continue
        text = el.get_text(" ", strip=True)
        if not text:
            continue
        parts.append(f"\n## {text}" if el.name in ("h1", "h2", "h3") else text)

    text = "\n".join(parts)
    return {
        "url": url,
        "title": title,
        "text": text,
        "images": images,
        "content_hash": hashlib.sha256(text.encode()).hexdigest(),
        "ingested_at": now(),
    }


def slug(url):
    return re.sub(r"[^a-z0-9]+", "-", url.lower()).strip("-")[-120:]


# ---------- manifest ----------
def load_manifest():
    if os.path.exists(MANIFEST):
        return json.load(open(MANIFEST, encoding="utf-8"))
    return {}


def save_manifest(m):
    json.dump(m, open(MANIFEST, "w", encoding="utf-8"), indent=2)


# ---------- main ----------
if __name__ == "__main__":
    if not SITEMAP_URL:
        sys.exit("SITEMAP_URL is not set. Check your .env file.")

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None  # python src/crawl.py 15
    robots = load_robots(SITEMAP_URL)
    manifest = load_manifest()

    seen, entries = set(), []
    for url, lm in get_entries(SITEMAP_URL):
        if "/solutions/articles/" not in url:     # skip folder/category pages
            continue
        if url not in seen:
            seen.add(url)
            entries.append((url, lm))

    # mark removed pages
    for url, rec in manifest.items():
        if url not in seen and rec["status"] != "removed":
            rec["status"] = "removed"
            print(f"removed: {url}")

    stats = {"new": 0, "updated": 0, "unchanged": 0, "failed": 0, "skipped": 0}
    processed = 0
    for url, lastmod in entries:
        if limit and processed >= limit:
            break
        rec = manifest.get(url)
        if rec and rec["status"] == "done" and rec.get("lastmod") == lastmod:
            stats["unchanged"] += 1
            continue
        if rec and rec["status"] == "failed_permanent":
            stats["skipped"] += 1
            continue
        if robots and not robots.can_fetch(HEADERS["User-Agent"], url):
            manifest[url] = {"status": "blocked_by_robots", "lastmod": lastmod}
            stats["skipped"] += 1
            continue

        is_new = rec is None
        rec = rec or {"attempts": 0}
        rec["attempts"] += 1
        rec["lastmod"] = lastmod
        try:
            html = fetch(url)
            art = extract_article(url, html)
            if len(art["text"]) < 200:
                rec["status"] = "skipped_empty"
                stats["skipped"] += 1
            else:
                path = f"{OUT_DIR}/{slug(url)}.json"
                json.dump(art, open(path, "w", encoding="utf-8"),
                          ensure_ascii=False, indent=2)
                rec.update(status="done", file=path,
                           content_hash=art["content_hash"], updated_at=now())
                stats["new" if is_new else "updated"] += 1
                print(f"saved: {art['title'][:60]}")
        except PermanentError as e:
            rec.update(status="failed_permanent", error=str(e))
            stats["failed"] += 1
        except Exception as e:
            rec.update(status="failed", error=str(e))
            stats["failed"] += 1
            print(f"FAILED {url}: {e}")

        manifest[url] = rec
        save_manifest(manifest)  # checkpoint after every page
        processed += 1
        time.sleep(DELAY)

    save_manifest(manifest)
    print("\nSummary:", stats)