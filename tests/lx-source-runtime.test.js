'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { createLxSourceManager } = require('../lx-source-runtime');

function createTempStoreFile() {
  return path.join(os.tmpdir(), `mineradio-lx-runtime-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

test('LX runtime supports callback-style request, utils, and internal request dispatch', async () => {
  const requests = [];
  const storeFile = createTempStoreFile();
  const manager = createLxSourceManager({
    storeFile,
    fetchImpl: async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify({
        code: 0,
        data: {
          ok: true,
          song: {
            name: '晴天',
            singer: ['周杰伦'],
            meta: {
              songId: 'song-1',
              albumName: '叶惠美',
              picUrl: 'https://img.invalid/qingtian.jpg',
              qualitys: ['128k', '320k'],
            },
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const script = `
    const { EVENT_NAMES, request, on, send, utils, currentScriptInfo } = globalThis.lx;
    request('https://lx.example.com/bootstrap', { method: 'GET' }, (error, response) => {
      if (error) throw error;
      if (!response || response.statusCode !== 200 || !response.body || response.body.code !== 0) {
        throw new Error('BOOTSTRAP_FAILED');
      }
      if (!currentScriptInfo.rawScript.includes('lx.example.com/bootstrap')) throw new Error('RAW_SCRIPT_MISSING');
      if (utils.crypto.md5(utils.buffer.from('hello'), 'hex').length !== 32) throw new Error('MD5_FAILED');
      if (utils.stringify.b64Encode('ok') !== 'b2s=') throw new Error('BASE64_FAILED');
      on(EVENT_NAMES.request, ({ action, info }) => {
        if (action === 'musicSearch') return { list: [response.body.data.song] };
        if (action === 'musicUrl') return { url: 'https://audio.invalid/track.mp3', headers: { Referer: 'https://origin.invalid/' } };
        throw new Error('UNKNOWN_ACTION:' + action);
      });
      send(EVENT_NAMES.inited, {
        name: 'Runtime Probe',
        version: '1.0.0',
        sources: {
          kw: {
            type: 'music',
            actions: ['musicSearch', 'musicUrl'],
            qualitys: ['kw', '128k', '320k'],
          },
        },
      });
    });
  `;

  const imported = await manager.importSource({ sourceType: 'file', sourcePath: 'probe.js', rawScript: script });
  assert.equal(imported.initStatus, 'ready');
  assert.deepEqual(imported.supportedSources, ['kw']);
  assert.deepEqual(manager.listSources()[0].supportedSources, ['kw']);

  const searchResult = await manager.searchAll('晴天', 5, 0);
  assert.equal(searchResult.songs.length, 1);
  assert.equal(searchResult.songs[0].provider, 'lx');
  assert.equal(searchResult.songs[0].lxOriginSource, 'kw');
  assert.deepEqual(searchResult.songs[0].lxQualitys, ['128k', '320k']);

  const playback = await manager.resolveSongUrl({
    lxSourceScriptId: searchResult.songs[0].lxSourceScriptId,
    lxOriginSource: searchResult.songs[0].lxOriginSource,
    lxMusicInfo: searchResult.songs[0].lxMusicInfo,
    lxQualitys: searchResult.songs[0].lxQualitys,
    quality: 'lossless',
  });
  assert.equal(playback.url, 'https://audio.invalid/track.mp3');
  assert.equal(playback.headers.referer, 'https://origin.invalid/');
  assert.ok(requests.some((entry) => entry === 'https://lx.example.com/bootstrap'));

  try { fs.unlinkSync(storeFile); } catch (_) {}
});

test('LX playback falls through to the next imported resolver for the same source', async () => {
  const storeFile = createTempStoreFile();
  const manager = createLxSourceManager({ storeFile });

  const failingScript = `
    const { EVENT_NAMES, on, send } = globalThis.lx;
    on(EVENT_NAMES.request, ({ action }) => {
      if (action === 'musicUrl') return { url: '' };
    });
    send(EVENT_NAMES.inited, {
      name: 'Failing Resolver',
      version: '1.0.0',
      sources: {
        kw: {
          type: 'music',
          actions: ['musicUrl'],
          qualitys: ['128k'],
        },
      },
    });
  `;
  const workingScript = `
    const { EVENT_NAMES, on, send } = globalThis.lx;
    on(EVENT_NAMES.request, ({ action, info }) => {
      if (action === 'musicUrl' && info && info.musicInfo && info.musicInfo.meta.songId === 'song-1') {
        return { url: 'https://audio.invalid/fallback.mp3', headers: { Referer: 'https://fallback.invalid/' } };
      }
    });
    send(EVENT_NAMES.inited, {
      name: 'Working Resolver',
      version: '1.0.0',
      sources: {
        kw: {
          type: 'music',
          actions: ['musicUrl'],
          qualitys: ['128k'],
        },
      },
    });
  `;

  const first = await manager.importSource({ sourceType: 'file', sourcePath: 'failing.js', rawScript: failingScript });
  const second = await manager.importSource({ sourceType: 'file', sourcePath: 'working.js', rawScript: workingScript });

  const playback = await manager.resolveSongUrl({
    lxSourceScriptId: first.id,
    lxSourceName: first.name,
    lxOriginSource: 'kw',
    lxMusicInfo: {
      name: '晴天',
      singer: ['周杰伦'],
      source: 'kw',
      interval: 240,
      meta: { songId: 'song-1', albumName: '叶惠美' },
    },
    lxQualitys: ['128k'],
  });

  assert.equal(playback.url, 'https://audio.invalid/fallback.mp3');
  assert.equal(playback.scriptId, second.id);
  assert.equal(playback.headers.referer, 'https://fallback.invalid/');

  try { fs.unlinkSync(storeFile); } catch (_) {}
});
