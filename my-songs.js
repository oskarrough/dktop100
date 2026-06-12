const STORAGE_KEY = 'top100-my-songs';
const MAX_SONGS = 5;
const CHANGE_EVENT = 'top100-my-songs-change';

let songs = loadFromStorage();

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SONGS) : [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  document.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
    detail: { songs: getMySongs() },
  }));
}

function songEntry(song, listId) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    rank: song.rank ?? null,
    listId: listId || null,
  };
}

export function getMySongs() {
  return [...songs];
}

export function isInMySongs(id) {
  return songs.some((song) => song.id === id);
}

export function isMySongsFull() {
  return songs.length >= MAX_SONGS;
}

export function addMySong(song, listId) {
  if (!song?.id || isInMySongs(song.id) || isMySongsFull()) return false;
  songs.push(songEntry(song, listId));
  persist();
  return true;
}

export function removeMySong(id) {
  const before = songs.length;
  songs = songs.filter((song) => song.id !== id);
  if (songs.length === before) return false;
  persist();
  return true;
}

function songLabel(song) {
  if (song.rank) return `#${song.rank} ${song.title}`;
  return song.title;
}

export class Top100MySongs extends HTMLElement {
  #list;
  #status;
  #onChange;
  #onStorage;

  constructor() {
    super();
    this.setAttribute('aria-label', 'My song picks');
    this.innerHTML = `
      <header class="my-songs-header">
        <h2 class="my-songs-title">My picks</h2>
        <p class="my-songs-status"></p>
      </header>
      <ol class="my-songs-list"></ol>
      <p class="my-songs-empty" hidden>Pick up to 5 favorites from the list below.</p>
    `;
    this.#list = this.querySelector('.my-songs-list');
    this.#status = this.querySelector('.my-songs-status');

    this.#list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-id]');
      if (!button) return;
      removeMySong(button.dataset.removeId);
    });
  }

  connectedCallback() {
    this.#render();
    this.#onChange = () => this.#render();
    document.addEventListener(CHANGE_EVENT, this.#onChange);
    this.#onStorage = (event) => {
      if (event.key !== STORAGE_KEY) return;
      songs = loadFromStorage();
      this.#render();
    };
    window.addEventListener('storage', this.#onStorage);
  }

  disconnectedCallback() {
    document.removeEventListener(CHANGE_EVENT, this.#onChange);
    window.removeEventListener('storage', this.#onStorage);
  }

  #render() {
    const count = songs.length;
    this.#status.textContent = `${count} / ${MAX_SONGS}`;

    const empty = this.querySelector('.my-songs-empty');
    empty.hidden = count > 0;

    this.#list.replaceChildren(...songs.map((song) => {
      const li = document.createElement('li');
      const article = document.createElement('article');
      article.className = 'my-song-item';

      const heading = document.createElement('h3');
      heading.textContent = songLabel(song);

      const artist = document.createElement('p');
      artist.className = 'my-song-artist';
      artist.textContent = song.artist || '';

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn remove-my-song';
      remove.dataset.removeId = song.id;
      remove.setAttribute('aria-label', `Remove ${song.title} from my picks`);
      remove.textContent = 'Remove';

      article.append(heading, artist, remove);
      li.append(article);
      return li;
    }));
  }
}

customElements.define('top100-my-songs', Top100MySongs);

export { STORAGE_KEY, MAX_SONGS, CHANGE_EVENT };
