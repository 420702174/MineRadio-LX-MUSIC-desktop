var lxSourceUiState = {
  loaded: false,
  loading: false,
  sources: [],
};

// 短时缓存：相同 song key 的 LX 接管候选缓存 3 分钟
var LX_FALLBACK_CACHE_TTL_MS = 3 * 60 * 1000;
var lxFallbackSongCache = Object.create(null);
var lxFallbackSongCacheQueue = [];

function lxFallbackSongKey(song) {
  if (!song) return '';
  var title = String(song.name || song.title || '').trim().toLowerCase();
  var artist = String(song.artist || '').trim().toLowerCase();
  var provider = songProviderKey(song);
  return provider + '|' + title + '|' + artist;
}

function lxFallbackCacheGet(key) {
  if (!key) return undefined;
  var entry = lxFallbackSongCache[key];
  console.log('[lxFallbackCacheGet] key:', key, 'entry:', entry, 'cache对象:', lxFallbackSongCache);
  if (!entry) return undefined;  // 修复：无缓存时返回 undefined，而不是 null
  if (Date.now() - entry.fetchedAt > LX_FALLBACK_CACHE_TTL_MS) {
    delete lxFallbackSongCache[key];
    return undefined;  // 修复：过期时返回 undefined
  }
  console.log('[lxFallbackCacheGet] 返回 entry.data:', entry.data);
  return entry.data;  // 这里会返回 null（负缓存）或实际数据
}

function lxFallbackCacheSet(key, data) {
  if (!key) return;
  lxFallbackSongCache[key] = { fetchedAt: Date.now(), data: data || null };
  lxFallbackSongCacheQueue.push(key);
  while (lxFallbackSongCacheQueue.length > 32) {
    var evict = lxFallbackSongCacheQueue.shift();
    if (evict && lxFallbackSongCache[evict]) delete lxFallbackSongCache[evict];
  }
}

// 在 LX 源中按原平台搜索并解析首个可播放 URL。
// 用于 VIP/试听/登录场景的接管：先返回解析结果，失败返回 null。
async function searchLxCandidateForSong(song, opts) {
  opts = opts || {};
  if (!song) return null;
  if (typeof lxSourcesAvailable === 'function' && !lxSourcesAvailable()) return null;
  var provider = normalizePlaybackProvider(songProviderKey(song));
  var eligible = ['netease', 'qq', 'kugou', 'qishui', 'spotify'];
  if (eligible.indexOf(provider) < 0) return null;
  var cacheKey = lxFallbackSongKey(song);
  if (!opts.skipCache) {
    var cached = lxFallbackCacheGet(cacheKey);
    console.log('[searchLxCandidateForSong] 缓存检查:', { cacheKey, cached: cached === null ? 'null(负结果)' : cached ? '有结果' : 'undefined(无缓存)' });
    if (cached === null) {
      console.log('[searchLxCandidateForSong] ⚠️ 命中负缓存，直接返回null');
      return null;       // 已缓存负结果
    }
    if (cached && cached.url) return cached; // 命中正结果
  }
  console.log('[searchLxCandidateForSong] 准备调用 /api/lx/search-and-url');
  var songPayload = {
    name: song.name || song.title || '',
    artist: song.artist || song.artistName || '',
    artists: Array.isArray(song.artists) ? song.artists : (Array.isArray(song.ar) ? song.ar : []),
    album: song.album || song.albumName || '',
    duration: song.duration || song.durationMs || song.dt || 0,
  };
  var requestedQuality = '';
  try {
    if (typeof getProviderPlaybackQuality === 'function') {
      requestedQuality = normalizePlaybackQualityForProvider(getProviderPlaybackQuality(provider), provider);
    }
  } catch (_) { requestedQuality = ''; }
  var response;
  try {
    console.log('[searchLxCandidateForSong] 发起 fetch 请求到 /api/lx/search-and-url');
    console.log('[searchLxCandidateForSong] 请求参数:', { source: provider, song: songPayload, quality: requestedQuality });
    response = await apiJson('/api/lx/search-and-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: provider, song: songPayload, quality: requestedQuality }),
      timeoutMs: 20000,  // 修复：从9秒增加到20秒，因为LX音源可能需要尝试多个音质
    });
    console.log('[searchLxCandidateForSong] 收到响应:', response);
  } catch (err) {
    console.warn('[LXFallbackSearch]', err);
    lxFallbackCacheSet(cacheKey, null);
    return null;
  }
  if (!response || !response.url) {
    lxFallbackCacheSet(cacheKey, null);
    return null;
  }
  var candidate = {
    provider: 'lx',
    source: 'lx',
    url: response.url,
    level: response.quality || requestedQuality || '',
    quality: response.quality || requestedQuality || '',
    headers: response.headers || {},
    proxyContextToken: response.proxyContextToken || '',
    lxSourceScriptId: response.scriptId || '',
    lxSourceName: response.scriptName || response.sourceLabel || '',
    lxOriginSource: (response.matchedSong && response.matchedSong.source) || response.source || '',
    matchedSong: response.matchedSong || null,
  };
  lxFallbackCacheSet(cacheKey, candidate);
  return candidate;
}

// 让 source fallback 在尝试平台换源前能主动清除缓存
function invalidateLxFallbackCacheForSong(song) {
  var key = lxFallbackSongKey(song);
  if (key && lxFallbackSongCache[key]) delete lxFallbackSongCache[key];
}

function lxSourceDisplayName(song) {
  song = song || {};
  return String(song.lxSourceName || song.sourceName || 'LX 音源').trim() || 'LX 音源';
}

function lxSourceSubLabel(song) {
  song = song || {};
  var origin = String(song.lxOriginSource || '').trim().toUpperCase();
  return origin ? (lxSourceDisplayName(song) + ' · ' + origin) : lxSourceDisplayName(song);
}

function lxSourcesAvailable() {
  return !!(lxSourceUiState.sources || []).filter(function (item) {
    return item && item.enabled !== false && item.initStatus === 'ready';
  }).length;
}

async function fetchLxSources(force) {
  if (lxSourceUiState.loading && !force) return lxSourceUiState.sources || [];
  lxSourceUiState.loading = true;
  try {
    var response = await apiJson('/api/lx/sources?t=' + Date.now(), { timeoutMs: 6000 });
    lxSourceUiState.sources = Array.isArray(response && response.sources) ? response.sources : [];
    lxSourceUiState.loaded = true;
    return lxSourceUiState.sources;
  } catch (e) {
    console.warn('[LXSourceList]', e);
    if (!lxSourceUiState.loaded) lxSourceUiState.sources = [];
    return lxSourceUiState.sources;
  } finally {
    lxSourceUiState.loading = false;
    renderLxSourceSummary();
  }
}

function renderLxSourceSummary() {
  var badge = document.getElementById('lx-source-entry-note');
  if (!badge) return;
  var ready = (lxSourceUiState.sources || []).filter(function (item) { return item && item.enabled !== false && item.initStatus === 'ready'; }).length;
  var total = (lxSourceUiState.sources || []).length;
  badge.textContent = total ? (ready + '/' + total + ' 已启用') : '未导入';
}

function lxSourceStatusText(item) {
  if (!item) return '未导入';
  if (item.initStatus === 'ready') return item.enabled === false ? '已禁用' : '已就绪';
  if (item.initStatus === 'error') return '初始化失败';
  return '待加载';
}

function lxSourceCapabilityText(item) {
  if (!item || item.initStatus !== 'ready') return '';
  if (item.searchEnabled) return item.urlResolveEnabled ? '可搜索 / 可解析' : '可搜索';
  if (item.urlResolveEnabled) return '仅解析';
  return '能力未知';
}

function lxSourceRowHtml(item, index) {
  var disabled = item && item.enabled === false;
  var sources = Array.isArray(item && item.supportedSources) ? item.supportedSources.join(' / ').toUpperCase() : '';
  return '<div class="lx-source-row' + (disabled ? ' disabled' : '') + '">' +
    '<label class="lx-source-checkbox">' +
    '<input type="checkbox" class="lx-source-select" data-id="' + escHtml(item.id) + '" onchange="updateLxSourceSelection()">' +
    '</label>' +
    '<div class="lx-source-meta">' +
    '<div class="lx-source-title">' + escHtml(item.name || 'LX 音源') + '<span class="lx-source-state">' + escHtml(lxSourceStatusText(item)) + '</span></div>' +
    '<div class="lx-source-sub">' + escHtml([item.version, sources, item.author, lxSourceCapabilityText(item)].filter(Boolean).join('  · ')) + '</div>' +
    (item.initError ? '<div class="lx-source-error">' + escHtml(item.initError) + '</div>' : '') +
    '</div>' +
    '<div class="lx-source-actions">' +
    '<button class="modal-btn" type="button" onclick="moveLxSource(' + index + ', -1)" ' + (index <= 0 ? 'disabled ' : '') + '>上移</button>' +
    '<button class="modal-btn" type="button" onclick="moveLxSource(' + index + ', 1)" ' + (index >= lxSourceUiState.sources.length - 1 ? 'disabled ' : '') + '>下移</button>' +
    '<button class="modal-btn" type="button" onclick="reloadLxSource(\'' + escHtml(item.id) + '\')">重载</button>' +
    '<button class="modal-btn" type="button" onclick="toggleLxSource(\'' + escHtml(item.id) + '\',' + (disabled ? 'true' : 'false') + ')">' + (disabled ? '启用' : '禁用') + '</button>' +
    '<button class="modal-btn primary" type="button" onclick="removeLxSource(\'' + escHtml(item.id) + '\')">删除</button>' +
    '</div>' +
    '</div>';
}

function renderLxSourceList() {
  var list = document.getElementById('lx-source-list');
  if (!list) return;
  var hasSources = (lxSourceUiState.sources || []).length > 0;
  list.innerHTML = hasSources
    ? lxSourceUiState.sources.map(lxSourceRowHtml).join('')
    : '<div class="lx-source-empty">还没有导入 LX 自定义音源</div>';
  renderLxSourceSummary();
  // 显示/隐藏批量操作区域
  var batchActions = document.getElementById('lx-source-batch-actions');
  if (batchActions) {
    batchActions.style.display = hasSources ? 'block' : 'none';
  }
  updateLxSourceSelection();
}

async function refreshLxSourceList(force) {
  await fetchLxSources(force);
  renderLxSourceList();
}

function openLxSourceModal() {
  openGsapModal(document.getElementById('lx-source-modal'));
  refreshLxSourceList(true);
}

function closeLxSourceModal() {
  closeGsapModal(document.getElementById('lx-source-modal'));
}

async function postLxSource(url, payload, successText) {
  var response = await apiJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    timeoutMs: 12000,
  });
  if (!response || response.ok === false) throw new Error(response && (response.error || response.message) || 'LX_SOURCE_REQUEST_FAILED');
  lxSourceUiState.sources = Array.isArray(response.sources) ? response.sources : lxSourceUiState.sources;
  renderLxSourceList();
  if (successText) showToast(successText);
  return response;
}

async function importLxSourceFromFile() {
  if (!window.desktopWindow || typeof window.desktopWindow.chooseLxSourceFile !== 'function') {
    showToast('当前环境不支持本地音源文件导入');
    return;
  }
  var picked = await window.desktopWindow.chooseLxSourceFile();
  if (!picked || picked.ok === false || picked.canceled) return;

  // 支持批量导入：picked.files 是文件数组
  var files = Array.isArray(picked.files) ? picked.files : (picked.text ? [{ filePath: picked.filePath || '', text: picked.text }] : []);

  if (files.length === 0) return;

  var successCount = 0;
  var failCount = 0;
  var failedFiles = [];

  for (var i = 0; i < files.length; i++) {
    try {
      await postLxSource('/api/lx/source/import-file', {
        sourcePath: files[i].filePath || '',
        rawScript: files[i].text || '',
      }, null);
      successCount++;
    } catch (e) {
      console.warn('导入音源失败:', files[i].filePath, e);
      failCount++;
      failedFiles.push({
        name: files[i].name || files[i].filePath,
        error: e.message || '未知错误'
      });
    }
  }

  refreshLxSourceList(true);

  if (files.length === 1) {
    if (successCount > 0) {
      showToast('LX 音源已导入');
    } else {
      showToast('导入失败: ' + (failedFiles[0] && failedFiles[0].error || '未知错误'));
    }
  } else {
    var message = '成功导入 ' + successCount + ' 个音源';
    if (failCount > 0) {
      message += '，失败 ' + failCount + ' 个';
      console.error('导入失败的文件:', failedFiles);
    }
    showToast(message);

    // 如果有失败的文件，在控制台详细列出
    if (failedFiles.length > 0) {
      console.group('LX音源导入失败详情');
      failedFiles.forEach(function(f) {
        console.error('文件:', f.name);
        console.error('错误:', f.error);
      });
      console.groupEnd();
    }
  }
}

async function importLxSourceFromUrl() {
  var input = document.getElementById('lx-source-url-input');
  var value = input ? String(input.value || '').trim() : '';
  if (!/^https?:\/\//i.test(value)) {
    showToast('请输入有效的 LX 音源脚本 URL');
    return;
  }
  await postLxSource('/api/lx/source/import-url', { url: value }, '在线 LX 音源已导入');
  if (input) input.value = '';
}

async function toggleLxSource(id, enabled) {
  await postLxSource('/api/lx/source/update', { id: id, enabled: enabled }, enabled ? 'LX 音源已启用' : 'LX 音源已禁用');
}

async function removeLxSource(id) {
  await postLxSource('/api/lx/source/delete', { id: id }, 'LX 音源已删除');
}

async function reloadLxSource(id) {
  await postLxSource('/api/lx/source/reload', { id: id }, 'LX 音源已重载');
}

async function moveLxSource(index, delta) {
  index = Number(index) || 0;
  delta = Number(delta) || 0;
  var target = index + delta;
  if (target < 0 || target >= lxSourceUiState.sources.length) return;
  var moved = lxSourceUiState.sources[index];
  if (!moved) return;
  lxSourceUiState.sources.splice(index, 1);
  lxSourceUiState.sources.splice(target, 0, moved);
  for (var i = 0; i < lxSourceUiState.sources.length; i++) {
    lxSourceUiState.sources[i].order = i;
    await postLxSource('/api/lx/source/update', { id: lxSourceUiState.sources[i].id, order: i });
  }
  renderLxSourceList();
  showToast('LX 音源顺序已更新');
}

// ========== 批量操作功能 ==========

function getSelectedLxSourceIds() {
  var checkboxes = document.querySelectorAll('.lx-source-select:checked');
  var ids = [];
  checkboxes.forEach(function(cb) {
    ids.push(cb.getAttribute('data-id'));
  });
  return ids;
}

function updateLxSourceSelection() {
  var selectedIds = getSelectedLxSourceIds();
  var countSpan = document.getElementById('lx-source-selected-count');
  var selectAllCheckbox = document.getElementById('lx-source-select-all');
  var allCheckboxes = document.querySelectorAll('.lx-source-select');

  if (countSpan) {
    countSpan.textContent = selectedIds.length > 0 ? '已选择 ' + selectedIds.length + ' 个音源' : '';
  }

  if (selectAllCheckbox && allCheckboxes.length > 0) {
    selectAllCheckbox.checked = selectedIds.length === allCheckboxes.length;
  }
}

function toggleSelectAllLxSources(checked) {
  var checkboxes = document.querySelectorAll('.lx-source-select');
  checkboxes.forEach(function(cb) {
    cb.checked = checked;
  });
  updateLxSourceSelection();
}

async function batchEnableLxSources() {
  var ids = getSelectedLxSourceIds();
  if (ids.length === 0) {
    showToast('请先选择要启用的音源');
    return;
  }
  if (!confirm('确定要启用选中的 ' + ids.length + ' 个音源吗？')) return;

  for (var i = 0; i < ids.length; i++) {
    try {
      await postLxSource('/api/lx/source/update', { id: ids[i], enabled: true }, null);
    } catch (e) {
      console.warn('批量启用失败:', ids[i], e);
    }
  }
  showToast('已启用 ' + ids.length + ' 个音源');
  refreshLxSourceList(true);
}

async function batchDisableLxSources() {
  var ids = getSelectedLxSourceIds();
  if (ids.length === 0) {
    showToast('请先选择要禁用的音源');
    return;
  }
  if (!confirm('确定要禁用选中的 ' + ids.length + ' 个音源吗？')) return;

  for (var i = 0; i < ids.length; i++) {
    try {
      await postLxSource('/api/lx/source/update', { id: ids[i], enabled: false }, null);
    } catch (e) {
      console.warn('批量禁用失败:', ids[i], e);
    }
  }
  showToast('已禁用 ' + ids.length + ' 个音源');
  refreshLxSourceList(true);
}

async function batchRemoveLxSources() {
  var ids = getSelectedLxSourceIds();
  if (ids.length === 0) {
    showToast('请先选择要删除的音源');
    return;
  }
  if (!confirm('确定要删除选中的 ' + ids.length + ' 个音源吗？此操作不可撤销！')) return;

  for (var i = 0; i < ids.length; i++) {
    try {
      await postLxSource('/api/lx/source/delete', { id: ids[i] }, null);
    } catch (e) {
      console.warn('批量删除失败:', ids[i], e);
    }
  }
  showToast('已删除 ' + ids.length + ' 个音源');
  refreshLxSourceList(true);
}

setTimeout(function () { fetchLxSources(false); }, 800);
