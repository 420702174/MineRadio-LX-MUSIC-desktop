const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { Buffer } = require('buffer');

const LX_RUNTIME_VERSION = '2.7.0';
const EVENT_NAMES = Object.freeze({
  inited: 'inited',
  request: 'request',
  requestResult: 'requestResult',
  requestError: 'requestError',
});
const LX_REQUEST_TIMEOUT_MS = 12000;
const LX_INIT_TIMEOUT_MS = 12000;
const LX_SOURCE_STORE_VERSION = 1;
const LX_PROXY_HEADER_ALLOWLIST = new Set([
  'referer',
  'origin',
  'user-agent',
  'cookie',
  'authorization',
  'x-requested-with',
  'accept',
  'accept-language',
  'range',
]);

function createError(code, message, extra) {
  const error = new Error(message || code);
  error.code = code;
  if (extra && typeof extra === 'object') Object.assign(error, extra);
  return error;
}

function readJsonFile(file, fallback) {
  try {
    if (!file || !fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJsonFile(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s·・,，。.!！?？'"“”‘’|\-_/]+/g, '');
}

function normalizedHeaderName(name) {
  return String(name || '').trim().toLowerCase();
}

function sanitizeHeaders(input) {
  const headers = {};
  if (!input || typeof input !== 'object') return headers;
  Object.keys(input).forEach((key) => {
    const normalized = normalizedHeaderName(key);
    const value = input[key];
    if (!normalized || !LX_PROXY_HEADER_ALLOWLIST.has(normalized)) return;
    if (value == null || value === '') return;
    headers[normalized] = String(value);
  });
  return headers;
}

function pickString(obj, keys) {
  for (const key of keys) {
    const value = obj && obj[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function pickNumber(obj, keys) {
  for (const key of keys) {
    const value = Number(obj && obj[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function parseScriptHeader(rawScript) {
  const text = String(rawScript || '').replace(/^\uFEFF/, '');
  const block = text.match(/\/\*[\s\S]*?\*\//);
  const lines = block ? block[0].split(/\r?\n/) : [];
  const meta = {};
  for (const line of lines) {
    const match = line.match(/@([a-zA-Z][\w-]*)\s+(.+?)\s*$/);
    if (!match) continue;
    meta[match[1].toLowerCase()] = String(match[2] || '').trim();
  }
  return {
    name: meta.name || '',
    version: meta.version || '',
    author: meta.author || '',
    homepage: meta.homepage || meta.url || '',
    description: meta.description || meta.desc || '',
    rawMeta: meta,
  };
}

function normalizeSupportedSources(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return Object.keys(normalizeSourceSchemas(input));
  }
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const key = String(value || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  if (Array.isArray(input)) input.forEach(push);
  else if (input && typeof input === 'object') Object.keys(input).forEach(push);
  return out.filter((key) => ['kw', 'kg', 'tx', 'wy', 'mg', 'local'].includes(key));
}

function normalizeSourceSchemas(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  Object.keys(input).forEach((key) => {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!['kw', 'kg', 'tx', 'wy', 'mg', 'local'].includes(normalizedKey)) return;
    const value = input[key] && typeof input[key] === 'object' ? input[key] : {};
    const qualitys = normalizeQualityList(value.qualitys || value._qualitys).filter((item) => String(item || '').trim().toLowerCase() !== normalizedKey);
    out[normalizedKey] = {
      type: pickString(value, ['type']) || 'music',
      actions: Array.isArray(value.actions) ? value.actions.map((item) => String(item || '').trim()).filter(Boolean) : [],
      qualitys,
    };
  });
  return out;
}

function normalizeQualityList(input) {
  const seen = new Set();
  const out = [];
  const add = (value) => {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  if (Array.isArray(input)) input.forEach(add);
  else if (input && typeof input === 'object') Object.keys(input).forEach(add);
  return out;
}

function normalizeLxMusicInfo(item, sourceKey) {
  item = item || {};
  const meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
  const artists = Array.isArray(item.singer)
    ? item.singer.map((name) => ({ name: String(name || '').trim() })).filter((entry) => entry.name)
    : [];
  const albumName = pickString(meta, ['albumName', 'album', 'album_name']) || pickString(item, ['albumName', 'album']);
  const id = pickString(meta, ['songId', 'id', 'rid', 'copyrightId', 'hash']) || pickString(item, ['id', 'songId']);
  const qualitys = normalizeQualityList(meta.qualitys || meta._qualitys || item.qualitys || item._qualitys);
  return {
    name: pickString(item, ['name', 'title']),
    singer: artists.map((entry) => entry.name),
    source: String(sourceKey || item.source || '').trim().toLowerCase(),
    interval: pickNumber(item, ['interval', 'duration', 'length']),
    meta: Object.assign({}, meta, {
      songId: pickString(meta, ['songId']) || id,
      albumName,
      picUrl: pickString(meta, ['picUrl', 'cover', 'img']),
      hash: pickString(meta, ['hash']),
      strMediaMid: pickString(meta, ['strMediaMid', 'mediaMid']),
      copyrightId: pickString(meta, ['copyrightId']),
      qualitys: qualitys.length ? qualitys : undefined,
    }),
  };
}

function normalizeSearchPayload(result, fallbackSource) {
  if (Array.isArray(result)) return { list: result, source: fallbackSource };
  if (!result || typeof result !== 'object') return { list: [], source: fallbackSource };
  const list = Array.isArray(result.list)
    ? result.list
    : (Array.isArray(result.data) ? result.data : (Array.isArray(result.result) ? result.result : []));
  return { list, source: fallbackSource };
}

function responseUrlFromPayload(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload !== 'object') return '';
  return pickString(payload, ['url', 'src', 'musicUrl', 'playUrl']);
}

function normalizeResolvedUrl(payload) {
  if (typeof payload === 'string') {
    return { url: payload.trim(), headers: {}, quality: '', sourceLabel: '' };
  }
  if (!payload || typeof payload !== 'object') return { url: '', headers: {}, quality: '', sourceLabel: '' };
  const url = responseUrlFromPayload(payload);
  const headers = sanitizeHeaders(payload.headers || payload.header || payload.requestHeaders || payload.httpHeaders);
  return {
    url,
    headers,
    quality: pickString(payload, ['quality', 'type', 'level']),
    sourceLabel: pickString(payload, ['sourceLabel', 'source', 'from']),
  };
}

function qualityCandidates(preferred, available) {
  // 修复：只使用 LX Music 标准的音质列表，忽略平台特定的音质名称
  const lxStandardQualities = ['128k', '320k', 'flac', 'flac24bit'];
  const normalizedAvailable = lxStandardQualities.slice();
  const rank = ['128k', '320k', 'flac', 'flac24bit'];
  const aliases = {
    standard: '128k',
    exhigh: '320k',
    lossless: 'flac',
    hires: 'flac24bit',
    jymaster: 'flac24bit',
  };
  const target = aliases[String(preferred || '').trim().toLowerCase()] || String(preferred || '').trim();
  const start = normalizedAvailable.indexOf(target);
  if (start >= 0) return normalizedAvailable.slice(start).concat(normalizedAvailable.slice(0, start));
  const desiredRank = rank.indexOf(target);
  if (desiredRank >= 0) {
    return normalizedAvailable.slice().sort((left, right) => {
      const leftIndex = rank.indexOf(left);
      const rightIndex = rank.indexOf(right);
      const leftDistance = leftIndex < 0 ? 99 : Math.abs(leftIndex - desiredRank);
      const rightDistance = rightIndex < 0 ? 99 : Math.abs(rightIndex - desiredRank);
      return leftDistance - rightDistance;
    });
  }
  return normalizedAvailable;
}

class LxScriptRuntime {
  constructor(record, options) {
    this.record = Object.assign({}, record);
    this.options = Object.assign({}, options);
    this.eventHandlers = new Map();
    this.pendingRequests = new Map();
    this.initialized = false;
    this.initPayload = null;
    this.initError = '';
    this.disposed = false;
    this.context = null;
    this.header = parseScriptHeader(this.record.rawScript);
    this.initPromise = null;
    this.initResolve = null;
    this.initReject = null;
    this.initPromise = new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });
  }

  on(eventName, handler) {
    if (!this.eventHandlers.has(eventName)) this.eventHandlers.set(eventName, []);
    this.eventHandlers.get(eventName).push(handler);
  }

  emit(eventName, payload) {
    const handlers = this.eventHandlers.get(eventName) || [];
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (_) {}
    }
  }

  scriptInfo() {
    return {
      id: this.record.id,
      name: this.header.name || this.record.name || '',
      version: this.header.version || this.record.version || '',
      author: this.header.author || this.record.author || '',
      homepage: this.header.homepage || this.record.homepage || '',
      description: this.header.description || this.record.description || '',
      rawScript: this.record.rawScript || '',
    };
  }

  createApi() {
    const runtime = this;
    return {
      env: 'desktop',
      version: LX_RUNTIME_VERSION,
      currentScriptInfo: runtime.scriptInfo(),
      EVENT_NAMES,
      on(eventName, handler) {
        if (typeof handler !== 'function') return;
        runtime.on(String(eventName || ''), handler);
      },
      send(eventName, payload) {
        runtime.handleSend(String(eventName || ''), payload);
      },
      request(url, options, callback) {
        return runtime.httpRequest(url, options, callback);
      },
      utils: runtime.createUtils(),
    };
  }

  createUtils() {
    return {
      buffer: {
        from(value, encoding) {
          return Buffer.from(value, encoding);
        },
        bufToString(value, encoding) {
          return Buffer.from(value).toString(encoding || 'utf8');
        },
      },
      crypto: {
        md5(value, encoding) {
          return crypto.createHash('md5').update(Buffer.isBuffer(value) ? value : Buffer.from(value)).digest(encoding || 'hex');
        },
      },
      stringify: {
        b64Encode(value) {
          return Buffer.from(String(value || ''), 'utf8').toString('base64');
        },
        b64Decode(value) {
          return Buffer.from(String(value || ''), 'base64').toString('utf8');
        },
      },
    };
  }

  async performHttpRequest(url, options) {
    const targetUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(targetUrl)) throw createError('LX_HTTP_URL_INVALID', 'LX request url is invalid');
    const requestOptions = options && typeof options === 'object' ? Object.assign({}, options) : {};
    const method = pickString(requestOptions, ['method']) || 'GET';
    const headers = requestOptions.headers && typeof requestOptions.headers === 'object' ? Object.assign({}, requestOptions.headers) : {};
    let body = requestOptions.body;
    if (body == null && requestOptions.data != null) body = requestOptions.data;
    if (body != null && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array) && typeof body !== 'string') {
      body = JSON.stringify(body);
      if (!Object.keys(headers).some((key) => normalizedHeaderName(key) === 'content-type')) headers['content-type'] = 'application/json';
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = Math.max(500, Number(requestOptions.timeout || requestOptions.timeoutMs) || LX_REQUEST_TIMEOUT_MS);
    const timer = controller ? setTimeout(() => controller.abort(createError('LX_HTTP_TIMEOUT', 'LX http request timed out')), timeoutMs) : 0;
    try {
      const response = await (this.options.fetchImpl || fetch)(targetUrl, {
        method,
        headers,
        body,
        signal: controller ? controller.signal : undefined,
      });
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      const responseType = String(requestOptions.responseType || '').trim().toLowerCase();
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      let parsedBody;
      if (responseType === 'buffer' || responseType === 'arraybuffer') {
        parsedBody = Buffer.from(await response.arrayBuffer());
      } else if (responseType === 'text') {
        parsedBody = await response.text();
      } else {
        const text = await response.text();
        if (!text) parsedBody = '';
        else if (responseType === 'json' || contentType.includes('application/json') || contentType.includes('+json')) {
          try {
            parsedBody = JSON.parse(text);
          } catch (_) {
            parsedBody = text;
          }
        } else {
          parsedBody = text;
        }
      }
      return {
        statusCode: Number(response.status) || 0,
        statusMessage: response.statusText || '',
        headers: responseHeaders,
        body: parsedBody,
      };
    } catch (error) {
      if (error && error.code) throw error;
      throw createError('LX_HTTP_FAILED', error && error.message || 'LX http request failed');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  httpRequest(url, options, callback) {
    const cb = typeof options === 'function'
      ? options
      : (typeof callback === 'function' ? callback : null);
    const normalizedOptions = typeof options === 'function' ? {} : options;
    const promise = this.performHttpRequest(url, normalizedOptions);
    if (!cb) {
      return promise.catch((error) => {
        if (error && error.code === 'LX_HTTP_TIMEOUT') {
          console.warn('[LX Source] Request timeout:', String(url));
        } else if (error && error.code !== 'LX_HTTP_URL_INVALID') {
          console.warn('[LX Source] Request failed:', String(url), error.message);
        }
        throw error;
      });
    }
    return promise.then(
      (value) => {
        try {
          cb(null, value);
          return value;
        } catch (error) {
          if (!this.initialized && this.initReject) this.initReject(error);
          throw error;
        }
      },
      (error) => {
        try {
          cb(error);
        } catch (callbackError) {
          if (!this.initialized && this.initReject) this.initReject(callbackError);
          throw callbackError;
        }
        if (!this.initialized && this.initReject) this.initReject(error);
        throw error;
      }
    );
  }

  handleSend(eventName, payload) {
    if (eventName === EVENT_NAMES.inited) {
      this.initialized = true;
      this.initPayload = payload && typeof payload === 'object' ? payload : {};
      if (this.initResolve) this.initResolve(this.initPayload);
      return;
    }
    if (eventName === EVENT_NAMES.requestResult) {
      const requestId = pickString(payload, ['requestId', 'id']);
      const pending = requestId ? this.pendingRequests.get(requestId) : null;
      if (!pending) return;
      this.pendingRequests.delete(requestId);
      pending.resolve(payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload);
      return;
    }
    if (eventName === EVENT_NAMES.requestError) {
      const requestId = pickString(payload, ['requestId', 'id']);
      const pending = requestId ? this.pendingRequests.get(requestId) : null;
      if (!pending) return;
      this.pendingRequests.delete(requestId);
      pending.reject(createError('LX_SOURCE_REQUEST_FAILED', pickString(payload, ['message', 'error']) || 'LX_SOURCE_REQUEST_FAILED'));
      return;
    }
    this.emit(eventName, payload);
  }

  async load() {
    const script = String(this.record.rawScript || '').replace(/^\uFEFF/, '');
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      URL,
      URLSearchParams,
      fetch: this.options.fetchImpl || fetch,
      Buffer,
      globalThis: null,
      window: undefined,
      self: undefined,
      lx: undefined,
    };
    sandbox.globalThis = sandbox;
    sandbox.lx = this.createApi();
    this.context = vm.createContext(sandbox);
    try {
      new vm.Script(script, {
        filename: `lx-source-${this.record.id}.js`,
        displayErrors: true,
      }).runInContext(this.context, { timeout: 3000 });
    } catch (error) {
      this.initError = error && error.message || 'LX_SOURCE_INIT_FAILED';
      if (this.initReject) this.initReject(createError('LX_SOURCE_INIT_FAILED', this.initError));
      throw createError('LX_SOURCE_INIT_FAILED', this.initError);
    }
    if (!this.initialized) {
      try {
        await Promise.race([
          this.initPromise,
          new Promise((_, reject) => {
            setTimeout(() => reject(createError('LX_SOURCE_INIT_MISSING', 'LX source did not send inited event')), LX_INIT_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        this.initError = error && error.message || 'LX_SOURCE_INIT_MISSING';
        throw createError(error && error.code || 'LX_SOURCE_INIT_MISSING', this.initError);
      }
    }
    return this.describe();
  }

  describe() {
    const info = this.initPayload || {};
    const sourceSchemas = normalizeSourceSchemas(info.sources || info.supportSources || info.musicSources);
    return {
      name: pickString(info, ['name']) || this.header.name || this.record.name || 'LX Source',
      version: pickString(info, ['version']) || this.header.version || this.record.version || '',
      author: pickString(info, ['author']) || this.header.author || this.record.author || '',
      homepage: pickString(info, ['homepage', 'url']) || this.header.homepage || this.record.homepage || '',
      description: pickString(info, ['description', 'desc']) || this.header.description || this.record.description || '',
      supportedSources: Object.keys(sourceSchemas).length
        ? Object.keys(sourceSchemas)
        : normalizeSupportedSources(info.sources || info.supportSources || info.musicSources),
      sourceSchemas,
    };
  }

  async dispatchRequest(action, data, timeoutMs) {
    if (!this.initialized) throw createError('LX_SOURCE_NOT_READY', 'LX source not initialized');
    const handlers = this.eventHandlers.get(EVENT_NAMES.request) || [];
    if (!handlers.length) throw createError('LX_SOURCE_NO_REQUEST_HANDLER', 'LX source does not handle request event');
    const requestId = crypto.randomBytes(12).toString('hex');
    const payload = Object.assign({}, data || {}, {
      action,
      requestId,
      source: pickString(data && data.info, ['source', 'type']) || pickString(data, ['source']),
    });
    const deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });
    this.pendingRequests.set(requestId, deferred);
    const timer = setTimeout(() => {
      const pending = this.pendingRequests.get(requestId);
      if (!pending) return;
      this.pendingRequests.delete(requestId);
      pending.reject(createError('LX_SOURCE_REQUEST_TIMEOUT', 'LX source request timed out'));
    }, Math.max(500, Number(timeoutMs) || LX_REQUEST_TIMEOUT_MS));
    try {
      const returned = [];
      for (const handler of handlers) {
        returned.push(handler(payload));
      }
      const settled = await Promise.all(returned.map((value) => Promise.resolve(value).catch((error) => {
        throw error;
      })));
      const direct = settled.find((value) => value !== undefined);
      if (direct !== undefined) {
        this.pendingRequests.delete(requestId);
        return direct;
      }
      return await deferred.promise;
    } finally {
      clearTimeout(timer);
      this.pendingRequests.delete(requestId);
    }
  }
}

function createSongKey(song) {
  const title = normalizeText(song.name);
  const artist = normalizeText(song.artist);
  const source = String(song.lxOriginSource || '').trim().toLowerCase();
  return `${title}|${artist}|${source}`;
}

function createRuntimeRecord(record, runtime, extra) {
  return Object.assign({}, record, extra || {}, runtime.describe());
}

function sourceSupportsAction(record, sourceKey, action) {
  const schema = normalizeSourceSchemas(record && record.sourceSchemas)[String(sourceKey || '').trim().toLowerCase()] || null;
  return !!(schema && Array.isArray(schema.actions) && schema.actions.includes(action));
}

class LxSourceManager {
  constructor(options) {
    options = options || {};
    this.storeFile = String(options.storeFile || '').trim();
    this.fetchImpl = options.fetchImpl;
    this.records = [];
    this.runtimes = new Map();
    try {
      this.loadStore();
    } catch (error) {
      console.error('[LX Source Manager] 初始化失败:', error);
      console.error('[LX Source Manager] 将以空列表启动');
      this.records = [];
    }
  }

  loadStore() {
    try {
      const payload = readJsonFile(this.storeFile, { version: LX_SOURCE_STORE_VERSION, sources: [] }) || {};
      const list = Array.isArray(payload.sources) ? payload.sources : [];

      console.log('[LX Source] 开始加载音源，共', list.length, '个');

      // 安全地加载每个record
      for (let i = 0; i < list.length; i++) {
        try {
          const record = this.normalizeRecord(list[i], i);
          this.records.push(record);
          console.log('[LX Source] 已加载记录', i + 1, '/', list.length, ':', record.name, record.enabled === false ? '(已禁用)' : '');

          // 跳过已禁用的音源，不加载其runtime
          if (record.enabled === false) {
            console.log('[LX Source] 跳过已禁用音源:', record.name);
            continue;
          }

          // 异步加载runtime，失败不影响其他音源
          // 使用 setImmediate 延迟执行，避免阻塞启动
          setImmediate(() => {
            Promise.resolve(this.loadRuntime(record)).catch((error) => {
              console.error('[LX Source] 加载音源runtime失败:', record.name || record.id, error.message);
              record.initStatus = 'error';
              record.initError = error.message || 'LX_SOURCE_LOAD_FAILED';
            }).finally(() => {
              try { this.persist(); } catch (_) {}
            });
          });
        } catch (error) {
          console.error('[LX Source] 解析音源记录失败:', error.message, '索引:', i);
          // 跳过这个损坏的记录，继续处理下一个
        }
      }

      console.log('[LX Source] 音源记录加载完成，runtime将异步初始化');
      this.persist();
    } catch (error) {
      console.error('[LX Source] loadStore 失败:', error);
      // 即使整个加载失败，也确保records是个数组
      this.records = this.records || [];
    }
  }

  normalizeRecord(item, index) {
    try {
      const rawScript = String(item && item.rawScript || '').replace(/^\uFEFF/, '');
      const header = parseScriptHeader(rawScript);
      return {
        id: pickString(item, ['id']) || crypto.randomBytes(12).toString('hex'),
        name: pickString(item, ['name']) || header.name || 'LX Source',
        version: pickString(item, ['version']) || header.version || '',
        author: pickString(item, ['author']) || header.author || '',
        homepage: pickString(item, ['homepage']) || header.homepage || '',
        description: pickString(item, ['description']) || header.description || '',
        sourceType: pickString(item, ['sourceType']) || 'file',
        sourcePath: pickString(item, ['sourcePath']),
        sourceUrl: pickString(item, ['sourceUrl']),
        rawScript,
        enabled: item && item.enabled !== false,
        order: Number(item && item.order) || index,
        initStatus: pickString(item, ['initStatus']) || 'pending',
        initError: pickString(item, ['initError']),
        supportedSources: normalizeSupportedSources(item && item.supportedSources),
        sourceSchemas: normalizeSourceSchemas(item && (item.sourceSchemas || item.sources)),
        importedAt: Number(item && item.importedAt) || Date.now(),
        updatedAt: Number(item && item.updatedAt) || Date.now(),
      };
    } catch (error) {
      console.error('[LX Source] normalizeRecord \u5931\u8D25:', error);
      // \u8FD4\u56DE\u4E00\u4E2A\u6700\u5C0F\u5316\u7684\u6709\u6548record\uFF0C\u6807\u8BB0\u4E3A\u9519\u8BEF\u72B6\u6001
      return {
        id: pickString(item, ['id']) || crypto.randomBytes(12).toString('hex'),
        name: pickString(item, ['name']) || 'Invalid LX Source',
        version: '',
        author: '',
        homepage: '',
        description: '',
        sourceType: 'file',
        sourcePath: '',
        sourceUrl: '',
        rawScript: '',
        enabled: false,
        order: index || 0,
        initStatus: 'error',
        initError: 'Record parsing failed: ' + (error.message || 'Unknown error'),
        supportedSources: [],
        sourceSchemas: {},
        importedAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
  }

  persist() {
    const payload = {
      version: LX_SOURCE_STORE_VERSION,
      sources: this.records
        .slice()
        .sort((left, right) => Number(left.order) - Number(right.order))
        .map((record, index) => Object.assign({}, record, { order: index })),
    };
    this.records = payload.sources.map((item, index) => Object.assign({}, item, { order: index }));
    writeJsonFile(this.storeFile, payload);
  }

  listSources() {
    return this.records.slice().sort((left, right) => left.order - right.order).map((record) => ({
      searchEnabled: Object.values(normalizeSourceSchemas(record.sourceSchemas)).some((item) => Array.isArray(item.actions) && item.actions.includes('musicSearch')),
      urlResolveEnabled: Object.values(normalizeSourceSchemas(record.sourceSchemas)).some((item) => Array.isArray(item.actions) && item.actions.includes('musicUrl')),
      id: record.id,
      name: record.name,
      version: record.version,
      author: record.author,
      homepage: record.homepage,
      description: record.description,
      sourceType: record.sourceType,
      sourcePath: record.sourcePath,
      sourceUrl: record.sourceUrl,
      enabled: record.enabled !== false,
      order: record.order,
      initStatus: record.initStatus,
      initError: record.initError || '',
      supportedSources: normalizeSupportedSources(record.supportedSources),
      sourceSchemas: normalizeSourceSchemas(record.sourceSchemas),
      importedAt: record.importedAt,
      updatedAt: record.updatedAt,
    }));
  }

  findRecord(id) {
    return this.records.find((record) => record.id === id) || null;
  }

  async loadRuntime(record) {
    if (!record || !record.rawScript) return null;
    this.runtimes.delete(record.id);
    try {
      console.log('[LX Source] 开始加载runtime:', record.name);
      const runtime = new LxScriptRuntime(record, { fetchImpl: this.fetchImpl });
      const meta = await runtime.load();
      record.name = meta.name || record.name;
      record.version = meta.version || record.version;
      record.author = meta.author || record.author;
      record.homepage = meta.homepage || record.homepage;
      record.description = meta.description || record.description;
      record.supportedSources = meta.supportedSources;
      record.sourceSchemas = meta.sourceSchemas;
      record.initStatus = 'ready';
      record.initError = '';
      this.runtimes.set(record.id, runtime);
      console.log('[LX Source] Runtime加载成功:', record.name);
      return runtime;
    } catch (error) {
      console.error('[LX Source] Runtime加载失败:', record.name, error.message);
      record.initStatus = 'error';
      record.initError = error && error.message || 'LX_SOURCE_INIT_FAILED';
      return null;
    }
  }

  async importSource(input) {
    const rawScript = String(input && input.rawScript || '').replace(/^\uFEFF/, '').trim();
    if (!rawScript) throw createError('LX_SOURCE_EMPTY', 'LX source script is empty');

    // \u68C0\u67E5\u662F\u5426\u5DF2\u5B58\u5728\u76F8\u540C\u7684\u97F3\u6E90\uFF08\u901A\u8FC7\u811A\u672C\u5185\u5BB9\u53BB\u91CD\uFF09
    for (const existingRecord of this.records) {
      if (existingRecord.rawScript === rawScript) {
        const sourceName = existingRecord.name || '\u672A\u547D\u540D\u97F3\u6E90';
        throw createError('LX_SOURCE_DUPLICATE', `\u5BFC\u5165\u5931\u8D25\uFF0C\u811A\u672C\u5185\u5BB9\u4E0E\u5DF2\u6709\u7684\u6E90\u300C${sourceName}\u300D\u76F8\u540C`);
      }
    }

    // \u9884\u5148\u9A8C\u8BC1\uFF1A\u5C1D\u8BD5\u521B\u5EFA\u4E34\u65F6record\u5E76\u52A0\u8F7D\uFF0C\u9A8C\u8BC1\u811A\u672C\u6709\u6548\u6027
    const tempRecord = this.normalizeRecord({
      id: 'temp-validation-' + Date.now(),
      sourceType: pickString(input, ['sourceType']) || 'file',
      sourcePath: pickString(input, ['sourcePath']),
      sourceUrl: pickString(input, ['sourceUrl']),
      rawScript,
      enabled: true,
      order: 0,
    }, 0);

    // \u9A8C\u8BC1\u811A\u672C\u662F\u5426\u53EF\u4EE5\u6B63\u5E38\u52A0\u8F7D
    const testRuntime = await this.loadRuntime(tempRecord);
    if (!testRuntime || tempRecord.initStatus === 'error') {
      const errorMsg = tempRecord.initError || 'LX\u97F3\u6E90\u811A\u672C\u52A0\u8F7D\u5931\u8D25';
      throw createError('LX_SOURCE_INVALID', errorMsg);
    }

    // \u9A8C\u8BC1\u901A\u8FC7\uFF0C\u521B\u5EFA\u6B63\u5F0Frecord
    const record = this.normalizeRecord({
      id: crypto.randomBytes(12).toString('hex'),
      sourceType: pickString(input, ['sourceType']) || 'file',
      sourcePath: pickString(input, ['sourcePath']),
      sourceUrl: pickString(input, ['sourceUrl']),
      rawScript,
      enabled: true,
      order: this.records.length,
      importedAt: Date.now(),
      updatedAt: Date.now(),
    }, this.records.length);

    this.records.push(record);
    await this.loadRuntime(record);
    this.persist();
    return createRuntimeRecord(record, this.runtimes.get(record.id) || { describe: () => ({ supportedSources: record.supportedSources || [] }) });
  }

  async updateSource(id, payload) {
    const record = this.findRecord(id);
    if (!record) throw createError('LX_SOURCE_NOT_FOUND', 'LX source not found');
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'enabled')) record.enabled = payload.enabled !== false;
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'order')) record.order = Math.max(0, Number(payload.order) || 0);
    record.updatedAt = Date.now();
    this.records.sort((left, right) => left.order - right.order);
    this.records.forEach((item, index) => { item.order = index; });
    this.persist();
    return record;
  }

  async deleteSource(id) {
    const index = this.records.findIndex((record) => record.id === id);
    if (index < 0) throw createError('LX_SOURCE_NOT_FOUND', 'LX source not found');
    this.runtimes.delete(id);
    const [removed] = this.records.splice(index, 1);
    this.records.forEach((item, position) => { item.order = position; });
    this.persist();
    return removed;
  }

  async reloadSource(id) {
    const record = this.findRecord(id);
    if (!record) throw createError('LX_SOURCE_NOT_FOUND', 'LX source not found');
    record.updatedAt = Date.now();
    await this.loadRuntime(record);
    this.persist();
    return record;
  }

  enabledRecords() {
    return this.records
      .filter((record) => record.enabled !== false)
      .sort((left, right) => left.order - right.order);
  }

  async searchSource(record, keyword, limit, offset) {
    const runtime = record ? this.runtimes.get(record.id) : null;
    if (!record || !runtime || record.initStatus !== 'ready') return { songs: [], hasMore: false, nextOffset: offset || 0 };
    const supportedSources = normalizeSupportedSources(record.supportedSources);
    const sourceSchemas = normalizeSourceSchemas(record.sourceSchemas);
    const candidates = [];
    for (const sourceKey of supportedSources) {
      const schema = sourceSchemas[sourceKey];
      if (schema && Array.isArray(schema.actions) && schema.actions.length && !schema.actions.includes('musicSearch')) continue;
      let result;
      try {
        result = await runtime.dispatchRequest('musicSearch', {
          info: { type: sourceKey, text: keyword, page: Math.floor((Number(offset) || 0) / Math.max(1, Number(limit) || 20)) + 1, limit },
        }, LX_REQUEST_TIMEOUT_MS);
      } catch (_) {
        continue;
      }
      const normalized = normalizeSearchPayload(result, sourceKey);
      const list = Array.isArray(normalized.list) ? normalized.list : [];
      for (const item of list) {
        const musicInfo = normalizeLxMusicInfo(item, sourceKey);
        if (!musicInfo.name || !musicInfo.singer.length) continue;
        candidates.push({
          provider: 'lx',
          source: 'lx',
          type: 'song',
          id: `${record.id}:${sourceKey}:${pickString(musicInfo.meta, ['songId', 'hash', 'copyrightId']) || crypto.randomBytes(8).toString('hex')}`,
          name: musicInfo.name,
          artist: musicInfo.singer.join(' / '),
          artists: musicInfo.singer.map((name) => ({ name })),
          album: pickString(musicInfo.meta, ['albumName']),
          cover: pickString(musicInfo.meta, ['picUrl']),
          duration: pickNumber(musicInfo, ['interval']) * 1000,
          playable: true,
          lxSourceScriptId: record.id,
          lxSourceName: record.name,
          lxOriginSource: sourceKey,
          lxMusicInfo: musicInfo,
          lxQualitys: normalizeQualityList(musicInfo.meta.qualitys || musicInfo.meta._qualitys || (schema && schema.qualitys)),
          lxCandidates: [{
            scriptId: record.id,
            scriptName: record.name,
            source: sourceKey,
            musicInfo,
            qualitys: normalizeQualityList(musicInfo.meta.qualitys || musicInfo.meta._qualitys || (schema && schema.qualitys)),
          }],
        });
        if (candidates.length >= Math.max(1, Number(limit) || 20)) break;
      }
      if (candidates.length) break;
    }
    return {
      songs: candidates.slice(0, Math.max(1, Number(limit) || 20)),
      hasMore: false,
      nextOffset: (Number(offset) || 0) + candidates.length,
    };
  }

  async searchAll(keyword, limit, offset) {
    limit = Math.max(1, Math.min(50, Number(limit) || 18));
    offset = Math.max(0, Number(offset) || 0);
    const enabled = this.enabledRecords();
    const merged = [];
    const seen = new Map();
    let currentOffset = 0;
    for (const record of enabled) {
      const result = await this.searchSource(record, keyword, limit, 0);
      for (const song of result.songs || []) {
        const key = createSongKey(song);
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, song);
          merged.push(song);
        } else if (Array.isArray(existing.lxCandidates) && Array.isArray(song.lxCandidates)) {
          existing.lxCandidates = existing.lxCandidates.concat(song.lxCandidates);
        }
      }
    }
    const page = merged.slice(offset, offset + limit).map((song) => {
      const primary = song.lxCandidates && song.lxCandidates[0] || null;
      return Object.assign({}, song, {
        lxSourceScriptId: primary ? primary.scriptId : song.lxSourceScriptId,
        lxSourceName: primary ? primary.scriptName : song.lxSourceName,
        lxOriginSource: primary ? primary.source : song.lxOriginSource,
        lxMusicInfo: primary ? primary.musicInfo : song.lxMusicInfo,
        lxQualitys: primary ? primary.qualitys : song.lxQualitys,
      });
    });
    currentOffset = offset + page.length;
    return {
      songs: page,
      hasMore: currentOffset < merged.length,
      nextOffset: currentOffset,
      total: merged.length,
    };
  }

  collectResolveCandidates(payload) {
    const sourceKey = String(payload && payload.lxOriginSource || '').trim().toLowerCase();
    const musicInfo = payload && payload.lxMusicInfo || null;
    const initial = Array.isArray(payload && payload.lxCandidates) && payload.lxCandidates.length
      ? payload.lxCandidates
      : [{
        scriptId: payload && payload.lxSourceScriptId,
        scriptName: payload && payload.lxSourceName,
        source: sourceKey,
        musicInfo,
        qualitys: payload && payload.lxQualitys,
      }];
    const out = [];
    const seen = new Set();
    const push = (candidate) => {
      if (!candidate || !candidate.scriptId || !candidate.musicInfo) return;
      const candidateSource = String(candidate.source || sourceKey).trim().toLowerCase();
      if (!candidateSource) return;
      const record = this.findRecord(candidate.scriptId);
      if (!record || record.enabled === false || record.initStatus !== 'ready') return;
      if (!sourceSupportsAction(record, candidateSource, 'musicUrl')) return;
      const key = `${record.id}:${candidateSource}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        scriptId: record.id,
        scriptName: record.name,
        source: candidateSource,
        musicInfo: candidate.musicInfo,
        qualitys: Array.isArray(candidate.qualitys) ? candidate.qualitys : [],
      });
    };
    initial.forEach(push);
    if (!sourceKey || !musicInfo) return out;
    this.enabledRecords().forEach((record) => {
      if (!sourceSupportsAction(record, sourceKey, 'musicUrl')) return;
      push({
        scriptId: record.id,
        scriptName: record.name,
        source: sourceKey,
        musicInfo,
        qualitys: normalizeSourceSchemas(record.sourceSchemas)[sourceKey] && normalizeSourceSchemas(record.sourceSchemas)[sourceKey].qualitys,
      });
    });
    return out;
  }

  async resolveSongUrl(payload) {
    console.log('[LX resolveSongUrl] 开始解析, payload:', JSON.stringify(payload).substring(0, 200));
    const chain = this.collectResolveCandidates(payload || {});
    console.log('[LX resolveSongUrl] 候选链长度:', chain.length);
    for (const candidate of chain) {
      console.log('[LX resolveSongUrl] 尝试候选:', { scriptId: candidate.scriptId, source: candidate.source });
      const record = this.findRecord(candidate.scriptId);
      console.log('[LX resolveSongUrl] 找到记录:', record ? record.name : 'null');
      const runtime = record ? this.runtimes.get(record.id) : null;
      console.log('[LX resolveSongUrl] runtime存在:', !!runtime, 'initStatus:', record && record.initStatus);
      if (!record || !runtime || record.initStatus !== 'ready') {
        console.log('[LX resolveSongUrl] 跳过此候选（未就绪）');
        continue;
      }
      const schema = normalizeSourceSchemas(record.sourceSchemas)[String(candidate.source || '').trim().toLowerCase()] || null;
      const qualityList = qualityCandidates(payload.quality, candidate.qualitys && candidate.qualitys.length ? candidate.qualitys : (schema && schema.qualitys));
      console.log('[LX resolveSongUrl] 质量列表:', qualityList);
      for (const quality of qualityList) {
        console.log('[LX resolveSongUrl] 尝试质量:', quality);
        let raw;
        try {
          console.log('[LX resolveSongUrl] 调用 runtime.dispatchRequest musicUrl');
          raw = await runtime.dispatchRequest('musicUrl', {
            info: {
              source: candidate.source,  // 修复：添加 source 字段，表示平台（kg/wy/tx等）
              type: quality,             // type 表示音质
              musicInfo: candidate.musicInfo
            },
          }, LX_REQUEST_TIMEOUT_MS);
          console.log('[LX resolveSongUrl] dispatchRequest 返回:', raw ? '有结果' : '无结果');
        } catch (e) {
          console.log('[LX resolveSongUrl] dispatchRequest 失败:', e.message || e);
          continue;
        }
        const normalized = normalizeResolvedUrl(raw);
        console.log('[LX resolveSongUrl] 规范化后 URL:', normalized.url ? '有URL' : '无URL');
        if (!normalized.url) continue;
        console.log('[LX resolveSongUrl] ✓ 成功获取URL');
        return {
          provider: 'lx',
          url: normalized.url,
          headers: normalized.headers,
          quality: normalized.quality || quality,
          sourceLabel: normalized.sourceLabel || `${record.name} · ${candidate.source}`,
          scriptId: candidate.scriptId,
          scriptName: record.name,
          source: candidate.source,
        };
      }
    }
    console.log('[LX resolveSongUrl] 所有候选都失败，返回空');
    return { provider: 'lx', url: '', headers: {}, error: 'LX_URL_EMPTY', playable: false };
  }
}

function createLxSourceManager(options) {
  return new LxSourceManager(options);
}

module.exports = {
  EVENT_NAMES,
  LX_PROXY_HEADER_ALLOWLIST,
  createLxSourceManager,
  sanitizeHeaders,
};
