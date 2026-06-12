#!/usr/bin/env python3
"""One-time parser: DR Top100 voting shortlist HTML → top400.json. JSON is canonical; raw HTML removed."""

from html.parser import HTMLParser
from html import unescape
from pathlib import Path
from urllib.parse import quote
import json
import re

SOURCE = Path("raw400.html")
OUT = Path("top400.json")
AUDIO_BASE_URL = "https://www.dr.dk/nyheder/htm/grafik/2026/top100/tracks/"
YOUTUBE_SOURCES = (OUT, Path("top100.json"))


class Node:
    def __init__(self, tag, attrs=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.children = []
        self.text = ""

    def classes(self):
        return set(self.attrs.get("class", "").split())


class TreeBuilder(HTMLParser):
    VOID = {
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].text += data


def descendants(node):
    for child in node.children:
        yield child
        yield from descendants(child)


def has_class(node, class_name):
    return class_name in node.classes()


def find_all(node, pred):
    return [n for n in descendants(node) if pred(n)]


def first(node, pred):
    for n in descendants(node):
        if pred(n):
            return n
    return None


def text_content(node):
    if node is None:
        return None
    parts = []

    def walk(n):
        if n.text:
            parts.append(n.text)
        for c in n.children:
            walk(c)

    walk(node)
    return re.sub(r"\s+", " ", unescape("".join(parts))).strip()


def filename_from_url(url):
    if not url:
        return None
    return unescape(url.split("?", 1)[0].rstrip("/").split("/")[-1])


def normalize_image_url(url):
    if not url:
        return None
    url = unescape(url)
    match = re.search(r"web\.archive\.org/web/\d+[^/]*/(.+)", url)
    if match:
        return match.group(1)
    return url


def audio_url(sound_file):
    if not sound_file:
        return None
    return AUDIO_BASE_URL + quote(sound_file)


def load_existing_youtube():
    existing = {}
    for path in YOUTUBE_SOURCES:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for song in data.get("songs", []):
            song_id = song.get("id")
            youtube = song.get("youtube")
            if song_id and youtube:
                existing[song_id] = youtube
    return existing


existing_youtube = load_existing_youtube()

html = SOURCE.read_text(encoding="utf-8")
parser = TreeBuilder()
parser.feed(html)

items = find_all(parser.root, lambda n: n.tag == "div" and has_class(n, "vote-song-item"))
songs = []
for sequence, item in enumerate(items, start=1):
    img = first(item, lambda n: n.tag == "img")
    play = first(
        item,
        lambda n: n.tag == "button" and has_class(n, "vote-song-play-button"),
    )
    add = first(
        item,
        lambda n: n.tag == "button" and has_class(n, "vote-song-add-button"),
    )
    title = text_content(first(item, lambda n: n.tag == "div" and has_class(n, "vote-song-title")))
    artist = text_content(first(item, lambda n: n.tag == "div" and has_class(n, "vote-song-artist")))

    image_url = normalize_image_url(img.attrs.get("src") if img else None)
    sound_file = play.attrs.get("data-sound") if play else None
    song_id = add.attrs.get("data-song-id") if add else None

    entry = {
        "sequence": sequence,
        "rank": None,
        "id": song_id,
        "artist": artist,
        "title": title,
        "image": {
            "url": image_url,
            "alt": img.attrs.get("alt") if img else None,
            "filename": filename_from_url(image_url),
        },
        "media": {
            "audio_file": sound_file,
            "audio_url": audio_url(sound_file),
        },
        "funfact": None,
        "credits": None,
    }
    if song_id and song_id in existing_youtube:
        entry["youtube"] = existing_youtube[song_id]
    songs.append(entry)

with_audio = sum(1 for s in songs if s["media"]["audio_file"])
with_youtube = sum(1 for s in songs if s.get("youtube"))

payload = {
    "source": str(SOURCE),
    "count": len(songs),
    "notes": [
        "sequence is the order songs appeared in raw400.html (alphabetical, grouped by letter dividers)",
        "rank is not available in the voting shortlist HTML",
        "funfact and credits are not present in raw400.html",
        "audio_url is built from the DR top100 tracks folder plus the data-sound filename",
        "image URLs normalized from web.archive.org captures to direct asset.dr.dk URLs",
        "youtube.url via scripts/enrich-songs-with-youtube.py (yt-dlp); preserved by song id if converter is re-run",
    ],
    "songs": songs,
}

OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {OUT} with {len(songs)} songs ({with_audio} with audio, {with_youtube} with youtube)")
