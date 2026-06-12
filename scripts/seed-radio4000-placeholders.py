#!/usr/bin/env python3
"""Seed Radio4000 chart order for dktop100 via placeholder tracks.

Radio4000 lists tracks by tracks.created_at DESC (newest first). For a TOP100
countdown (#100 at top, #1 at bottom), create placeholders in ascending rank
order (#1 first, #100 last), then UPDATE each slot with real title/url. Updates
preserve created_at (only updated_at changes), so chart order stays fixed.

Requires: r4 CLI authenticated (`r4 auth login`).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

CHANNEL = "dktop100"
PLACEHOLDER_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # short valid YouTube
PLACEHOLDER_SUFFIX = "TOP100 placeholder"
RANK_RE = re.compile(r"^#(\d+)\b")
TRACKS_JSON = Path("radio4000-tracks.json")
STATE_JSON = Path(".r4-slot-map.json")  # rank -> track id after seed


def r4(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        ["r4", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if check and proc.returncode != 0:
        msg = proc.stderr.strip() or proc.stdout.strip() or f"r4 exited {proc.returncode}"
        raise RuntimeError(msg)
    return proc


def r4_json(*args: str) -> object:
    proc = r4(*args)
    text = proc.stdout.strip()
    if not text:
        raise RuntimeError(f"empty output from r4 {' '.join(args)}")
    return json.loads(text)


def parse_rank(title: str) -> int | None:
    m = RANK_RE.match(title.strip())
    return int(m.group(1)) if m else None


def placeholder_title(rank: int) -> str:
    return f"#{rank} {PLACEHOLDER_SUFFIX}"


def is_placeholder(title: str) -> bool:
    return PLACEHOLDER_SUFFIX in title


def list_tracks() -> list[dict]:
    data = r4_json("track", "list", "--channel", CHANNEL)
    if not isinstance(data, list):
        raise RuntimeError("expected track list array")
    return data


def tracks_by_rank(tracks: list[dict]) -> dict[int, dict]:
    """Map chart rank -> track, using created_at order when placeholders were seeded."""
    # Newest created_at = rank 100, oldest among 100 = rank 1
    by_time = sorted(tracks, key=lambda t: t["created_at"])
    if len(by_time) == 100 and all(is_placeholder(t["title"]) for t in by_time):
        return {i + 1: by_time[i] for i in range(100)}

    by_title: dict[int, dict] = {}
    for t in tracks:
        rank = parse_rank(t["title"])
        if rank is not None:
            by_title[rank] = t
    return by_title


def load_slot_map() -> dict[str, str]:
    if not STATE_JSON.exists():
        return {}
    return json.loads(STATE_JSON.read_text(encoding="utf-8"))


def save_slot_map(rank_to_id: dict[int, str]) -> None:
    STATE_JSON.write_text(
        json.dumps({str(k): v for k, v in sorted(rank_to_id.items())}, indent=2) + "\n",
        encoding="utf-8",
    )


def cmd_status(_: argparse.Namespace) -> int:
    tracks = list_tracks()
    slots = tracks_by_rank(tracks)
    print(f"Channel: {CHANNEL} — {len(tracks)} track(s)")

    if not tracks:
        print("Empty channel. Run: scripts/seed-radio4000-placeholders.py seed --confirm")
        return 0

    # Display order = created_at DESC
    display = sorted(tracks, key=lambda t: t["created_at"], reverse=True)
    ranks_shown = [parse_rank(t["title"]) for t in display]

    print("\nCurrent display order (top = first in player):")
    for i, t in enumerate(display[:15], start=1):
        rank = parse_rank(t["title"])
        flag = ""
        if rank is not None and rank != 101 - i and len(tracks) == 100:
            flag = "  ← rank mismatch vs slot"
        print(f"  {i:3}. #{rank or '?':>3}  {t['title'][:60]}{flag}")
    if len(display) > 15:
        print(f"  ... ({len(display) - 15} more)")

    if len(tracks) == 100:
        expected_top = [100 - i for i in range(10)]
        actual_top = [r for r in ranks_shown[:10] if r is not None]
        if actual_top == expected_top:
            print("\n✓ Top 10 ranks match countdown order (#100 … #91).")
        else:
            print(f"\n✗ Top ranks wrong. Expected start {expected_top}, got {actual_top}")
            print("  Fix: python3 scripts/seed-radio4000-placeholders.py reset --confirm")
    elif len(tracks) == 11:
        print("\n✗ 11 ad-hoc tracks — #100 is oldest so it appears last.")
        print("  Fix: python3 scripts/seed-radio4000-placeholders.py reset --confirm")
    else:
        missing = sorted(set(range(1, 101)) - set(slots))
        if missing:
            print(f"\nPartial grid: {len(slots)}/100 ranks mapped; missing e.g. {missing[:5]}…")

    placeholders = sum(1 for t in tracks if is_placeholder(t["title"]))
    if placeholders:
        print(f"\n{placeholders} placeholder(s) still unfilled.")
    return 0


def cmd_test_created_at(args: argparse.Namespace) -> int:
    title = "#TEST created_at check"
    print("Creating test track…")
    r4("track", "create", "--channel", CHANNEL, "--title", title, "--url", PLACEHOLDER_URL, check=False)
    time.sleep(args.delay)

    tracks = [t for t in list_tracks() if t["title"] == title]
    if not tracks:
        print("Failed to find test track after create.", file=sys.stderr)
        return 1
    track = tracks[0]
    tid = track["id"]
    created_before = track["created_at"]
    print(f"  id={tid} created_at={created_before}")

    time.sleep(1)
    print("Updating title + url…")
    r4(
        "track",
        "update",
        tid,
        "--title",
        "#TEST created_at updated",
        "--url",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )

    updated = r4_json("track", "view", tid)
    created_after = updated["created_at"]
    print(f"  created_at after update: {created_after}")
    print(f"  updated_at after update: {updated['updated_at']}")

    if created_before == created_after:
        print("✓ created_at preserved — placeholder strategy is safe.")
    else:
        print("✗ created_at CHANGED — do not use update-based ordering!", file=sys.stderr)
        return 1

    if not args.keep_test:
        r4("track", "delete", tid)
        print("Deleted test track.")
    return 0


def create_placeholder(rank: int, delay: float) -> str | None:
    title = placeholder_title(rank)
    proc = r4(
        "track",
        "create",
        "--channel",
        CHANNEL,
        "--title",
        title,
        "--url",
        PLACEHOLDER_URL,
        check=False,
    )
    if delay:
        time.sleep(delay)

    # CLI may exit non-zero on readback race; locate track by title
    matches = [t for t in list_tracks() if t["title"] == title]
    if matches:
        return matches[0]["id"]

    if proc.returncode == 0 and proc.stdout.strip():
        try:
            data = json.loads(proc.stdout)
            if isinstance(data, dict) and data.get("id"):
                return data["id"]
        except json.JSONDecodeError:
            pass

    raise RuntimeError(f"failed to create placeholder rank {rank}: {proc.stderr or proc.stdout}")


def cmd_seed(args: argparse.Namespace) -> int:
    existing = list_tracks()
    if existing and not args.force:
        print(
            f"Channel already has {len(existing)} track(s). "
            "Use --force after delete, or reset --confirm.",
            file=sys.stderr,
        )
        return 1

    if args.dry_run:
        print(f"Would create placeholders #{args.from_rank}…#{args.to_rank} on {CHANNEL}")
        for rank in range(args.from_rank, args.to_rank + 1):
            print(f"  {placeholder_title(rank)}")
        return 0

    if not args.confirm:
        print("Refusing to seed without --confirm (writes to production).", file=sys.stderr)
        return 1

    rank_to_id: dict[int, str] = {}
    total = args.to_rank - args.from_rank + 1
    for i, rank in enumerate(range(args.from_rank, args.to_rank + 1), start=1):
        print(f"[{i}/{total}] rank {rank}…", end="\r", flush=True)
        rank_to_id[rank] = create_placeholder(rank, args.delay)
    print()

    save_slot_map(rank_to_id)
    print(f"✓ Created {len(rank_to_id)} placeholders. Slot map → {STATE_JSON}")
    print("Next: python3 scripts/seed-radio4000-placeholders.py fill")
    return 0


def load_tracks_json(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    tracks = data.get("tracks", [])
    out: list[dict] = []
    for t in tracks:
        rank = parse_rank(t.get("title", ""))
        if rank is None:
            continue
        out.append(
            {
                "rank": rank,
                "title": t["title"],
                "url": t["url"],
                "description": t.get("body") or t.get("description") or "",
            }
        )
    return sorted(out, key=lambda x: x["rank"])


def cmd_fill(args: argparse.Namespace) -> int:
    source = Path(args.source)
    if not source.exists():
        print(f"Missing {source}", file=sys.stderr)
        return 1

    wanted = load_tracks_json(source)
    slots = tracks_by_rank(list_tracks())
    saved = {int(k): v for k, v in load_slot_map().items()}
    for rank, tid in saved.items():
        if rank not in slots:
            slots[rank] = {"id": tid, "title": placeholder_title(rank)}

    if len(slots) < 100:
        print(
            f"Only {len(slots)} rank slots available (need 100). Run seed --confirm first.",
            file=sys.stderr,
        )
        return 1

    to_update = [t for t in wanted if args.rank is None or t["rank"] == args.rank]
    if args.dry_run:
        print(f"Would update {len(to_update)} track(s) from {source}")
        for t in to_update[:5]:
            slot = slots.get(t["rank"])
            print(f"  #{t['rank']} → {slot['id'] if slot else '?'}: {t['title'][:50]}")
        if len(to_update) > 5:
            print(f"  … and {len(to_update) - 5} more")
        return 0

    if not args.confirm:
        print("Refusing to fill without --confirm.", file=sys.stderr)
        return 1

    updated = 0
    for t in to_update:
        slot = slots.get(t["rank"])
        if not slot:
            print(f"  skip #{t['rank']}: no slot", file=sys.stderr)
            continue
        tid = slot["id"]
        print(f"  #{t['rank']:>3} …", flush=True)
        update_args = [
            "track",
            "update",
            tid,
            "--title",
            t["title"],
            "--url",
            t["url"],
        ]
        if t["description"]:
            update_args.extend(["--description", t["description"]])
        r4(*update_args)
        updated += 1
        if args.delay:
            time.sleep(args.delay)

    print(f"✓ Updated {updated} track(s).")
    return 0


def cmd_delete_all(args: argparse.Namespace) -> int:
    tracks = list_tracks()
    if not tracks:
        print("No tracks to delete.")
        return 0
    if args.dry_run:
        print(f"Would delete {len(tracks)} track(s) from {CHANNEL}")
        return 0
    if not args.confirm:
        print("Refusing to delete without --confirm.", file=sys.stderr)
        return 1

    ids = [t["id"] for t in tracks]
    # r4 accepts multiple ids per call; batch to avoid huge argv
    batch = 20
    for i in range(0, len(ids), batch):
        r4("track", "delete", *ids[i : i + batch])
    if STATE_JSON.exists():
        STATE_JSON.unlink()
    print(f"✓ Deleted {len(ids)} track(s).")
    return 0


def cmd_reset(args: argparse.Namespace) -> int:
    if args.dry_run:
        print("Would: delete all → seed #1…#100 → fill from radio4000-tracks.json")
        return 0
    if not args.confirm:
        print("Refusing to reset without --confirm.", file=sys.stderr)
        return 1

    cmd_delete_all(argparse.Namespace(dry_run=False, confirm=True))
    cmd_seed(
        argparse.Namespace(
            dry_run=False,
            confirm=True,
            force=True,
            from_rank=1,
            to_rank=100,
            delay=args.delay,
        )
    )
    cmd_fill(
        argparse.Namespace(
            source=str(TRACKS_JSON),
            dry_run=False,
            confirm=True,
            rank=None,
            delay=args.delay,
        )
    )
    print("✓ Reset complete. Run: python3 scripts/seed-radio4000-placeholders.py status")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delay", type=float, default=0.15, help="seconds between API calls")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_status = sub.add_parser("status", help="show channel order vs expected countdown")
    p_status.set_defaults(func=cmd_status)

    p_test = sub.add_parser("test-created-at", help="verify update preserves created_at (1 track)")
    p_test.add_argument("--keep-test", action="store_true")
    p_test.set_defaults(func=cmd_test_created_at)

    p_seed = sub.add_parser("seed", help="create placeholder tracks #1…#100 (ascending)")
    p_seed.add_argument("--from-rank", type=int, default=1)
    p_seed.add_argument("--to-rank", type=int, default=100)
    p_seed.add_argument("--dry-run", action="store_true")
    p_seed.add_argument("--confirm", action="store_true")
    p_seed.add_argument("--force", action="store_true", help="seed even if channel has tracks")
    p_seed.set_defaults(func=cmd_seed)

    p_fill = sub.add_parser("fill", help="update placeholder slots from JSON export")
    p_fill.add_argument("--source", default=str(TRACKS_JSON))
    p_fill.add_argument("--rank", type=int, help="update a single rank only")
    p_fill.add_argument("--dry-run", action="store_true")
    p_fill.add_argument("--confirm", action="store_true")
    p_fill.set_defaults(func=cmd_fill)

    p_del = sub.add_parser("delete-all", help="remove every track on the channel")
    p_del.add_argument("--dry-run", action="store_true")
    p_del.add_argument("--confirm", action="store_true")
    p_del.set_defaults(func=cmd_delete_all)

    p_reset = sub.add_parser("reset", help="delete-all + seed + fill (full fix)")
    p_reset.add_argument("--dry-run", action="store_true")
    p_reset.add_argument("--confirm", action="store_true")
    p_reset.set_defaults(func=cmd_reset)

    args = parser.parse_args()
    try:
        return args.func(args)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
