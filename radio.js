const STORAGE_POSITION = "top100-radio-position"
const STORAGE_COLLAPSED = "top100-radio-collapsed"
const CHANNEL_SLUG = "dktop100"

export class Top100Radio extends HTMLElement {
	#handle
	#toggle

	constructor() {
		super()
		this.setAttribute("aria-label", "Radio4000 player")
		this.innerHTML = `
      <div class="r4-handle">
        <a class="r4-channel" href="https://radio4000.com/${CHANNEL_SLUG}" target="_blank" rel="noopener noreferrer">Radio4000</a>
        <button type="button" class="r4-toggle" data-action="toggle" aria-label="Minimize player" aria-expanded="true">–</button>
      </div>
      <iframe class="r4-player" src="https://player.radio4000.com/v2/?slug=${CHANNEL_SLUG}"
        title="Radio4000 — ${CHANNEL_SLUG}" width="320" height="500" loading="lazy"></iframe>
    `

		this.#handle = this.querySelector(".r4-handle")
		this.#toggle = this.querySelector('[data-action="toggle"]')

		this.#toggle.addEventListener("click", () => this.toggle())

		this.#initDrag()
	}

	connectedCallback() {
		if (this.#readStoredCollapsed()) this.collapse(true)
	}

	#initDrag() {
		const stored = this.#readStoredPosition()
		if (stored) this.#moveTo(stored.x, stored.y)

		let pointerId = null
		let offsetX = 0
		let offsetY = 0

		const onMove = (event) => {
			if (event.pointerId !== pointerId) return
			this.#moveTo(event.clientX - offsetX, event.clientY - offsetY)
		}

		const onUp = (event) => {
			if (event.pointerId !== pointerId) return
			pointerId = null
			this.classList.remove("is-dragging")
			window.removeEventListener("pointermove", onMove)
			window.removeEventListener("pointerup", onUp)
			const rect = this.getBoundingClientRect()
			this.#writeStoredPosition(rect.left, rect.top)
		}

		// Only the handle is a drag grip; the channel link stays clickable.
		this.#handle.addEventListener("pointerdown", (event) => {
			if (event.target.closest("button, a")) return
			if (event.button !== 0 || pointerId !== null) return

			pointerId = event.pointerId
			const rect = this.getBoundingClientRect()
			offsetX = event.clientX - rect.left
			offsetY = event.clientY - rect.top
			this.classList.add("is-dragging")
			window.addEventListener("pointermove", onMove)
			window.addEventListener("pointerup", onUp)
		})
	}

	#moveTo(x, y) {
		const margin = 4
		const maxX = window.innerWidth - this.offsetWidth - margin
		const maxY = window.innerHeight - this.offsetHeight - margin
		const clampedX = Math.max(margin, Math.min(x, maxX))
		const clampedY = Math.max(margin, Math.min(y, maxY))
		this.style.left = `${clampedX}px`
		this.style.top = `${clampedY}px`
		this.style.right = "auto"
		this.style.bottom = "auto"
	}

	get collapsed() {
		return this.classList.contains("is-collapsed")
	}

	toggle() {
		this.collapse(!this.collapsed)
	}

	collapse(value) {
		const collapsed = Boolean(value)
		this.classList.toggle("is-collapsed", collapsed)
		this.#toggle.textContent = collapsed ? "+" : "–"
		this.#toggle.setAttribute("aria-expanded", String(!collapsed))
		this.#toggle.setAttribute("aria-label", collapsed ? "Expand player" : "Minimize player")
		this.#writeStoredCollapsed(collapsed)
	}

	#readStoredPosition() {
		try {
			const raw = localStorage.getItem(STORAGE_POSITION)
			if (!raw) return null
			const value = JSON.parse(raw)
			if (typeof value?.x === "number" && typeof value?.y === "number") return value
		} catch {
			// Ignore malformed/blocked storage.
		}
		return null
	}

	#writeStoredPosition(x, y) {
		try {
			localStorage.setItem(STORAGE_POSITION, JSON.stringify({ x, y }))
		} catch {
			// Ignore storage failures (private mode, quota).
		}
	}

	#readStoredCollapsed() {
		try {
			return localStorage.getItem(STORAGE_COLLAPSED) === "true"
		} catch {
			return false
		}
	}

	#writeStoredCollapsed(value) {
		try {
			localStorage.setItem(STORAGE_COLLAPSED, String(value))
		} catch {
			// Ignore storage failures (private mode, quota).
		}
	}
}

customElements.define("top100-radio", Top100Radio)
