import chromadb
col = chromadb.PersistentClient(path="data/chroma").get_collection("articles")
r = col.get(include=["documents", "metadatas"])
hits = [(m["title"], d) for d, m in zip(r["documents"], r["metadatas"]) if "[Screenshot:" in d]
print(f"Chunks containing screenshot text: {len(hits)} of {len(r['documents'])}")
for title, d in hits:
    if "Conflicting" in d:
        print("\nFOUND 'Conflicting' in:", title)
        print(d[-400:])