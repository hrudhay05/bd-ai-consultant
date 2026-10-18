from app.kb_client import query_kb

for q in ["How do refunds work?", "asdf qwerty zzzz blorp", "hi"]:
    r = query_kb(q)
    print("Q:", q)
    print("  outcome:", r.outcome, "| sources:", len(r.sources), "| dropped_changelog:", r.dropped_changelog, "| latency_ms:", r.latency_ms)
    print("  answer:", r.answer[:150].replace("\n", " "))
    print("  detail:", r.detail, "| reason:", r.reason)
