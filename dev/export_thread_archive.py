# mavis: exports a local MiniMax Code session transcript (messages.jsonl) into readable
# markdown, so a thread is never lost to a provider outage or compaction failure.
import json, os, sys, datetime

import re

BLOCKS = re.compile(r"<(system-reminder|plugin-hook-context|memory-skill-reminder|proactive-memory|async-audit|mcode-tools-master-reminder|media-output-reminder)[^>]*>.*?</\1>", re.S)

def clean(t):
    if not isinstance(t, str):
        return t
    return BLOCKS.sub("", t).strip()

def load(path):
    recs = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                recs.append(json.loads(line))
            except Exception:
                continue
    return recs

def text_of(m):
    if not isinstance(m, dict):
        return ""
    c = m.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = []
        for b in c:
            if isinstance(b, dict) and b.get("type") == "text":
                parts.append(b.get("text", ""))
            elif isinstance(b, str):
                parts.append(b)
        return "\n".join(parts)
    return ""

def stamp(ms):
    if not ms:
        return ""
    try:
        return datetime.datetime.fromtimestamp(ms/1000).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""

def main(src, out_archive, out_digest):
    recs = load(src)
    blocks = []
    summaries = []
    for r in recs:
        m = r.get("message") or {}
        role = m.get("role")
        ts = r.get("timestamp") or m.get("timestamp") or 0
        if role == "compactionSummary":
            s = m.get("summary", "")
            summaries.append((ts, s))
            blocks.append(("SUMMARY", ts, s))
        elif role == "user":
            t = text_of(m)
            t = clean(t)
            if t.strip():
                blocks.append(("USER", ts, t))
        elif role == "assistant":
            t = text_of(m)
            tc = m.get("tool_calls") or []
            if t.strip():
                blocks.append(("ASSISTANT", ts, t))
            for c in tc:
                cn = c.get("tool_name") or c.get("name") or "tool"
                blocks.append(("TOOL:" + cn, ts, ""))
    with open(out_archive, "w", encoding="utf-8") as f:
        f.write("# Session transcript archive\n\n")
        f.write("Source: " + os.path.basename(src) + "\n")
        f.write("Records: %d | Human-readable entries: %d\n\n" % (len(recs), len(blocks)))
        for kind, ts, t in blocks:
            if kind.startswith("TOOL:"):
                f.write("\n<!-- %s %s -->\n" % (kind, stamp(ts)))
                continue
            label = {"USER": "Dave (user)", "ASSISTANT": "Assistant", "SUMMARY": "--- COMPACTION SUMMARY ---"}.get(kind, kind)
            f.write("\n## %s  %s\n\n%s\n" % (label, stamp(ts), t))
    last_sum = summaries[-1][1] if summaries else ""
    with open(out_digest, "w", encoding="utf-8") as f:
        f.write("# Fantasy Grinder - recovery digest\n\n")
        f.write("Regenerated from the on-disk transcript. Nothing here is a reconstruction from memory;\n")
        f.write("it is the thread's own content.\n\n")
        f.write("## 1. Last successful compaction summary (the thread's own state snapshot)\n\n")
        f.write(last_sum if last_sum else "(none recorded)\n\n")
        f.write("## 2. Everything after that snapshot\n\n")
        cut = None
        for i, (kind, ts, t) in enumerate(blocks):
            if kind == "SUMMARY":
                cut = i
        start = (cut + 1) if cut is not None else 0
        for kind, ts, t in blocks[start:]:
            if kind.startswith("TOOL:"):
                continue
            label = {"USER": "Dave (user)", "ASSISTANT": "Assistant"}.get(kind, kind)
            f.write("\n### %s  %s\n\n%s\n" % (label, stamp(ts), t))
    print("archive:", out_archive, os.path.getsize(out_archive))
    print("digest:", out_digest, os.path.getsize(out_digest))
    print("entries:", len(blocks), "summaries:", len(summaries))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
