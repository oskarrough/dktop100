import { initCanvas } from './canvas.js';
import './player.js';
import {
  addMySong,
  isInMySongs,
  isMySongsFull,
  CHANGE_EVENT,
} from './my-songs.js';

const summary = document.querySelector('#summary');
const list = document.querySelector('#songs');
const template = document.querySelector('#song-template');
const player = document.querySelector('top100-player');
const searchInput = document.querySelector('#search');
const searchWrap = document.querySelector('#search-wrap');

const datasets = {
  top100: { songs: [], meta: null },
  top400: { songs: [], meta: null },
};

let activeList = 'top100';
let queue = [];
let visibleIndices = [];
let currentIndex = -1;
let canvasView = null;
let filterQuery = '';

function isCanvasView() {
  return document.body.dataset.view === 'canvas';
}

function text(value) {
  return value == null ? '' : String(value);
}

function playable(song) {
  return Boolean(song?.media?.audio_url);
}

function youtubeUrl(song) {
  return song?.youtube?.url || null;
}

function currentSong() {
  return queue[currentIndex];
}

function sortSongs(listId, songs) {
  if (listId === 'top100') {
    return [...songs].sort((a, b) => b.rank - a.rank);
  }
  return [...songs].sort((a, b) =>
    text(a.title).localeCompare(text(b.title), 'da', { sensitivity: 'base' }),
  );
}

function songGroupLetter(song) {
  const title = text(song.title).trim();
  if (!title) return '#';
  const first = title[0].toUpperCase();
  if (/[A-ZÆØÅ]/.test(first)) return first;
  return '#';
}

function songMatchesFilter(song, query) {
  if (!query) return true;
  const haystack = `${song.title} ${song.artist}`.toLowerCase();
  return haystack.includes(query);
}

function rebuildVisibleIndices() {
  const query = filterQuery.trim().toLowerCase();
  visibleIndices = queue
    .map((song, index) => ({ song, index }))
    .filter(({ song }) => songMatchesFilter(song, query))
    .map(({ index }) => index);
}

function rankedTitle(song) {
  return song.rank ? `#${song.rank} ${text(song.title)}` : text(song.title);
}

// List heading: ranked in the Top 100, plain title in the Top 400 (the badge marks chart songs there).
function songHeading(song, listId) {
  return listId === 'top100' ? rankedTitle(song) : text(song.title);
}

// Player label: ranked for any chart song, in either list.
function songLabel(song, listId) {
  return listId === 'top100' || song.in_top100 ? rankedTitle(song) : text(song.title);
}

function updateSummary() {
  const meta = datasets[activeList].meta;
  const total = queue.length;
  const shown = visibleIndices.length;

  if (activeList === 'top100') {
    const range = meta?.rank_range;
    const rangeText = range ? `Ranks ${range.highest}–${range.lowest}` : '';
    summary.textContent = filterQuery
      ? `${shown} of ${total} chart songs match “${filterQuery}”. ${rangeText}`
      : `${total} chart songs. ${rangeText}`;
    return;
  }

  const chartCount = queue.filter((song) => song.in_top100).length;
  summary.textContent = filterQuery
    ? `${shown} of ${total} shortlist songs match “${filterQuery}”. ${chartCount} are on the chart.`
    : `${total} shortlist songs (alphabetical). ${chartCount} are on the chart.`;
}

function updateMySongButtons() {
  const full = isMySongsFull();

  document.querySelectorAll('.add-my-song').forEach((button) => {
    const songId = button.dataset.songId;
    const selected = songId && isInMySongs(songId);

    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));

    if (selected) {
      button.disabled = true;
      button.textContent = '✓';
      button.setAttribute('aria-label', 'In my picks');
    } else if (full) {
      button.disabled = true;
      button.textContent = '+';
      button.setAttribute('aria-label', 'My picks full (5 of 5)');
    } else {
      button.disabled = false;
      button.textContent = '+';
      button.setAttribute('aria-label', 'Add to my picks');
    }
  });
}

function updateListPlaybackState() {
  const song = currentSong();
  const isPlaying = !player.paused;

  document.querySelectorAll('.play-song').forEach((button) => {
    if (button.disabled) return;
    const isCurrent = Number(button.dataset.index) === currentIndex;
    const playing = isCurrent && isPlaying;
    button.classList.toggle('is-current', isCurrent);
    button.textContent = playing ? '⏸' : '▶';
    button.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
    button.setAttribute('aria-pressed', String(playing));
  });

  document.querySelectorAll('article.is-playing').forEach((article) => {
    article.classList.remove('is-playing');
  });
  if (song) {
    const currentArticle = list.querySelector(`[data-index="${currentIndex}"]`);
    currentArticle?.classList.add('is-playing');
  }
}

function updatePlayer() {
  const song = currentSong();

  player.syncPlayButton();

  updateListPlaybackState();

  if (!song) {
    player.resetDisplay();
    return;
  }

  if (canvasView && isCanvasView() && song.rank) {
    canvasView.focusRank(song.rank);
  }

  const image = song.image;
  player.setMetadata({
    title: songLabel(song, activeList),
    artist: text(song.artist),
    coverUrl: image?.url || null,
    coverAlt: image?.alt || `${text(song.title)} cover`,
    youtubeUrl: youtubeUrl(song),
  });
}

async function playIndex(index) {
  if (!queue[index] || !playable(queue[index])) return;

  const song = queue[index];
  currentIndex = index;

  player.load(song.media.audio_url);
  updatePlayer();

  try {
    await player.play();
  } catch (error) {
    summary.textContent = `Could not play preview: ${error.message}`;
  }

  updatePlayer();
}

function nextIndex(direction) {
  if (!visibleIndices.length) return -1;

  if (player.shuffle && direction > 0) {
    const pick = Math.floor(Math.random() * visibleIndices.length);
    return visibleIndices[pick];
  }

  const currentPos = visibleIndices.indexOf(currentIndex);
  const startPos = currentPos < 0 ? (direction > 0 ? -1 : 0) : currentPos;
  const nextPos = (startPos + direction + visibleIndices.length) % visibleIndices.length;
  return visibleIndices[nextPos];
}

function playNext() {
  playIndex(nextIndex(1));
}

function playPrevious() {
  playIndex(nextIndex(-1));
}

function togglePlay(index = currentIndex) {
  if (index === currentIndex && player.hasSource) {
    if (player.paused) player.play();
    else player.pause();
    return;
  }

  playIndex(index >= 0 ? index : nextIndex(1));
}

function renderSong(song, index) {
  const fragment = template.content.cloneNode(true);
  const li = fragment.querySelector('li');
  const article = fragment.querySelector('article');
  const heading = fragment.querySelector('h2');
  const artist = fragment.querySelector('.artist');
  const image = fragment.querySelector('img');
  const playSong = fragment.querySelector('.play-song');
  const addMySongButton = fragment.querySelector('.add-my-song');
  const ytLink = fragment.querySelector('.youtube-link');
  const funfact = fragment.querySelector('.funfact');
  const credits = fragment.querySelector('.credits');

  article.dataset.index = index;
  if (activeList === 'top100') {
    li.value = song.rank;
  } else {
    li.value = song.sequence;
  }

  heading.textContent = songHeading(song, activeList);
  if (activeList === 'top400' && song.in_top100 && song.rank) {
    const badge = document.createElement('span');
    badge.className = 'chart-badge';
    badge.textContent = `Chart #${song.rank}`;
    heading.append(' ', badge);
  }

  artist.textContent = text(song.artist);

  if (song.image?.url) {
    image.src = song.image.url;
    image.alt = song.image.alt || `${text(song.title)} cover`;
  } else {
    image.remove();
  }

  if (playable(song)) {
    playSong.dataset.index = index;
    playSong.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePlay(index);
    });
    article.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) return;
      togglePlay(index);
    });
    article.classList.add('playable');
  } else {
    playSong.disabled = true;
    playSong.setAttribute('aria-label', 'No preview');
  }

  if (song.id) {
    addMySongButton.dataset.songId = song.id;
    addMySongButton.addEventListener('click', (event) => {
      event.stopPropagation();
      addMySong(song, activeList);
    });
  } else {
    addMySongButton.remove();
  }

  const yt = youtubeUrl(song);
  if (yt) {
    ytLink.href = yt;
    ytLink.hidden = false;
    ytLink.addEventListener('click', (event) => event.stopPropagation());
  } else {
    ytLink.remove();
  }

  const funfactText = text(song.funfact);
  const creditsText = text(song.credits);
  if (funfactText) funfact.textContent = funfactText;
  else funfact.remove();
  if (creditsText) credits.textContent = creditsText;
  else credits.remove();

  return fragment;
}

function renderLetterHeader(letter) {
  const li = document.createElement('li');
  li.className = 'letter-header';
  const divider = document.createElement('div');
  divider.className = 'letter-divider';
  divider.textContent = letter;
  li.append(divider);
  return li;
}

function renderList() {
  rebuildVisibleIndices();
  const nodes = [];
  let lastLetter = null;

  for (const index of visibleIndices) {
    const song = queue[index];
    if (activeList === 'top400') {
      const letter = songGroupLetter(song);
      if (letter !== lastLetter) {
        nodes.push(renderLetterHeader(letter));
        lastLetter = letter;
      }
    }
    nodes.push(renderSong(song, index));
  }

  list.replaceChildren(...nodes);
  updateSummary();
  updatePlayer();
  updateMySongButtons();
}

function resetCanvas() {
  canvasView = null;
}

function setList(listId) {
  if (!datasets[listId]?.songs?.length) return;

  activeList = listId;
  document.body.dataset.list = listId;
  localStorage.setItem('top100-list', listId);
  queue = datasets[listId].songs;
  currentIndex = -1;
  player.clear();
  filterQuery = '';
  searchInput.value = '';

  document.querySelectorAll('.lists [data-list]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.list === listId));
  });

  const canvasButton = document.querySelector('.views [data-view="canvas"]');
  if (listId === 'top400') {
    canvasButton.hidden = true;
    if (isCanvasView()) setView('list');
  } else {
    canvasButton.hidden = false;
  }

  searchWrap.hidden = false;
  resetCanvas();
  renderList();
}

function setView(view) {
  if (activeList === 'top400' && view === 'canvas') view = 'list';

  document.body.dataset.view = view;
  localStorage.setItem('top100-view', view);

  document.querySelectorAll('.views [data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  });

  document.querySelector('#canvas-view').hidden = view !== 'canvas';

  if (view === 'canvas') {
    if (!canvasView && queue.length) {
      canvasView = initCanvas(document.querySelector('#field'), queue, {
        onSelect: (song) => playIndex(queue.indexOf(song)),
        isActive: isCanvasView,
      });
    }
    if (canvasView) {
      canvasView.resize();
      const song = currentSong();
      if (song?.rank) canvasView.focusRank(song.rank);
    }
  }
}

async function loadDataset(url, listId) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  const data = await response.json();
  datasets[listId] = {
    meta: data,
    songs: sortSongs(listId, data.songs || []),
  };
}

async function init() {
  try {
    await Promise.all([
      loadDataset('top100.json', 'top100'),
      loadDataset('top400.json', 'top400'),
    ]);

    const savedList = localStorage.getItem('top100-list');
    setList(savedList === 'top400' ? 'top400' : 'top100');
    setView(localStorage.getItem('top100-view') || 'list');
  } catch (error) {
    summary.textContent = error.message;
  }
}

document.querySelectorAll('.lists [data-list]').forEach((button) => {
  button.addEventListener('click', () => setList(button.dataset.list));
});

document.querySelectorAll('.views [data-view]').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

searchInput.addEventListener('input', () => {
  filterQuery = searchInput.value;
  renderList();
});

player.addEventListener('toggle', () => togglePlay());
player.addEventListener('prev', playPrevious);
player.addEventListener('next', playNext);
player.addEventListener('play', updateListPlaybackState);
player.addEventListener('pause', updateListPlaybackState);
player.addEventListener('ended', playNext);

document.addEventListener(CHANGE_EVENT, updateMySongButtons);

document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea, select, button, a')) return;

  if (event.key === ' ') {
    event.preventDefault();
    togglePlay();
  } else if (event.key === 'ArrowLeft') {
    playPrevious();
  } else if (event.key === 'ArrowRight') {
    playNext();
  }
});

init();
