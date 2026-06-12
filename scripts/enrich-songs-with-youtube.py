#!/usr/bin/env python3
"""Find a YouTube video URL for each song in a chart JSON file (for Radio4000).

Skips songs that already have youtube.url (use --force to re-fetch). Reuses lookups
from the peer chart file (top100 ↔ top400) by DR song id, and dedupes artist+title
searches within a run so yt-dlp is never called twice for the same track.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_INPUT = Path("top100.json")
# Optional: copy youtube lookups between chart and shortlist (same DR song ids).
PEER_FILES = {
    "top100.json": Path("top400.json"),
    "top400.json": Path("top100.json"),
}


def default_radio4000_out(data_path: Path) -> Path:
    if data_path.name == "top100.json":
        return Path("radio4000-tracks.json")
    return Path(f"radio4000-tracks-{data_path.stem}.json")


def youtube_search(artist: str, title: str) -> dict | None:
    query = f"{artist} {title}".strip()
    if not query:
        return None

    proc = subprocess.run(
        [
            "yt-dlp",
            "--dump-json",
            "--flat-playlist",
            "--no-warnings",
            f"ytsearch1:{query}",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        return None

    hit = json.loads(proc.stdout.splitlines()[0])
    video_id = hit.get("id")
    if not video_id:
        return None

    return {
        "id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "title": hit.get("title"),
        "search_query": query,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def write_radio4000_export(payload: dict, source: str, out_path: Path) -> None:
    tracks = []
    for song in payload["songs"]:
        youtube = song.get("youtube") or {}
        url = youtube.get("url")
        if not url:
            continue
        rank = song.get("rank")
        tracks.append(
            {
                "title": f"#{rank} {song['artist']} - {song['title']}" if rank else f"{song['artist']} - {song['title']}",
                "url": url,
                "ytid": youtube.get("id"),
                "_rank": rank,
                "_sequence": song.get("sequence") or 0,
            }
        )

    if any(t["_rank"] is not None for t in tracks):
        tracks.sort(key=lambda t: t["_rank"] or 0)
    else:
        tracks.sort(key=lambda t: (t["_sequence"], t["title"].lower()))

    for track in tracks:
        track.pop("_rank", None)
        track.pop("_sequence", None)

    export = {
        "source": source,
        "count": len(tracks),
        "tracks": tracks,
    }
    out_path.write_text(json.dumps(export, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_peer_youtube(data_path: Path) -> dict[str, dict]:
    peer = PEER_FILES.get(data_path.name)
    if peer is None or not peer.exists():
        return {}

    peer_payload = json.loads(peer.read_text(encoding="utf-8"))
    return {
        s["id"]: s["youtube"]
        for s in peer_payload.get("songs", [])
        if s.get("id") and s.get("youtube", {}).get("url")
    }


def search_query_key(artist: str, title: str) -> str:
    return f"{artist} {title}".strip().casefold()


def sync_youtube_to_peer(data_path: Path, songs: list[dict]) -> Path | None:
    peer = PEER_FILES.get(data_path.name)
    if peer is None or not peer.exists():
        return None

    by_id = {s["id"]: s.get("youtube") for s in songs if s.get("id") and s.get("youtube")}
    if not by_id:
        return None

    peer_payload = json.loads(peer.read_text(encoding="utf-8"))
    updated = 0
    for song in peer_payload.get("songs", []):
        song_id = song.get("id")
        if song_id in by_id:
            song["youtube"] = by_id[song_id]
            updated += 1

    if updated:
        peer.write_text(json.dumps(peer_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return peer if updated else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        metavar="FILE",
        help="song JSON to enrich (default: top100.json)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        metavar="FILE",
        help="Radio4000 export path (default: radio4000-tracks.json or radio4000-tracks-<stem>.json)",
    )
    parser.add_argument("--force", action="store_true", help="re-fetch even when youtube.url exists")
    parser.add_argument("--dry-run", action="store_true", help="print matches without writing files")
    parser.add_argument("--limit", type=int, help="only process the first N songs needing lookup")
    parser.add_argument("--rank", type=int, help="only process one chart rank (top100 only)")
    parser.add_argument("--delay", type=float, default=0.5, help="seconds between lookups (default: 0.5)")
    parser.add_argument(
        "--sync-peer",
        action="store_true",
        help="after enriching, write youtube fields back to the peer chart for matching ids",
    )
    args = parser.parse_args()

    data_path = args.input
    radio4000_out = args.output or default_radio4000_out(data_path)

    if not data_path.exists():
        print(f"missing {data_path}", file=sys.stderr)
        return 1

    payload = json.loads(data_path.read_text(encoding="utf-8"))
    songs = payload["songs"]
    updated = 0
    copied_peer = 0
    copied_cache = 0
    skipped = 0
    failed = 0
    peer_youtube = load_peer_youtube(data_path)
    id_cache: dict[str, dict] = {}
    query_cache: dict[str, dict] = {}

    targets = songs
    if args.rank is not None:
        targets = [s for s in songs if s.get("rank") == args.rank]
        if not targets:
            print(f"no song with rank {args.rank}", file=sys.stderr)
            return 1

    for song in targets:
        rank = song.get("rank")
        label = f"#{rank} {song.get('artist')} - {song.get('title')}" if rank else f"{song.get('artist')} - {song.get('title')}"
        song_id = song.get("id")
        existing = song.get("youtube") or {}

        if existing.get("url") and not args.force:
            skipped += 1
            if song_id:
                id_cache[song_id] = existing
            query_key = search_query_key(song.get("artist") or "", song.get("title") or "")
            if query_key:
                query_cache[query_key] = existing
            continue

        if args.limit is not None and (updated + copied_peer + copied_cache) >= args.limit:
            break

        if not args.force:
            if song_id and song_id in peer_youtube:
                song["youtube"] = peer_youtube[song_id]
                if song_id:
                    id_cache[song_id] = song["youtube"]
                query_key = search_query_key(song.get("artist") or "", song.get("title") or "")
                if query_key:
                    query_cache[query_key] = song["youtube"]
                print(f"peer {label}\n    -> {song['youtube']['url']}")
                copied_peer += 1
                continue

            if song_id and song_id in id_cache:
                song["youtube"] = id_cache[song_id]
                print(f"cache {label} (id)\n    -> {song['youtube']['url']}")
                copied_cache += 1
                continue

            query_key = search_query_key(song.get("artist") or "", song.get("title") or "")
            if query_key and query_key in query_cache:
                song["youtube"] = query_cache[query_key]
                if song_id:
                    id_cache[song_id] = song["youtube"]
                print(f"cache {label} (query)\n    -> {song['youtube']['url']}")
                copied_cache += 1
                continue

        match = youtube_search(song.get("artist") or "", song.get("title") or "")
        if match:
            song["youtube"] = match
            if song_id:
                id_cache[song_id] = match
            query_key = search_query_key(song.get("artist") or "", song.get("title") or "")
            if query_key:
                query_cache[query_key] = match
            print(f"ok  {label}\n    -> {match['title']}\n    -> {match['url']}")
            updated += 1
        else:
            print(f"miss {label}", file=sys.stderr)
            failed += 1

        if args.delay and not args.dry_run:
            time.sleep(args.delay)

    if args.dry_run:
        print(
            f"dry-run: would fetch {updated}, copy peer {copied_peer}, "
            f"copy cache {copied_cache}, skip {skipped}, miss {failed}"
        )
        return 0 if failed == 0 else 2

    notes = [n for n in payload.get("notes", []) if not n.startswith("youtube.")]
    notes.append("youtube.url is looked up via scripts/enrich-songs-with-youtube.py (yt-dlp ytsearch1)")
    payload["notes"] = notes

    data_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_radio4000_export(payload, str(data_path), radio4000_out)
    print(
        f"wrote {data_path} (+{updated} fetched, {copied_peer} peer, "
        f"{copied_cache} cache, skipped {skipped}, missed {failed})"
    )
    print(f"wrote {radio4000_out}")

    if args.sync_peer:
        peer = sync_youtube_to_peer(data_path, songs)
        if peer:
            write_radio4000_export(
                json.loads(peer.read_text(encoding="utf-8")),
                str(peer),
                default_radio4000_out(peer),
            )
            print(f"synced youtube to {peer} (+ refreshed {default_radio4000_out(peer)})")

    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
