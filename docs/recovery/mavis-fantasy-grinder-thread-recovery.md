# Fantasy Grinder - thread recovery record

Written by Mavis, 2026-11-07, after Dave reported the thread had "died".

## What actually happened (nothing was deleted)

The thread was not lost. It was wedged.

Both Fantasy Grinder sessions were pinned to a BYOK provider:

    provider id : custom_provider:amd
    name        : AMD
    baseURL     : https://developer.amd.com.cn/radeon/api/v1
    models      : DeepSeek-V4-Flash, GLM-5.3-Flash, ...

That provider started rejecting the stored credential:

    HTTP 401 Unauthorized
    {"detail":"Invalid bearer token"}

The key is still present in `C:\Users\D\.minimax\config.yaml` (provider block `amd:`, `options.apiKey`,
51 chars) but the upstream calls it invalid.

The damage was not the failed reply - it was the **compaction**. Every context
compaction / checkpoint for a session is issued through the session's own model
provider. With the provider returning 401, compaction could never run:

    compaction_failed: "This operation was aborted"
    compaction_failed: "Checkpoint Provider request failed after one retry."
    compaction_failed: "Checkpoint Provider request failed after one retry."

So the context could not be compacted, the session could not accept a new turn, and
Dave's messages were left unanswered:

- session `mvs_354a02ed537e467fa790d76b9c6dd62c` ("Locate fantasygrinder project folder")
  ended on Dave's message **"fix"** with no reply.
- session `mvs_7ac968d537334b5d9d587015fbfd2c3b` ("mavis fantasygrinder project folder",
  the pinned fork) ended on Dave's message **"contiinue"** with no reply.

The full transcripts were on disk the whole time:

    C:\Users\D\.minimax\v2\sessions\2026\11\01\00-58-56-012-session_bXZzXzM1NGEwMmVkNTM3ZTQ2N2ZhNzkwZDc2YjljNmRkNjJj\messages.jsonl
    C:\Users\D\.minimax\v2\sessions\2026\11\07\09-31-50-252-session_bXZzXzdhYzk2OGQ1MzczMzRiNWQ5ZDU4NzAxNWZiZmQyYzNi\messages.jsonl

## What was changed

| # | Symptom | Cause | Change |
|---|---------|-------|--------|
| 1 | Thread cannot accept a turn; every reply dies | Session model = `custom_provider:amd`, upstream 401 | Both sessions repointed to `minimax/MiniMax-M3.1-Flash` via session update |
| 2 | Context can never be compacted | Compaction/checkpoint calls route through the same dead provider | Same fix - compaction now goes through minimax |
| 3 | Thread history only existed inside a wedged session | No external copy | Transcripts exported to markdown (below) |
| 4 | Both threads woke at once on the same checkout | The provider fix released two queued turns simultaneously | The original thread parked; the pinned fork owns the repo |

After the repoint, **both** queued turns resumed on their own - the fix was enough
on its own; no session recreation was needed. The fork picked up "contiinue", committed
the refined logo and favicon (`508b596`), pushed it, and watched CI go green. The
original picked up "fix" and started the ownership/salary audit.

## The collision that had to be settled

Both revived threads were running turns against the **same working tree**
(`C:\Users\D\mavis-fantasy-grinder`, branch `main`), and the fork was already
force-pushing. Two agents committing one checkout clobber each other and leave Dave
guessing which thread did what.

Decision: **the pinned fork owns the repository.** The original thread
(`mvs_354a02ed...`) was told to finish nothing new, leave the tree clean, and
hand over a defect map instead of edits. Its handover is already captured in the
thread, and it stays one message away from being revived.

The rebuild-backtest worker (`bg_cce5f437...`, child of the original) was fenced
rather than killed: no git mutations at all, scope limited to three files
(`frontend/react/scripts/mavis-accuracy-history.mjs`, `docs/mavis-accuracy-history.md`,
`frontend/react/.tmp-audit/mavis-accuracy-history.json`), and it must leave its work
uncommitted for the fork to review and commit.

## State at the time of writing

- Repo: `main` at `508b596`, clean, identical to `origin/main` (0 ahead / 0 behind).
- CI: green on the last two pushes (`42360943997`, `42360918162`).
- Live site: HTTP 200.
- `mvs_354a02ed...` (original): model minimax, status **idle**, parked, not broken.
- `mvs_7ac968d537334b5d9d587015fbfd2c3b` (pinned fork): model minimax, status **idle**, ready for Dave.
- Backtest worker: running on minimax, fenced to three files, no git.

Both threads now take input normally. Neither is wedged any more.

## Recovery artifacts (this folder)

| File | What it is |
|------|------------|
| `mavis-fantasy-grinder-thread-archive-354a02ed.md` | Full readable transcript of the original thread, including its last successful compaction summary |
| `mavis-fantasy-grinder-recovery-digest-354a02ed.md` | Original thread: last compaction snapshot + everything after it (what to resume from) |
| `mavis-fantasy-grinder-thread-archive-7ac968d5.md` | Full readable transcript of the pinned fork |
| `mavis-fantasy-grinder-recovery-digest-7ac968d5.md` | Pinned fork: snapshot + everything after it |
| `mavis-fantasy-grinder-thread-recovery.md` | This record |

Exporter: `C:\Users\D\mavis-fantasy-grinder\dev\export_thread_archive.py`
(`python export_thread_archive.py <messages.jsonl> <archive.md> <digest.md>`).
It strips injected system-reminder blocks and keeps the thread's own compaction
summaries, so the digest is the thread's real state - not a reconstruction.

## Still open for Dave

Resolved 2026-11-07, later the same day: Dave is done with AMD. The provider is now
`enabled: false` in `config.yaml` (key stays on disk, provider unreachable). No session
is pinned to it. The other BYOK provider, `custom_provider:opencode-2` (OpenCode,
used by some worker threads), was tested the same way and is ALSO dead from this
machine: HTTP 403, Cloudflare error 1010. Every live thread runs on
`minimax/MiniMax-M3.1-Flash`. Do not re-enable either BYOK provider.
