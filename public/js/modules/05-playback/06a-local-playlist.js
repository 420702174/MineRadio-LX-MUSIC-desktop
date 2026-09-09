'use strict';

var LOCAL_PLAYLIST_STORE_KEY = 'mineradio-local-playlist-v1';
var LOCAL_PLAYLIST_ID = 'local-default';
var localPlaylistSwitchOpen = false;
var localPlaylistPreviousQueue = null;

function normalizeLocalPlaylistSongs(items) {
  var seen = Object.create(null);
  return (Array.isArray(items) ? items : []).map(function (song) {
    return cloneSong(song || {});
  }).filter(function (song, index) {
    var key = queueItemKey(song) || ('local-playlist:' + index);
    if (!song || !song.name || seen[key]) return false;
    seen[key] = true;
    song.localPlaylistAddedAt = Number(song.localPlaylistAddedAt) || Date.now();
    return true;
  }).slice(0, 500);
}

function readLocalPlaylistSongs() {
  try {
    var raw = JSON.parse(localStorage.getItem(LOCAL_PLAYLIST_STORE_KEY) || '[]');
    if (raw && Array.isArray(raw.songs)) raw = raw.songs;
    return normalizeLocalPlaylistSongs(raw);
  } catch (e) {
    return [];
  }
}

function saveLocalPlaylistSongs() {
  try {
    localStorage.setItem(LOCAL_PLAYLIST_STORE_KEY, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      songs: localPlaylistSongs.map(playbackRestoreSongSnapshot)
    }));
  } catch (e) { }
}

function localPlaylistCover() {
  var first = localPlaylistSongs[0];
  return first ? songCoverSrc(first, 120) : '';
}

function localPlaylistCatalogItem() {
  return {
    id: LOCAL_PLAYLIST_ID,
    provider: 'local',
    source: 'local',
    local: true,
    virtual: true,
    name: '本地歌单',
    creator: '无需登录',
    trackCount: localPlaylistSongs.length,
    cover: localPlaylistCover()
  };
}

function ensureLocalPlaylistCatalogPresence() {
  var next = [];
  var inserted = false;
  (userPlaylists || []).forEach(function (pl) {
    if (pl && pl.provider === 'local') {
      if (!inserted) {
        next.push(localPlaylistCatalogItem());
        inserted = true;
      }
      return;
    }
    next.push(pl);
  });
  if (!inserted) next.unshift(localPlaylistCatalogItem());
  userPlaylists = next;
  return true;
}

function addSongToLocalPlaylist(song) {
  if (!song || !song.name) return false;
  var copy = cloneSong(song);
  var key = queueItemKey(copy);
  var exists = key && localPlaylistSongs.some(function (item) { return queueItemKey(item) === key; });
  if (exists) {
    showToast('歌曲已在本地歌单中');
    return false;
  }
  copy.localPlaylistAddedAt = Date.now();
  localPlaylistSongs.unshift(copy);
  saveLocalPlaylistSongs();
  ensureLocalPlaylistCatalogPresence();
  playlistCatalogRevision += 1;
  renderLocalPlaylistSurfaces('local-playlist-add');
  showToast('已添加到本地歌单');
  return true;
}

function removeLocalPlaylistSong(index) {
  index = Number(index);
  if (!isFinite(index) || index < 0 || index >= localPlaylistSongs.length) return false;
  var removed = localPlaylistSongs[index];
  localPlaylistSongs.splice(index, 1);
  saveLocalPlaylistSongs();
  ensureLocalPlaylistCatalogPresence();
  playlistCatalogRevision += 1;
  renderLocalPlaylistSurfaces('local-playlist-remove');
  if (playlistPanelDetailState && playlistPanelDetailState.key === 'local:' + LOCAL_PLAYLIST_ID) {
    playlistPanelDetailState.tracks = localPlaylistSongs.map(cloneSong);
    playlistPanelDetailState.total = localPlaylistSongs.length;
    playlistPanelDetailState.message = localPlaylistSongs.length ? '' : '本地歌单还是空的，可以从搜索结果添加';
    renderPlaylistPanelDetailState();
  }
  showToast('已从本地歌单移除' + (removed && removed.name ? ': ' + removed.name : ''));
  return true;
}

function renderLocalPlaylistSurfaces(reason) {
  if (queueViewTab === 'playlists') renderUserPlaylistsList({ preserveScroll: true });
  renderLocalPlaylistSwitcher();
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild(reason || 'local-playlist', true);
  if (emptyHomeActive && typeof renderHomeDiscover === 'function') renderHomeDiscover();
}

function loadLocalPlaylistIntoQueue(autoplay, startIndex) {
  if (!localPlaylistSongs.length) {
    showToast('本地歌单还是空的，先从搜索结果里收藏几首');
    openPlaylistPanelTab('playlists', true);
    return false;
  }
  if (typeof cancelPlaylistQueueHydration === 'function') cancelPlaylistQueueHydration('local-playlist');
  if (!isCurrentQueueLocalPlaylist() && playQueue && playQueue.length) {
    var previousIndex = Number(currentIdx);
    localPlaylistPreviousQueue = {
      queue: playQueue.map(cloneSong),
      currentIdx: isFinite(previousIndex) ? Math.max(-1, previousIndex) : -1
    };
  }
  homeForcedOpen = false;
  homeSuppressed = false;
  updateEmptyHomeVisibility();
  playQueue = localPlaylistSongs.map(cloneSong);
  currentIdx = Math.max(0, Math.min(playQueue.length - 1, Number(startIndex) || 0));
  queueHydrationState = {
    token: (queueHydrationState && queueHydrationState.token || 0) + 1,
    active: false,
    loading: false,
    provider: 'local',
    playlistId: LOCAL_PLAYLIST_ID,
    sourceId: LOCAL_PLAYLIST_ID,
    title: '本地歌单',
    total: playQueue.length,
    nextOffset: playQueue.length,
    hasMore: false,
    loaded: playQueue.length,
    error: '',
    promise: null,
    timer: 0,
    queueRef: playQueue,
    warmPagesRemaining: 0,
    pausedForBuffer: false
  };
  safeRenderQueuePanel('local-playlist-load', { animate: true, scrollCurrent: true, deferWhenHidden: false });
  safeSwitchPlaylistTab('queue', 'local-playlist-load');
  safeShelfRebuild('local-playlist-load', true);
  renderLocalPlaylistSwitcher();
  if (autoplay) playQueueAt(currentIdx, { manual: true }).catch(function (e) { console.warn('[LocalPlaylistPlay]', e); });
  showToast('已切换到本地歌单');
  return true;
}

function isCurrentQueueLocalPlaylist() {
  return !!(queueHydrationState && queueHydrationState.provider === 'local' && queueHydrationState.queueRef === playQueue);
}

function markQueueAsManualPlaybackSource(reason) {
  if (isCurrentQueueLocalPlaylist()) {
    queueHydrationState = Object.assign({}, queueHydrationState, {
      active: false,
      loading: false,
      provider: '',
      playlistId: '',
      sourceId: '',
      title: '',
      total: playQueue.length,
      nextOffset: playQueue.length,
      hasMore: false,
      loaded: playQueue.length,
      queueRef: playQueue
    });
  }
  renderLocalPlaylistSwitcher();
}

function toggleLocalPlaylistSwitcher(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  localPlaylistSwitchOpen = !localPlaylistSwitchOpen;
  renderLocalPlaylistSwitcher();
}

function closeLocalPlaylistSwitcher() {
  if (!localPlaylistSwitchOpen) return;
  localPlaylistSwitchOpen = false;
  renderLocalPlaylistSwitcher();
}

function choosePlaybackListSource(source) {
  closeLocalPlaylistSwitcher();
  if (source === 'local') {
    loadLocalPlaylistIntoQueue(true, 0);
    return;
  }
  if (isCurrentQueueLocalPlaylist() && localPlaylistPreviousQueue && localPlaylistPreviousQueue.queue && localPlaylistPreviousQueue.queue.length) {
    if (typeof cancelPlaylistQueueHydration === 'function') cancelPlaylistQueueHydration('restore-before-local');
    playQueue = localPlaylistPreviousQueue.queue.map(cloneSong);
    currentIdx = Math.max(0, Math.min(playQueue.length - 1, Number(localPlaylistPreviousQueue.currentIdx) || 0));
    localPlaylistPreviousQueue = null;
    queueHydrationState = Object.assign({}, queueHydrationState || {}, {
      active: false,
      loading: false,
      provider: '',
      playlistId: '',
      sourceId: '',
      title: '',
      total: playQueue.length,
      nextOffset: playQueue.length,
      hasMore: false,
      loaded: playQueue.length,
      queueRef: playQueue
    });
    safeRenderQueuePanel('local-playlist-restore-queue', { animate: true, scrollCurrent: true, deferWhenHidden: false });
    safeShelfRebuild('local-playlist-restore-queue', true);
    renderLocalPlaylistSwitcher();
    playQueueAt(currentIdx, { manual: true }).catch(function (e) { console.warn('[LocalPlaylistRestoreQueue]', e); });
    showToast('已切回之前的队列');
    return;
  }
  openPlaylistPanelTab('queue', true);
  showToast('已切换到当前队列');
}

function localPlaylistSwitcherOptionHtml(source, title, sub, active, disabled) {
  return '<button class="playlist-source-option' + (active ? ' active' : '') + (disabled ? ' disabled' : '') + '" type="button" ' +
    (disabled ? 'disabled ' : '') + 'onclick="event.stopPropagation();choosePlaybackListSource(\'' + source + '\')">' +
    '<span class="playlist-source-dot"></span><span><b>' + escHtml(title) + '</b><small>' + escHtml(sub) + '</small></span></button>';
}

function renderLocalPlaylistSwitcher() {
  var wrap = document.getElementById('playlist-source-control');
  var label = document.getElementById('playlist-source-label');
  var pop = document.getElementById('playlist-source-popover');
  if (!wrap || !label || !pop) return;
  var localActive = isCurrentQueueLocalPlaylist();
  label.textContent = localActive ? '本地歌单' : '当前队列';
  wrap.classList.toggle('open', localPlaylistSwitchOpen);
  var currentSub = playQueue.length ? (playQueue.length + ' 首') : '空队列';
  var localSub = localPlaylistSongs.length ? (localPlaylistSongs.length + ' 首 · 无需登录') : '空歌单 · 从搜索添加';
  pop.innerHTML =
    '<div class="playlist-source-head">播放来源</div>' +
    localPlaylistSwitcherOptionHtml('queue', '当前队列', currentSub, !localActive, false) +
    localPlaylistSwitcherOptionHtml('local', '本地歌单', localSub, localActive, !localPlaylistSongs.length);
}

function openHomeLocalPlaylistManager() {
  homeForcedOpen = false;
  homeSuppressed = false;
  setHomeControlsLocked(false);
  ensureLocalPlaylistCatalogPresence();
  playlistCatalogRevision += 1;
  openPlaylistPanelTab('playlists', true);
  refreshUserPlaylists(false);
  if (typeof openPlaylistPanelDetail === 'function') {
    openPlaylistPanelDetail('local', LOCAL_PLAYLIST_ID, '本地歌单');
  }
}

localPlaylistSongs = readLocalPlaylistSongs();
ensureLocalPlaylistCatalogPresence();
renderLocalPlaylistSwitcher();
document.addEventListener('click', function (e) {
  if (localPlaylistSwitchOpen && !(e.target && e.target.closest && e.target.closest('#playlist-source-control'))) {
    closeLocalPlaylistSwitcher();
  }
});
