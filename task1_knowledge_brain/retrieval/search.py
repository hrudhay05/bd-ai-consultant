import sys, json
import chromadb
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")
model.max_seq_length = 512
col = chromadb.PersistentClient(path="data/chroma").get_collection("articles")

def search(query, k=5):
    emb = model.encode([query], normalize_embeddings=True).tolist()
    r = col.query(query_embeddings=emb, n_results=k)
    out = []
    for doc, meta, dist in zip(r["documents"][0], r["metadatas"][0], r["distances"][0]):
        out.append({
            "score": round(1 - dist, 3),       # cosine similarity
            "title": meta["title"],
            "section": meta["section"],
            "url": meta["url"],
            "images": json.loads(meta["images"]),
            "text": doc,
        })
    return out

if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "How do I change my website logo?"
    for h in search(q):
        print(f"{h['score']}  {h['title']} > {h['section']}\n   {h['url']}\n")