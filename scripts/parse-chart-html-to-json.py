#!/usr/bin/env python3
"""One-time parser: saved DR reveal HTML → top100.json. JSON is canonical; raw HTML removed."""
from html.parser import HTMLParser
from html import unescape
from pathlib import Path
from urllib.parse import quote
import json
import re

SOURCE = Path("raw.html")
OUT = Path("top100.json")
AUDIO_BASE_URL = "https://www.dr.dk/nyheder/htm/grafik/2026/top100/tracks/"

class Node:
    def __init__(self, tag, attrs=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.children = []
        self.text = ""

    def classes(self):
        return set(self.attrs.get("class", "").split())

class TreeBuilder(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
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


def audio_url(sound_file):
    if not sound_file:
        return None
    return AUDIO_BASE_URL + quote(sound_file)

existing_youtube = {}
if OUT.exists():
    try:
        previous = json.loads(OUT.read_text(encoding="utf-8"))
        for song in previous.get("songs", []):
            song_id = song.get("id")
            youtube = song.get("youtube")
            if song_id and youtube:
                existing_youtube[song_id] = youtube
    except (json.JSONDecodeError, OSError):
        pass

html = SOURCE.read_text(encoding="utf-8")
parser = TreeBuilder()
parser.feed(html)

cards = find_all(parser.root, lambda n: n.tag == "div" and has_class(n, "reveal-card"))
songs = []
for sequence, card in enumerate(cards, start=1):
    rank_node = first(card, lambda n: n.tag == "span" and has_class(n, "reveal-card-rank-number"))
    rank_text = text_content(rank_node)
    img = first(card, lambda n: n.tag == "img")
    play = first(card, lambda n: n.tag == "button" and has_class(n, "reveal-card-play"))
    title = text_content(first(card, lambda n: n.tag == "div" and has_class(n, "reveal-card-title")))
    artist = text_content(first(card, lambda n: n.tag == "div" and has_class(n, "reveal-card-artist")))
    funfact_p = first(card, lambda n: n.tag == "p")
    credit_span = first(card, lambda n: n.tag == "span" and has_class(n, "reveal-card-funfact-credits"))
    credits = text_content(credit_span)
    funfact = text_content(funfact_p)
    if funfact and credits and funfact.endswith(credits):
        funfact = funfact[: -len(credits)].strip()

    image_url = img.attrs.get("src") if img else None
    sound_file = play.attrs.get("data-sound") if play else None

    song_id = card.attrs.get("data-song-id")
    entry = {
        "sequence": sequence,
        "rank": int(rank_text) if rank_text and rank_text.isdigit() else None,
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
        "funfact": funfact,
        "credits": credits,
    }
    if song_id and song_id in existing_youtube:
        entry["youtube"] = existing_youtube[song_id]
    songs.append(entry)

ranks = {s["rank"] for s in songs if s["rank"] is not None}
rank_range = {
    "highest": min(ranks, default=None),
    "lowest": max(ranks, default=None),
}

payload = {
    "source": str(SOURCE),
    "count": len(songs),
    "rank_range": rank_range,
    "missing_ranks_in_1_to_100": [rank for rank in range(1, 101) if rank not in ranks],
    "notes": [
        "sequence is the order the cards appeared in raw.html",
        "audio_url is built from the DR top100 tracks folder plus the data-sound filename",
    ],
    "songs": songs,
}

OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {OUT} with {len(songs)} songs")
