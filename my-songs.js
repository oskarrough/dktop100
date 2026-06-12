const STORAGE_KEY = "top100-my-songs"
const MAX_TOP = 5
const CHANGE_EVENT = "top100-my-songs-change"
// Playback lives in script.js (it has the full song data); we only announce the wish.
const PLAY_EVENT = "top100-my-songs-play"

let songs = loadFromStorage()

function loadFromStorage() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		const parsed = raw ? JSON.parse(raw) : []
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

function persist() {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(songs))
	document.dispatchEvent(
		new CustomEvent(CHANGE_EVENT, {
			detail: { songs: getMySongs(), top: getMyTopSongs() },
		}),
	)
}

function songEntry(song, listId) {
	return {
		id: song.id,
		title: song.title,
		artist: song.artist,
		rank: song.rank ?? null,
		listId: listId || null,
		image: song.image?.url || null,
		imageAlt: song.image?.alt || `${song.title} cover`,
		// Kept so the copied text can feed straight into a Radio4000 channel.
		url: song.youtube?.url || null,
	}
}

export function getMySongs() {
	return [...songs]
}

export function getMyTopSongs() {
	return songs.slice(0, MAX_TOP)
}

export function isInMySongs(id) {
	return songs.some((song) => song.id === id)
}

export function addMySong(song, listId) {
	if (!song?.id || isInMySongs(song.id)) return false
	songs.push(songEntry(song, listId))
	persist()
	return true
}

export function removeMySong(id) {
	const before = songs.length
	songs = songs.filter((song) => song.id !== id)
	if (songs.length === before) return false
	persist()
	return true
}

// Add if absent, remove if present. Returns true when the song ends up saved.
export function toggleMySong(song, listId) {
	if (!song?.id) return false
	if (isInMySongs(song.id)) {
		removeMySong(song.id)
		return false
	}
	return addMySong(song, listId)
}

// Entries saved before newer fields existed get them filled in once the
// datasets are loaded. dataForId: (id) => { url, image, imageAlt, title, artist } | null.
export function backfillMySongUrls(dataForId) {
	let changed = false
	for (const song of songs) {
		const data = dataForId(song.id)
		if (!data) continue
		for (const key of ["url", "image", "imageAlt", "title", "artist"]) {
			if (song[key] || !data[key]) continue
			song[key] = data[key]
			changed = true
		}
	}
	if (changed) persist()
}

export function moveMySong(fromIndex, toIndex) {
	if (fromIndex === toIndex) return false
	if (fromIndex < 0 || toIndex < 0 || fromIndex >= songs.length || toIndex >= songs.length) {
		return false
	}
	const [item] = songs.splice(fromIndex, 1)
	songs.splice(toIndex, 0, item)
	persist()
	return true
}

function songLabel(song) {
	return song.title
}

// Plain-text version of the list, one song per line, ready to paste anywhere
// (including Radio4000's track import, which picks up the YouTube URLs).
export function mySongsAsText() {
	return songs
		.map((song, index) => {
			const line = `${index + 1}. ${song.artist} – ${song.title}`
			return song.url ? `${line} ${song.url}` : line
		})
		.join("\n")
}

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch {
		// Clipboard API can be blocked (permissions, non-secure context).
		const scratch = document.createElement("textarea")
		scratch.value = text
		scratch.setAttribute("readonly", "")
		scratch.style.position = "fixed"
		scratch.style.opacity = "0"
		document.body.append(scratch)
		scratch.select()
		const ok = document.execCommand("copy")
		scratch.remove()
		return ok
	}
}

export class Top100MySongs extends HTMLElement {
	#list
	#onChange
	#onStorage
	#dragState = null

	constructor() {
		super()
		this.setAttribute("aria-label", "Favoritter")
		this.innerHTML = `
      <header>
        <h2>Favoritter (0)</h2>
        <button type="button" class="btn" hidden>Kopiér som tekst</button>
      </header>
      <p class="hint" hidden>Kun top ${MAX_TOP} tæller.</p>
      <ol></ol>
      <p class="empty" hidden>Tilføj sange med +.</p>
      <p class="footer" hidden>
        Gem for evigt på <a href="https://radio4000.com" target="_blank" rel="noopener noreferrer">Radio4000</a>
      </p>
    `
		this.#list = this.querySelector("ol")

		const copyButton = this.querySelector("header button")
		let copyResetTimer = null
		copyButton.addEventListener("click", async () => {
			const ok = await copyText(mySongsAsText())
			copyButton.textContent = ok ? "Kopieret ✓" : "Kunne ikke kopiere"
			clearTimeout(copyResetTimer)
			copyResetTimer = setTimeout(() => {
				copyButton.textContent = "Kopiér som tekst"
			}, 1600)
		})

		this.#list.addEventListener("click", (event) => {
			const play = event.target.closest("[data-play-id]")
			if (play) {
				document.dispatchEvent(
					new CustomEvent(PLAY_EVENT, {
						detail: { id: play.dataset.playId, listId: play.dataset.listId || null },
					}),
				)
				return
			}

			const remove = event.target.closest("[data-remove-id]")
			if (remove) {
				removeMySong(remove.dataset.removeId)
				return
			}

			const move = event.target.closest("[data-move]")
			if (!move) return
			const row = move.closest("[data-index]")
			if (!row) return
			const index = Number(row.dataset.index)
			if (move.dataset.move === "top") {
				moveMySong(index, 0)
				return
			}
			const delta = move.dataset.move === "up" ? -1 : 1
			moveMySong(index, index + delta)
		})

		const clearDragStyles = () => {
			this.#list.querySelectorAll(".is-dragging, .is-drop-target").forEach((el) => {
				el.classList.remove("is-dragging", "is-drop-target")
			})
		}

		const itemFromPoint = (x, y) => {
			const item = document.elementFromPoint(x, y)?.closest("[data-index]")
			return item && this.#list.contains(item) ? item : null
		}

		const setDropTarget = (item) => {
			this.#list.querySelectorAll(".is-drop-target").forEach((el) => {
				el.classList.remove("is-drop-target")
			})
			if (!item) return
			this.#dragState.toIndex = Number(item.dataset.index)
			item.classList.add("is-drop-target")
		}

		const onMove = (event) => {
			if (!this.#dragState || event.pointerId !== this.#dragState.pointerId) return
			event.preventDefault()
			setDropTarget(itemFromPoint(event.clientX, event.clientY))
		}

		const finishDrag = (event, shouldMove) => {
			if (!this.#dragState || event.pointerId !== this.#dragState.pointerId) return
			event.preventDefault()
			const { fromIndex, toIndex, handle } = this.#dragState
			if (handle.hasPointerCapture?.(event.pointerId)) {
				handle.releasePointerCapture(event.pointerId)
			}
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerup", onUp)
			window.removeEventListener("pointercancel", onCancel)
			clearDragStyles()
			this.#dragState = null
			if (shouldMove && toIndex != null) moveMySong(fromIndex, toIndex)
		}

		const onUp = (event) => finishDrag(event, true)
		const onCancel = (event) => finishDrag(event, false)

		this.#list.addEventListener("pointerdown", (event) => {
			const handle = event.target.closest("[data-drag-handle]")
			if (!handle) return
			const item = handle.closest("[data-index]")
			if (!item) return
			event.preventDefault()

			clearDragStyles()
			this.#dragState = {
				pointerId: event.pointerId,
				fromIndex: Number(item.dataset.index),
				toIndex: Number(item.dataset.index),
				handle,
			}
			item.classList.add("is-dragging", "is-drop-target")
			handle.setPointerCapture?.(event.pointerId)
			window.addEventListener("pointermove", onMove, { passive: false })
			window.addEventListener("pointerup", onUp)
			window.addEventListener("pointercancel", onCancel)
		})
	}

	connectedCallback() {
		this.#render()
		this.#onChange = () => this.#render()
		document.addEventListener(CHANGE_EVENT, this.#onChange)
		this.#onStorage = (event) => {
			if (event.key !== STORAGE_KEY) return
			songs = loadFromStorage()
			this.#render()
		}
		window.addEventListener("storage", this.#onStorage)
	}

	disconnectedCallback() {
		document.removeEventListener(CHANGE_EVENT, this.#onChange)
		window.removeEventListener("storage", this.#onStorage)
	}

	#render() {
		const count = songs.length

		const title = this.querySelector("header h2")
		const empty = this.querySelector(".empty")
		const hint = this.querySelector(".hint")
		const copyButton = this.querySelector("header button")
		const footer = this.querySelector(".footer")
		title.textContent = `Favoritter (${count})`
		empty.hidden = count > 0
		hint.hidden = count === 0
		copyButton.hidden = count === 0
		footer.hidden = count === 0

		const nodes = songs.flatMap((song, index) => {
			const items = []
			if (index === MAX_TOP) {
				const divider = document.createElement("li")
				divider.setAttribute("aria-hidden", "true")
				divider.textContent = "Resten"
				items.push(divider)
			}

			const li = document.createElement("li")
			li.dataset.index = index
			const isTop = index < MAX_TOP

			const article = document.createElement("article")
			article.className = isTop ? "song is-top-pick" : "song"

			const rank = document.createElement("span")
			rank.textContent = String(index + 1)

			const figure = document.createElement("figure")
			const thumb = document.createElement("img")
			thumb.loading = "lazy"
			thumb.alt = song.imageAlt || `${song.title} cover`
			if (song.image) thumb.src = song.image
			else thumb.hidden = true
			figure.append(thumb)

			const heading = document.createElement("h3")
			heading.textContent = songLabel(song)

			const artist = document.createElement("p")
			artist.className = "artist"
			artist.textContent = song.artist || ""

			const actions = document.createElement("menu")
			const actionItem = (...children) => {
				const item = document.createElement("li")
				item.append(...children)
				return item
			}

			const play = document.createElement("button")
			play.type = "button"
			play.className = "btn icon"
			play.dataset.playId = song.id
			if (song.listId) play.dataset.listId = song.listId
			play.setAttribute("aria-label", `Play ${song.title}`)
			play.textContent = "▶"

			const moveGroup = document.createElement("div")
			moveGroup.setAttribute("role", "group")
			moveGroup.setAttribute("aria-label", `Reorder ${song.title}`)

			const moveTop = document.createElement("button")
			moveTop.type = "button"
			moveTop.className = "btn icon"
			moveTop.dataset.move = "top"
			moveTop.textContent = "⇈"
			moveTop.disabled = index === 0
			moveTop.setAttribute("aria-label", `Move ${song.title} to the top`)

			const moveUp = document.createElement("button")
			moveUp.type = "button"
			moveUp.className = "btn icon"
			moveUp.dataset.move = "up"
			moveUp.textContent = "↑"
			moveUp.disabled = index === 0
			moveUp.setAttribute("aria-label", `Move ${song.title} up`)

			const moveDown = document.createElement("button")
			moveDown.type = "button"
			moveDown.className = "btn icon"
			moveDown.dataset.move = "down"
			moveDown.textContent = "↓"
			moveDown.disabled = index === songs.length - 1
			moveDown.setAttribute("aria-label", `Move ${song.title} down`)

			moveGroup.append(moveUp, moveDown)

			const drag = document.createElement("button")
			drag.type = "button"
			drag.className = "btn icon"
			drag.dataset.dragHandle = ""
			drag.setAttribute("aria-label", `Drag to reorder ${song.title}`)
			drag.textContent = "⠿"

			const remove = document.createElement("button")
			remove.type = "button"
			remove.className = "btn icon"
			remove.dataset.removeId = song.id
			remove.setAttribute("aria-label", `Remove ${song.title} from my picks`)
			remove.textContent = "✕"

			actions.append(actionItem(play), actionItem(moveTop), actionItem(moveGroup), actionItem(drag))

			if (song.url) {
				const r4 = document.createElement("a")
				r4.className = "btn icon"
				const params = new URLSearchParams({
					url: song.url,
					title: `${song.artist} – ${song.title}`,
				})
				r4.href = `https://radio4000.com/add?${params}`
				r4.target = "_blank"
				r4.rel = "noopener noreferrer"
				r4.setAttribute("aria-label", `Add ${song.title} to your Radio4000`)
				r4.textContent = "R4"
				actions.append(actionItem(r4))
			}

			actions.append(actionItem(remove))
			article.append(rank, figure, heading, artist, actions)
			li.append(article)
			items.push(li)
			return items
		})

		this.#list.replaceChildren(...nodes)
	}
}

customElements.define("top100-my-songs", Top100MySongs)

/** @deprecated use MAX_TOP */
const MAX_SONGS = MAX_TOP

export { STORAGE_KEY, MAX_TOP, MAX_SONGS, CHANGE_EVENT, PLAY_EVENT }
