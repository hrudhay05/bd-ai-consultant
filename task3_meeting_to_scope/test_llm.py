from app import llm

try:
    out1 = llm.chat("Reply with JSON only.", 'Return {"ok": true} and nothing else.',
                    model=llm.DEFAULT_MODEL, json_mode=True, max_tokens=300, tag="smoke")
    print("call 1:", out1.strip()[:100])
    print("parsed:", llm.parse_json(out1))
    out2 = llm.chat("Reply with JSON only.", 'Return {"ok": true} and nothing else.',
                    model=llm.DEFAULT_MODEL, json_mode=True, max_tokens=300, tag="smoke")
    print("call 2 (should be cached):", out2.strip()[:100])
except llm.DailyLimitReached as e:
    print("DAILY LIMIT:", e)
except llm.LLMError as e:
    print("LLM ERROR:", e)