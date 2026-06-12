#!/usr/bin/env python3
"""One-time: copy chart rank + funfact/credits from top100.json into top400.json.

top100 is a strict subset of the voting shortlist (same DR song ids). With fixed
snapshot data there is no ongoing sync — run once after both convert scripts.
"""

from __future__ import annotations

import json
from pathlib import Path

CHART = Path("top100.json")
SHORTLIST = Path("top400.json")


def main() -> None:
    chart = json.loads(CHART.read_text(encoding="utf-8"))
    shortlist = json.loads(SHORTLIST.read_text(encoding="utf-8"))

    by_id = {s["id"]: s for s in chart["songs"] if s.get("id")}
    annotated = 0

    for song in shortlist["songs"]:
        entry = by_id.get(song.get("id"))
        if not entry:
            song["in_top100"] = False
            continue

        song["in_top100"] = True
        song["rank"] = entry.get("rank")
        if entry.get("funfact"):
            song["funfact"] = entry["funfact"]
        if entry.get("credits"):
            song["credits"] = entry["credits"]
        if entry.get("youtube") and not song.get("youtube"):
            song["youtube"] = entry["youtube"]
        annotated += 1

    notes = [
        n
        for n in shortlist.get("notes", [])
        if not n.startswith("in_top100")
        and not n.startswith("chart ranks")
        and not n.startswith("youtube.url")
    ]
    notes.append("youtube.url via scripts/enrich-songs-with-youtube.py (yt-dlp); preserved by song id if converter is re-run")
    notes.extend(
        [
            "in_top100 / rank / funfact / credits for chart songs copied from top100.json (scripts/annotate-shortlist-from-chart.py)",
            "chart ranks are 21–100 in this snapshot (top 20 not in saved reveal HTML)",
        ]
    )
    shortlist["notes"] = notes
    shortlist["chart_source"] = str(CHART)
    shortlist["chart_count"] = annotated

    SHORTLIST.write_text(json.dumps(shortlist, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {SHORTLIST}: {annotated} songs marked in_top100")


if __name__ == "__main__":
    main()
