export class Top100Player extends HTMLElement {
  #audio;
  #cover;
  #title;
  #artist;
  #playButton;
  #shuffleButton;
  #youtubeLink;
  #shuffle = false;

  constructor() {
    super();
    this.setAttribute('aria-label', 'Global player');
    this.innerHTML = `
      <div class="player-screen">
        <img class="player-cover" alt="" hidden>
        <div class="player-meta" aria-live="polite">
          <div class="player-title">Pick a song</div>
          <div class="player-artist">30 sec previews · DR</div>
        </div>
        <a class="player-youtube" href="#" target="_blank" rel="noopener noreferrer" hidden>▷ YouTube</a>
      </div>
      <menu class="player-controls">
        <button type="button" class="btn pad pad-prev" data-action="prev" aria-label="Previous song">⏮</button>
        <button type="button" class="btn pad pad-play" data-action="play" aria-label="Play">▶</button>
        <button type="button" class="btn pad pad-next" data-action="next" aria-label="Next song">⏭</button>
        <button type="button" class="btn pad pad-shuffle" data-action="shuffle" aria-pressed="false" aria-label="Shuffle">⤮</button>
      </menu>
      <audio preload="none"></audio>
    `;

    this.#cover = this.querySelector('.player-cover');
    this.#title = this.querySelector('.player-title');
    this.#artist = this.querySelector('.player-artist');
    this.#playButton = this.querySelector('[data-action="play"]');
    this.#shuffleButton = this.querySelector('[data-action="shuffle"]');
    this.#youtubeLink = this.querySelector('.player-youtube');
    this.#audio = this.querySelector('audio');

    this.querySelector('[data-action="prev"]').addEventListener('click', () => {
      this.dispatchEvent(new Event('prev', { bubbles: true }));
    });
    this.querySelector('[data-action="next"]').addEventListener('click', () => {
      this.dispatchEvent(new Event('next', { bubbles: true }));
    });
    this.#playButton.addEventListener('click', () => {
      this.dispatchEvent(new Event('toggle', { bubbles: true }));
    });
    this.#shuffleButton.addEventListener('click', () => {
      this.shuffle = !this.shuffle;
    });

    this.#audio.addEventListener('play', () => {
      this.#updatePlayButton();
      this.dispatchEvent(new Event('play', { bubbles: true }));
    });
    this.#audio.addEventListener('pause', () => {
      this.#updatePlayButton();
      this.dispatchEvent(new Event('pause', { bubbles: true }));
    });
    this.#audio.addEventListener('ended', () => {
      this.dispatchEvent(new Event('ended', { bubbles: true }));
    });

    this.#initDrag();
  }

  #initDrag() {
    const stored = this.#readStoredPosition();
    if (stored) this.#moveTo(stored.x, stored.y);

    let pointerId = null;
    let offsetX = 0;
    let offsetY = 0;

    const onMove = (event) => {
      if (event.pointerId !== pointerId) return;
      this.#moveTo(event.clientX - offsetX, event.clientY - offsetY);
    };

    const onUp = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      this.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const rect = this.getBoundingClientRect();
      this.#writeStoredPosition(rect.left, rect.top);
    };

    this.addEventListener('pointerdown', (event) => {
      // Let the controls work normally — only the body is a drag handle.
      if (event.target.closest('button, a')) return;
      if (event.button !== 0 || pointerId !== null) return;

      pointerId = event.pointerId;
      const rect = this.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      this.classList.add('is-dragging');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  #moveTo(x, y) {
    const margin = 4;
    const maxX = window.innerWidth - this.offsetWidth - margin;
    const maxY = window.innerHeight - this.offsetHeight - margin;
    const clampedX = Math.max(margin, Math.min(x, maxX));
    const clampedY = Math.max(margin, Math.min(y, maxY));
    this.style.left = `${clampedX}px`;
    this.style.top = `${clampedY}px`;
    this.style.right = 'auto';
    this.style.bottom = 'auto';
  }

  #readStoredPosition() {
    try {
      const raw = localStorage.getItem('top100-player-position');
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (typeof value?.x === 'number' && typeof value?.y === 'number') return value;
    } catch {
      // Ignore malformed/blocked storage.
    }
    return null;
  }

  #writeStoredPosition(x, y) {
    try {
      localStorage.setItem('top100-player-position', JSON.stringify({ x, y }));
    } catch {
      // Ignore storage failures (private mode, quota).
    }
  }

  get audio() {
    return this.#audio;
  }

  get shuffle() {
    return this.#shuffle;
  }

  set shuffle(value) {
    this.#shuffle = Boolean(value);
    this.#shuffleButton.setAttribute('aria-pressed', String(this.#shuffle));
  }

  get paused() {
    return this.#audio.paused;
  }

  get hasSource() {
    return Boolean(this.#audio.src);
  }

  #updatePlayButton() {
    const isPlaying = !this.#audio.paused;
    this.#playButton.textContent = isPlaying ? '⏸' : '▶';
    this.#playButton.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  resetDisplay() {
    this.#title.textContent = 'Pick a song';
    this.#artist.textContent = '30 second previews from DR';
    this.#cover.hidden = true;
    this.#cover.removeAttribute('src');
    this.#youtubeLink.hidden = true;
    this.#youtubeLink.removeAttribute('href');
    this.#updatePlayButton();
  }

  clear() {
    this.#audio.pause();
    this.#audio.removeAttribute('src');
    this.resetDisplay();
  }

  setMetadata({ title, artist, coverUrl, coverAlt, youtubeUrl }) {
    this.#title.textContent = title;
    this.#artist.textContent = artist;

    if (coverUrl) {
      this.#cover.src = coverUrl;
      this.#cover.alt = coverAlt || '';
      this.#cover.hidden = false;
    } else {
      this.#cover.hidden = true;
      this.#cover.removeAttribute('src');
    }

    if (youtubeUrl) {
      this.#youtubeLink.href = youtubeUrl;
      this.#youtubeLink.hidden = false;
    } else {
      this.#youtubeLink.hidden = true;
      this.#youtubeLink.removeAttribute('href');
    }
  }

  load(audioUrl) {
    if (this.#audio.src !== audioUrl) {
      this.#audio.src = audioUrl;
    }
  }

  async play() {
    return this.#audio.play();
  }

  pause() {
    this.#audio.pause();
  }

  syncPlayButton() {
    this.#updatePlayButton();
  }
}

customElements.define('top100-player', Top100Player);
