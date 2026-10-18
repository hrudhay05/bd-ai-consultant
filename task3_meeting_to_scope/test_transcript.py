from app.transcript import load_transcript, make_chunks, verify_quote, find_quote_anywhere

for f in ["meeting_A_2026-10-12.txt", "meeting_B_2026-10-14.txt", "meeting_C_2026-10-26.txt"]:
    t = load_transcript("transcripts/" + f)
    ch = make_chunks(t["header"].get("Meeting ID", "?"), t["turns"])
    print(f, "| file lines:", t["line_count"], "| turns:", len(t["turns"]), "| chunks:", len(ch),
          "| header keys:", list(t["header"].keys()))
    for c in ch:
        print("   ", c.chunk_id, "lines", c.start_line, "-", c.end_line)

tA = load_transcript("transcripts/meeting_A_2026-10-12.txt")["turns"]
print("real quote  :", verify_quote(tA, "00:09:38", "budget is 2,500 US dollars"))
print("fake quote  :", verify_quote(tA, "00:09:38", "budget is 9,000 US dollars"))
print("wrong time  :", verify_quote(tA, "00:00:05", "budget is 2,500 US dollars"))
print("anywhere    :", find_quote_anywhere(tA, "budget is 2,500 US dollars")["timestamp"])
print("short quote :", verify_quote(tA, "00:09:38", "budget"))