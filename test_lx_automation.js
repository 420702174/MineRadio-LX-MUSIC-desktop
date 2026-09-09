// 自动化测试脚本：遍历 D:/lxMusic/mucis 下的所有 LX 音源，导入后搜索 "Baby - Justin Bieber"
// 并尝试通过接管流程获取可播放 URL。
// 运行前请确保本地 server.js 已经以 PORT=38889 启动（后台）。
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 38889;
const HOST = '127.0.0.1';
const SCRIPTS_DIR = 'D:/lxMusic/mucis';
const LOG_FILE = 'd:/code/Mineradio-main/automation.log';

// 清空旧日志
fs.writeFileSync(LOG_FILE, '');

function log(...args) {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: HOST,
      port: PORT,
      path: p,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { resolve({ raw: buf, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function importScript(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const resp = await request('POST', '/api/lx/source/import-file', {
    sourcePath: file,
    rawScript: raw
  });
  return resp;
}

async function listSources() {
  return await request('GET', '/api/lx/sources');
}

async function searchBaby() {
  return await request('GET', '/api/search?keywords=' + encodeURIComponent('Baby Justin Bieber') + '&limit=10');
}

async function searchAndUrl(song) {
  return await request('POST', '/api/lx/search-and-url', {
    source: 'netease',
    song: {
      name: song.name,
      artist: song.artist,
      artists: song.artists,
      duration: song.duration,
      album: song.album
    }
  });
}

async function playSongDirect(song) {
  // 直接调 /api/song/url 看是否拿到原始 netease URL（与播放器同样的流程）
  const url = '/api/song/url?id=' + encodeURIComponent(song.id || '') +
    '&name=' + encodeURIComponent(song.name) +
    '&artist=' + encodeURIComponent(song.artist) +
    '&quality=standard';
  return await request('GET', url);
}

async function main() {
  log('========== 自动化 LX 接管测试开始 ==========');
  log('时间:', new Date().toISOString());
  log('');

  // 1) 列出当前已导入的 LX 源
  const current = await listSources();
  log('已导入 LX 源数量:', (current.sources || []).length);
  for (const s of (current.sources || [])) {
    log('  -', s.name, '(', s.id, ') status=', s.initStatus);
  }
  log('');

  // 2) 遍历 mucis 目录下的所有脚本，导入每个
  const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js'));
  log('发现脚本文件', files.length, '个，开始导入...');
  for (const f of files) {
    const full = path.join(SCRIPTS_DIR, f);
    log('--- 导入', f, '---');
    try {
      const r = await importScript(full);
      if (r.ok === false) {
        log('  导入失败:', r.error);
      } else {
        const src = (r.sources || []).find(s => s.sourcePath === full);
        if (src) {
          log('  导入成功, status=', src.initStatus, ', supportedSources=', JSON.stringify(src.supportedSources));
        } else {
          log('  导入成功（但找不到对应 source）');
        }
      }
    } catch (e) {
      log('  异常:', e.message);
    }
  }
  log('');

  // 3) 查看导入后的 LX 源状态
  const after = await listSources();
  log('导入后 LX 源数量:', (after.sources || []).length);
  for (const s of (after.sources || [])) {
    log('  -', s.name, '(', s.id, ') status=', s.initStatus);
  }
  log('');

  // 4) 搜索 "Baby Justin Bieber"（使用项目自己的 /api/search）
  log('--- 搜索 Baby Justin Bieber ---');
  const search = await searchBaby();
  const songs = (search.songs || []).slice(0, 5);
  log('搜索到候选', (search.songs || []).length, '条，前 5 条:');
  for (const s of songs) {
    log('  -', s.name, '/', s.artist, '(id=', s.id, ')');
  }
  if (!songs.length) {
    log('!! 搜索无结果，测试中止');
    return;
  }
  const target = songs[0];
  log('选择候选:', target.name, '/', target.artist, '/', target.id);
  log('');

  // 5) 直接调 /api/song/url 获取 netease 原始 URL（看看 VIP/试听场景）
  log('--- 直接调 /api/song/url (netease) ---');
  const direct = await playSongDirect(target);
  log('响应:', JSON.stringify(direct).slice(0, 400));
  log('');

  // 6) 调用接管接口
  log('--- 调用 /api/lx/search-and-url ---');
  const lx = await searchAndUrl(target);
  log('响应:', JSON.stringify(lx).slice(0, 600));
  log('');

  // 7) 统计
  log('========== 自动化测试结束 ==========');
  if (lx && lx.url) {
    log('✅ LX 接管成功，返回 URL:', lx.url);
  } else {
    log('❌ LX 接管未返回 URL，error=', lx.error || lx.message || 'unknown');
  }
}

main().catch(e => {
  log('!! 主流程异常:', e.stack || e.message);
  process.exit(1);
});
