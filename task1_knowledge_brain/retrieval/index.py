import os, json, re, sys, hashlib
import chromadb
from sentence_transformers import SentenceTransformer

MANIFEST = "data/manifest.json"
IMG_CACHE = "data/image_cache.json"
DB_PATH = "data/chroma"
MAX_CHARS = 1200
OVERLAP = 150
MARKER = re.compile(r"\[IMAGE: (.*?) \| alt: (.*?)\]")

model = SentenceTransformer("all-MiniLM-L6-v2")
model.max_seq_length = 512
client = chromadb.PersistentClient(path=DB_PATH)
col = client.get_or_create_collection("articles", metadata={"hnsw:space": "cosine"})


def split_sections(text):
    sections, heading, buf = [], "Introduction", []
    for line in text.split("\n"):
        if line.startswith("## "):
            if "".join(buf).strip():
                sections.append((heading, "\n".join(buf).strip()))
            heading, buf = line[3:].strip(), []
        else:
            buf.append(line)
    if "".join(buf).strip():
        sections.append((heading, "\n".join(buf).strip()))
    return sections


def chunk_body(body):
    if len(body) <= MAX_CHARS:
        return [body]
    chunks, cur = [], ""
    for line in body.split("\n"):
        if len(cur) + len(line) > MAX_CHARS and cur:
            chunks.append(cur.strip())
            cur = cur[-OVERLAP:] + "\n"
        cur += line + "\n"
    if cur.strip():
        chunks.append(cur.strip())
    return chunks


def render_images(piece, cache):
    def sub(m):
        url, alt = m.group(1), m.group(2)
        d = cache.get(url)
        if d and d.get("description") and not d.get("decorative"):
            clean = d["description"].replace("**", "").replace("`", "")
            return f"[Screenshot: {clean}]"
        return f"[Image: {alt}]" if alt else ""
    return MARKER.sub(sub, piece)


def signature(art, cache):
    descs = [cache.get(i["src"], {}).get("description", "") for i in art["images"]]
    return hashlib.sha256((art["content_hash"] + "|".join(descs)).encode()).hexdigest()


def index_article(path, cache):
    art = json.load(open(path, encoding="utf-8"))
    base = os.path.basename(path)[:-5]
    col.delete(where={"url": art["url"]})          # idempotent: replace old chunks

    docs, ids, metas, n = [], [], [], 0
    for heading, body in split_sections(art["text"]):
        for piece in chunk_body(body):
            images = re.findall(r"\[IMAGE: (.*?) \|", piece)
            text = render_images(piece, cache).strip()
            if not text:
                continue
            docs.append(f"{art['title']} > {heading}\n{text}")
            ids.append(f"{base}-{n}")
            metas.append({"url": art["url"], "title": art["title"], "section": heading,
                          "images": json.dumps(images), "content_hash": art["content_hash"]})
            n += 1
    if docs:
        emb = model.encode(docs, normalize_embeddings=True).tolist()
        col.add(ids=ids, documents=docs, embeddings=emb, metadatas=metas)
    return n


if __name__ == "__main__":
    force = "--force" in sys.argv
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    cache = json.load(open(IMG_CACHE, encoding="utf-8")) if os.path.exists(IMG_CACHE) else {}

    for url, rec in manifest.items():
        if rec.get("status") == "removed":
            col.delete(where={"url": url})
            f = rec.get("file")
            if f and os.path.exists(f):
                os.remove(f)
            rec.pop("index_sig", None)
            print(f"deactivated: {url}")

    indexed = skipped = 0
    for url, rec in manifest.items():
        if rec.get("status") != "done":
            continue
        path = rec.get("file")
        if not path or not os.path.exists(path):
            continue
        art = json.load(open(path, encoding="utf-8"))
        sig = signature(art, cache)
        if rec.get("index_sig") == sig and not force:
            skipped += 1
            continue
        n = index_article(path, cache)
        rec["index_sig"] = sig
        indexed += 1
        print(f"{n:3d} chunks  {os.path.basename(path)[:70]}")
        json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), indent=2)

    json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), indent=2)
    print(f"\nRe-indexed {indexed}, unchanged {skipped}. Collection size: {col.count()}")