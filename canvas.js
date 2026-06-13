// Canvas field of covers — golden-angle spiral, slot #1 in the center.
// Drag to pan, scroll/pinch to zoom, click a cover to play via the shared player.
// itemCount: spiral slots (100 for Top 100). getSlot(song, index) → 1-based slot.

const COVER = 120 // world size of one cover
const GOLDEN = Math.PI * (3 - Math.sqrt(5))
const SPIRAL = COVER * 0.78 // spiral spacing factor

export function initCanvas(canvas, songs, { onSelect, isActive, itemCount, getSlot }) {
	const ctx = canvas.getContext("2d")

	let focused = null

	// Camera: world point at screen center + zoom.
	const cam = { x: 0, y: 0, zoom: 0.6 }
	const camTarget = { x: 0, y: 0, zoom: 0.6 }

	function spiralPosition(slot) {
		const angle = slot * GOLDEN
		const radius = SPIRAL * Math.sqrt(slot)
		return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
	}

	const bySlot = new Map(songs.map((song, index) => [getSlot(song, index), song]))
	const items = []
	for (let slot = 1; slot <= itemCount; slot++) {
		const { x, y } = spiralPosition(slot)
		items.push({
			slot,
			song: bySlot.get(slot) || null,
			x,
			y,
			phase: slot * 2.39996,
			img: null,
			imgReady: false,
		})
	}

	for (const item of items) {
		if (!item.song?.image?.url) continue
		const img = new Image()
		img.decoding = "async"
		img.src = item.song.image.url
		img.onload = () => {
			item.imgReady = true
		}
		item.img = img
	}

	// --- coordinate helpers ---

	function drift(item, time) {
		return {
			x: item.x + Math.sin(time * 0.0003 + item.phase) * 8,
			y: item.y + Math.cos(time * 0.00023 + item.phase * 1.7) * 8,
		}
	}

	function worldToScreen(wx, wy) {
		return {
			x: (wx - cam.x) * cam.zoom + canvas.clientWidth / 2,
			y: (wy - cam.y) * cam.zoom + canvas.clientHeight / 2,
		}
	}

	function screenToWorld(sx, sy) {
		return {
			x: (sx - canvas.clientWidth / 2) / cam.zoom + cam.x,
			y: (sy - canvas.clientHeight / 2) / cam.zoom + cam.y,
		}
	}

	function hitTest(sx, sy, time) {
		const world = screenToWorld(sx, sy)
		let best = null
		let bestDist = Infinity
		for (const item of items) {
			const pos = drift(item, time)
			const dx = Math.abs(world.x - pos.x)
			const dy = Math.abs(world.y - pos.y)
			const half = COVER / 2
			if (dx < half && dy < half) {
				const dist = dx * dx + dy * dy
				if (dist < bestDist) {
					bestDist = dist
					best = item
				}
			}
		}
		return best
	}

	// --- render loop ---

	function resize() {
		const dpr = Math.min(devicePixelRatio || 1, 2)
		canvas.width = canvas.clientWidth * dpr
		canvas.height = canvas.clientHeight * dpr
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
	}

	function render(time) {
		requestAnimationFrame(render)
		if (!isActive()) return

		// Ease camera toward its target.
		cam.x += (camTarget.x - cam.x) * 0.12
		cam.y += (camTarget.y - cam.y) * 0.12
		cam.zoom += (camTarget.zoom - cam.zoom) * 0.12

		const w = canvas.clientWidth
		const h = canvas.clientHeight
		ctx.clearRect(0, 0, w, h)

		const size = COVER * cam.zoom
		const margin = size

		for (const item of items) {
			const pos = drift(item, time)
			const screen = worldToScreen(pos.x, pos.y)
			if (screen.x < -margin || screen.x > w + margin) continue
			if (screen.y < -margin || screen.y > h + margin) continue

			const isFocused = item === focused
			const scale = isFocused ? 1.15 : 1
			const s = size * scale
			const x = screen.x - s / 2
			const y = screen.y - s / 2

			if (item.imgReady) {
				ctx.drawImage(item.img, x, y, s, s)
			} else {
				// Placeholder: unrevealed top 20 or image still loading.
				ctx.fillStyle = item.song ? "#1c1c22" : "#141418"
				ctx.fillRect(x, y, s, s)
				ctx.strokeStyle = "rgb(255 255 255 / .08)"
				ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1)
				ctx.fillStyle = item.song ? "#555" : "#3a3a44"
				ctx.font = `700 ${Math.max(s * 0.3, 8)}px system-ui, sans-serif`
				ctx.textAlign = "center"
				ctx.textBaseline = "middle"
				ctx.fillText(item.song ? `#${item.slot}` : "?", screen.x, screen.y)
			}

			if (isFocused) {
				ctx.strokeStyle = "#f4d35e"
				ctx.lineWidth = 3
				ctx.strokeRect(x - 1.5, y - 1.5, s + 3, s + 3)
				ctx.lineWidth = 1
			}

			// Rank label once zoomed in enough to read it.
			if (item.imgReady && size > 70) {
				ctx.fillStyle = "rgb(0 0 0 / .65)"
				const label = `#${item.slot}`
				ctx.font = `700 ${size * 0.14}px system-ui, sans-serif`
				ctx.textAlign = "left"
				ctx.textBaseline = "top"
				const pad = size * 0.04
				const metrics = ctx.measureText(label)
				ctx.fillRect(x, y, metrics.width + pad * 2, size * 0.14 + pad * 2)
				ctx.fillStyle = "#fff"
				ctx.fillText(label, x + pad, y + pad)
			}
		}
	}

	// --- focus ---

	function focusSlot(slot) {
		const item = items[slot - 1]
		if (!item?.song) return
		focused = item

		const pos = drift(item, performance.now())
		camTarget.x = pos.x
		camTarget.y = pos.y
		camTarget.zoom = Math.max(camTarget.zoom, 2.2)
	}

	function blur() {
		focused = null
		camTarget.zoom = 0.6
	}

	// --- input ---

	let dragging = false
	let moved = false
	let last = { x: 0, y: 0 }
	const pointers = new Map()
	let pinchDist = 0

	canvas.addEventListener("pointerdown", (event) => {
		canvas.setPointerCapture(event.pointerId)
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
		dragging = true
		moved = false
		last = { x: event.clientX, y: event.clientY }
		canvas.classList.add("dragging")
	})

	canvas.addEventListener("pointermove", (event) => {
		if (pointers.has(event.pointerId)) {
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
		}

		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()]
			const dist = Math.hypot(a.x - b.x, a.y - b.y)
			if (pinchDist) applyZoom(dist / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2)
			pinchDist = dist
			moved = true
			return
		}
		pinchDist = 0

		if (dragging) {
			const dx = event.clientX - last.x
			const dy = event.clientY - last.y
			if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
			camTarget.x -= dx / cam.zoom
			camTarget.y -= dy / cam.zoom
			cam.x = camTarget.x
			cam.y = camTarget.y
			last = { x: event.clientX, y: event.clientY }
		} else {
			const hit = hitTest(event.clientX, event.clientY, performance.now())
			canvas.classList.toggle("pointing", Boolean(hit?.song))
		}
	})

	canvas.addEventListener("pointerup", (event) => {
		pointers.delete(event.pointerId)
		pinchDist = 0
		dragging = pointers.size > 0
		canvas.classList.remove("dragging")

		if (!moved) {
			const hit = hitTest(event.clientX, event.clientY, performance.now())
			if (hit?.song) onSelect(hit.song)
			else if (focused) blur()
		}
	})

	canvas.addEventListener("pointercancel", (event) => {
		pointers.delete(event.pointerId)
		pinchDist = 0
		dragging = pointers.size > 0
		canvas.classList.remove("dragging")
	})

	function applyZoom(factor, sx, sy) {
		const before = screenToWorld(sx, sy)
		camTarget.zoom = Math.min(Math.max(camTarget.zoom * factor, 0.15), 6)
		cam.zoom = camTarget.zoom
		const after = screenToWorld(sx, sy)
		camTarget.x += before.x - after.x
		camTarget.y += before.y - after.y
		cam.x = camTarget.x
		cam.y = camTarget.y
	}

	canvas.addEventListener(
		"wheel",
		(event) => {
			event.preventDefault()
			applyZoom(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY)
		},
		{ passive: false },
	)

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && isActive()) blur()
	})

	// --- boot ---

	resize()
	addEventListener("resize", resize)

	// Start looking at the outer ring where most covers live.
	const start = spiralPosition(Math.round(itemCount * 0.6))
	cam.x = camTarget.x = start.x
	cam.y = camTarget.y = start.y

	requestAnimationFrame(render)

	return { focusSlot, blur, resize }
}
