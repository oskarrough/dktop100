import { initCanvas } from "./canvas.js"
import "./player.js"
import "./radio.js"
import {
	toggleMySong,
	isInMySongs,
	getMySongs,
	backfillMySongUrls,
	CHANGE_EVENT,
	PLAY_EVENT,
} from "./my-songs.js"

const summary = document.querySelector("#summary")
const list = document.querySelector("#songs")
const template = document.querySelector("#song-template")
const player = document.querySelector("top100-player")
const searchInput = document.querySelector("#search")
const searchWrap = document.querySelector("#search-wrap")
const letterRail = document.querySelector("#letter-rail")

const datasets = {
	top100: { songs: [], meta: null },
	top400: { songs: [], meta: null },
}

let activeList = "top100"
let queue = []
let visibleIndices = []
let canvasView = null
let filterQuery = ""
let letterGroups = []
const LETTER_STICKY_TOP_REM = 0.5

// Playback is global state, independent of which list is on screen.
// It stays anchored to the list the track came from until a new track is picked.
let playback = { listId: null, song: null }

function isCanvasView() {
	return document.body.dataset.view === "canvas"
}

function canvasConfig() {
	if (activeList === "top100") {
		return {
			itemCount: 100,
			getSlot: (song) => song.rank,
		}
	}
	return {
		itemCount: queue.length,
		getSlot: (_song, index) => index + 1,
	}
}

function canvasSlotForSong(song) {
	if (!song) return null
	if (activeList === "top100") return song.rank ?? null
	const index = queue.indexOf(song)
	return index >= 0 ? index + 1 : null
}

function text(value) {
	return value == null ? "" : String(value)
}

function playable(song) {
	return Boolean(song?.media?.audio_url)
}

function youtubeUrl(song) {
	return song?.youtube?.url || null
}

function currentSong() {
	return playback.song
}

function sortSongs(listId, songs) {
	if (listId === "top100") {
		return [...songs].sort((a, b) => b.rank - a.rank)
	}
	return [...songs].sort((a, b) =>
		text(a.title).localeCompare(text(b.title), "da", { sensitivity: "base" }),
	)
}

function songGroupLetter(song) {
	const title = text(song.title).trim()
	if (!title) return "#"
	const first = title[0].toUpperCase()
	if (/[A-ZÆØÅ]/.test(first)) return first
	return "#"
}

function songMatchesFilter(song, query) {
	if (!query) return true
	const haystack = `${song.title} ${song.artist}`.toLowerCase()
	return haystack.includes(query)
}

function rebuildVisibleIndices() {
	const query = filterQuery.trim().toLowerCase()
	visibleIndices = queue
		.map((song, index) => ({ song, index }))
		.filter(({ song }) => songMatchesFilter(song, query))
		.map(({ index }) => index)
}

function rankedTitle(song) {
	return song.rank ? `#${song.rank} ${text(song.title)}` : text(song.title)
}

// List heading: ranked in the Top 100, plain title in the Top 400 (the badge marks chart songs there).
function songHeading(song, listId) {
	return listId === "top100" ? rankedTitle(song) : text(song.title)
}

// Player label: only reveal rank when listening from the Top 100 list.
function songLabel(song, listId) {
	return listId === "top100" ? rankedTitle(song) : text(song.title)
}

function updateSummary() {
	const total = queue.length
	const shown = visibleIndices.length
	// Only show a count while filtering; otherwise the list speaks for itself.
	summary.textContent = filterQuery ? `${shown} / ${total}` : ""
}

function updateMySongButtons() {
	document.querySelectorAll(".add-my-song").forEach((button) => {
		const songId = button.dataset.songId
		const selected = songId && isInMySongs(songId)

		button.classList.toggle("is-selected", selected)
		button.setAttribute("aria-pressed", String(selected))
		// Stays clickable when selected so it can toggle back off.
		button.textContent = selected ? "✓" : "+"
		button.setAttribute("aria-label", selected ? "Remove from my picks" : "Add to my picks")
	})
}

function updateFavoritesTab() {
	const tab = document.querySelector('.lists [data-list="favoritter"]')
	const count = getMySongs().length
	tab.textContent = count ? `Favoritter (${count})` : "Favoritter"
}

function updateListPlaybackState() {
	const isPlaying = !player.paused
	const playingId = playback.song?.id ?? null

	document.querySelectorAll(".play-song, [data-play-id]").forEach((button) => {
		if (button.disabled) return
		const buttonId = button.dataset.songId ?? button.dataset.playId
		const isCurrent = playingId != null && buttonId === playingId
		const playing = isCurrent && isPlaying
		button.classList.toggle("is-current", isCurrent)
		button.textContent = playing ? "⏸" : "▶"
		button.setAttribute("aria-label", playing ? "Pause preview" : "Play preview")
		button.setAttribute("aria-pressed", String(playing))
	})

	document.querySelectorAll("article.is-playing").forEach((article) => {
		article.classList.remove("is-playing")
	})
	// The playing track may not be in the list currently on screen — that's fine.
	if (playingId != null) {
		const currentArticle = list.querySelector(`article[data-song-id="${playingId}"]`)
		currentArticle?.classList.add("is-playing")
	}
}

function updatePlayer() {
	const song = currentSong()

	player.syncPlayButton()

	updateListPlaybackState()

	if (!song) {
		player.resetDisplay()
		return
	}

	if (canvasView && isCanvasView()) {
		const slot = canvasSlotForSong(song)
		if (slot) canvasView.focusSlot(slot)
	}

	const image = song.image
	player.setMetadata({
		title: songLabel(song, playback.listId),
		artist: text(song.artist),
		coverUrl: image?.url || null,
		coverAlt: image?.alt || `${text(song.title)} cover`,
		youtubeUrl: youtubeUrl(song),
	})
}

async function playSong(song, listId) {
	if (!song || !playable(song)) return

	playback = { listId, song }

	player.load(song.media.audio_url)
	updatePlayer()

	try {
		await player.play()
	} catch (error) {
		summary.textContent = `Could not play preview: ${error.message}`
	}

	updatePlayer()
}

// The ordered, playable songs that next/prev step through. Anchored to the
// list the current track came from; falls back to the displayed list when
// nothing is playing yet. Honors the search filter only while that list is on screen.
function navList() {
	const listId = playback.listId ?? activeList
	const songs = listId === activeList ? visibleIndices.map((i) => queue[i]) : datasets[listId].songs
	return { listId, songs: songs.filter(playable) }
}

function pickNext(songs, direction) {
	if (!songs.length) return null

	if (player.shuffle && direction > 0) {
		return songs[Math.floor(Math.random() * songs.length)]
	}

	const pos = playback.song ? songs.indexOf(playback.song) : -1
	const start = pos < 0 ? (direction > 0 ? -1 : 0) : pos
	return songs[(start + direction + songs.length) % songs.length]
}

function playNext() {
	const { listId, songs } = navList()
	const song = pickNext(songs, 1)
	if (song) playSong(song, listId)
}

function playPrevious() {
	const { listId, songs } = navList()
	const song = pickNext(songs, -1)
	if (song) playSong(song, listId)
}

function togglePlay(song = null, listId = activeList) {
	const target = song ?? playback.song

	// Re-pressing the current track just toggles pause/resume.
	if (target && target === playback.song && player.hasSource) {
		if (player.paused) player.play()
		else player.pause()
		return
	}

	if (target) playSong(target, song ? listId : playback.listId)
	else playNext()
}

// Resolve a favorited song id back to the full dataset entry (it has the audio url).
function findSongById(id, preferredListId = null) {
	const order = preferredListId ? [preferredListId, "top100", "top400"] : ["top100", "top400"]
	for (const listId of order) {
		const song = datasets[listId]?.songs.find((entry) => entry.id === id)
		if (song) return { song, listId }
	}
	return null
}

function renderSong(song) {
	const fragment = template.content.cloneNode(true)
	const li = fragment.querySelector("li")
	const article = fragment.querySelector("article")
	const heading = fragment.querySelector("h3")
	const artist = fragment.querySelector(".artist")
	const figure = fragment.querySelector("figure")
	const image = figure.querySelector("img")
	const playButton = fragment.querySelector(".play-song")
	const addMySongButton = fragment.querySelector(".add-my-song")
	const ytLink = fragment.querySelector(".youtube-link")
	const funfact = fragment.querySelector(".funfact")
	const credits = fragment.querySelector(".credits")

	if (song.id) article.dataset.songId = song.id
	if (activeList === "top100") {
		li.value = song.rank
	} else {
		li.value = song.sequence
	}

	heading.textContent = songHeading(song, activeList)

	artist.textContent = text(song.artist)

	if (song.image?.url) {
		image.src = song.image.url
		image.alt = song.image.alt || `${text(song.title)} cover`
	} else {
		figure.remove()
	}

	if (playable(song)) {
		if (song.id) playButton.dataset.songId = song.id
		playButton.addEventListener("click", (event) => {
			event.stopPropagation()
			togglePlay(song, activeList)
		})
		article.addEventListener("click", (event) => {
			if (event.target.closest("a, button")) return
			togglePlay(song, activeList)
		})
		article.classList.add("playable")
	} else {
		playButton.disabled = true
		playButton.setAttribute("aria-label", "No preview")
	}

	if (song.id) {
		addMySongButton.dataset.songId = song.id
		addMySongButton.addEventListener("click", (event) => {
			event.stopPropagation()
			toggleMySong(song, activeList)
		})
	} else {
		addMySongButton.remove()
	}

	// Full tracks live in the Radio4000 player; no per-card link.
	ytLink.remove()

	const funfactText = text(song.funfact)
	const creditsText = text(song.credits)
	if (funfactText) funfact.textContent = funfactText
	else funfact.remove()
	if (creditsText) credits.textContent = creditsText
	else credits.remove()

	return fragment
}

function renderLetterHeader(letter) {
	const li = document.createElement("li")
	li.className = "letter-header"
	li.dataset.letter = letter
	const divider = document.createElement("div")
	divider.className = "letter-divider"
	divider.textContent = letter
	li.append(divider)
	return li
}

function letterStickyTop() {
	const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
	return LETTER_STICKY_TOP_REM * rootFontSize
}

function findLetterHeader(letter) {
	return (
		[...list.querySelectorAll(".letter-header")].find(
			(header) => header.dataset.letter === letter,
		) ?? null
	)
}

function setActiveLetter(active) {
	letterRail.querySelectorAll(".letter-rail-btn").forEach((button) => {
		const isActive = button.dataset.letter === active
		button.classList.toggle("is-active", isActive)
		button.setAttribute("aria-current", isActive ? "true" : "false")
	})
}

// Scroll to the header's layout position instead of scrollIntoView(); sticky
// elements can otherwise produce odd no-op/partial jumps when scrolling upward.
function scrollToLetter(letter) {
	const header = findLetterHeader(letter)
	if (!header) return

	setActiveLetter(letter)
	window.scrollTo({
		top: Math.max(0, header.offsetTop - letterStickyTop()),
		behavior: "smooth",
	})
}

// Highlight the rail letter for the group currently under the sticky line.
function updateActiveLetter() {
	if (letterRail.hidden) return
	const threshold = letterStickyTop() + 1
	let active = letterGroups[0] ?? null
	for (const header of list.querySelectorAll(".letter-header")) {
		if (header.getBoundingClientRect().top <= threshold) active = header.dataset.letter
		else break
	}
	setActiveLetter(active)
}

function renderLetterRail() {
	const show = activeList === "top400" && !isCanvasView() && letterGroups.length > 0
	letterRail.hidden = !show
	if (!show) {
		letterRail.replaceChildren()
		return
	}

	letterRail.replaceChildren(
		...letterGroups.map((letter) => {
			const button = document.createElement("button")
			button.type = "button"
			button.className = "letter-rail-btn"
			button.dataset.letter = letter
			button.textContent = letter
			button.setAttribute("aria-label", `Jump to ${letter}`)
			button.setAttribute("aria-current", "false")
			button.addEventListener("click", (event) => {
				event.preventDefault()
				scrollToLetter(letter)
			})
			return button
		}),
	)
	updateActiveLetter()
}

function renderList() {
	rebuildVisibleIndices()
	const nodes = []
	const letters = []
	let lastLetter = null

	for (const index of visibleIndices) {
		const song = queue[index]
		if (activeList === "top400") {
			const letter = songGroupLetter(song)
			if (letter !== lastLetter) {
				nodes.push(renderLetterHeader(letter))
				letters.push(letter)
				lastLetter = letter
			}
		}
		nodes.push(renderSong(song))
	}

	list.replaceChildren(...nodes)
	letterGroups = letters
	renderLetterRail()
	updateSummary()
	updatePlayer()
	updateMySongButtons()
}

function resetCanvas() {
	canvasView = null
}

function setList(listId) {
	// "favoritter" has no dataset — its songs live in the top100-my-songs component.
	const isFavorites = listId === "favoritter"
	if (!isFavorites && !datasets[listId]?.songs?.length) return

	activeList = listId
	document.body.dataset.list = listId
	localStorage.setItem("top100-list", listId)
	queue = isFavorites ? [] : datasets[listId].songs
	// Leave playback alone — the current track keeps playing across list switches.
	filterQuery = ""
	searchInput.value = ""

	document.querySelectorAll(".lists [data-list]").forEach((button) => {
		button.setAttribute("aria-pressed", String(button.dataset.list === listId))
	})

	const canvasButton = document.querySelector('.views [data-view="canvas"]')
	canvasButton.hidden = isFavorites
	if (isFavorites && isCanvasView()) setView("list")

	searchWrap.hidden = isFavorites
	resetCanvas()
	renderList()
	if (isCanvasView() && !isFavorites) setView("canvas")
}

function setView(view) {
	if (activeList === "favoritter" && view === "canvas") view = "list"

	document.body.dataset.view = view
	localStorage.setItem("top100-view", view)

	document.querySelectorAll(".views [data-view]").forEach((button) => {
		button.setAttribute("aria-pressed", String(button.dataset.view === view))
	})

	document.querySelector("#canvas-view").hidden = view !== "canvas"
	renderLetterRail()

	if (view === "canvas") {
		if (!canvasView && queue.length) {
			canvasView = initCanvas(document.querySelector("#field"), queue, {
				onSelect: (song) => playSong(song, activeList),
				isActive: isCanvasView,
				...canvasConfig(),
			})
		}
		if (canvasView) {
			canvasView.resize()
			const slot = canvasSlotForSong(currentSong())
			if (slot) canvasView.focusSlot(slot)
		}
	}
}

async function loadDataset(url, listId) {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`)
	const data = await response.json()
	datasets[listId] = {
		meta: data,
		songs: sortSongs(listId, data.songs || []),
	}
}

async function init() {
	try {
		await Promise.all([loadDataset("top100.json", "top100"), loadDataset("top400.json", "top400")])

		const songDataById = new Map()
		for (const { songs } of Object.values(datasets)) {
			for (const song of songs) {
				if (!song.id) continue
				songDataById.set(song.id, {
					title: song.title,
					artist: song.artist,
					url: song.youtube?.url || null,
					image: song.image?.url || null,
					imageAlt: song.image?.alt || `${song.title} cover`,
				})
			}
		}
		backfillMySongUrls((id) => songDataById.get(id) ?? null)

		const savedList = localStorage.getItem("top100-list")
		setList(["top400", "favoritter"].includes(savedList) ? savedList : "top100")
		updateFavoritesTab()
		setView(localStorage.getItem("top100-view") || "list")
	} catch (error) {
		summary.textContent = error.message
	}
}

document.querySelectorAll(".lists [data-list]").forEach((button) => {
	button.addEventListener("click", () => setList(button.dataset.list))
})

document.querySelectorAll(".views [data-view]").forEach((button) => {
	button.addEventListener("click", () => setView(button.dataset.view))
})

searchInput.addEventListener("input", () => {
	filterQuery = searchInput.value
	renderList()
})

player.addEventListener("toggle", () => togglePlay())
player.addEventListener("prev", playPrevious)
player.addEventListener("next", playNext)
player.addEventListener("play", updateListPlaybackState)
player.addEventListener("pause", updateListPlaybackState)
player.addEventListener("ended", playNext)

document.addEventListener(CHANGE_EVENT, () => {
	updateMySongButtons()
	updateFavoritesTab()
	// The favoritter list re-rendered; restore ⏸/▶ state on its play buttons.
	updateListPlaybackState()
})

document.addEventListener(PLAY_EVENT, (event) => {
	const found = findSongById(event.detail.id, event.detail.listId)
	if (found) togglePlay(found.song, found.listId)
})

let activeLetterPending = false
window.addEventListener(
	"scroll",
	() => {
		if (letterRail.hidden || activeLetterPending) return
		activeLetterPending = true
		requestAnimationFrame(() => {
			activeLetterPending = false
			updateActiveLetter()
		})
	},
	{ passive: true },
)

document.addEventListener("keydown", (event) => {
	if (event.target.closest("input, textarea, select, button, a")) return

	if (event.key === " ") {
		event.preventDefault()
		togglePlay()
	} else if (event.key === "ArrowLeft") {
		playPrevious()
	} else if (event.key === "ArrowRight") {
		playNext()
	}
})

init()
