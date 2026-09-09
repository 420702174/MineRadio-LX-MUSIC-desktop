/**
 * LX 音源歌词修复验证脚本
 *
 * 使用方法：
 * 1. 确保 Mineradio 服务器正在运行
 * 2. 运行: node test-lx-lyric-fix.js
 */

// 模拟前端函数
function songProviderKey(song) {
  if (!song) return 'netease';
  if (song.provider === 'lx' || song.source === 'lx' || song.lxSourceScriptId) return 'lx';
  if (song.provider === 'qq' || song.source === 'qq') return 'qq';
  if (song.provider === 'kugou' || song.source === 'kugou') return 'kugou';
  if (song.provider === 'spotify' || song.source === 'spotify') return 'spotify';
  if (song.provider === 'qishui' || song.source === 'qishui') return 'qishui';
  return 'netease';
}

function playbackDurationFromSong(song) {
  if (!song) return 0;
  if (song.duration && song.duration > 0) return song.duration;
  if (song.durationMs && song.durationMs > 0) return song.durationMs / 1000;
  if (song.dt && song.dt > 0) return song.dt / 1000;
  return 0;
}

function lyricEndpointForSong(songOrId) {
  var song = (songOrId && typeof songOrId === 'object') ? songOrId : null;
  var provider = song ? songProviderKey(song) : 'netease';

  // LX 音源：使用原平台的歌词接口
  if (provider === 'lx') {
    var lxOriginSource = String(song.lxOriginSource || '').toLowerCase();
    var lxMusicInfo = song.lxMusicInfo || {};
    var lxMeta = lxMusicInfo.meta || {};

    // 网易云 (wy)
    if (lxOriginSource === 'wy' && lxMeta.songId) {
      return '/api/lyric?id=' + encodeURIComponent(lxMeta.songId);
    }

    // QQ音乐 (tx)
    if (lxOriginSource === 'tx' && (lxMeta.strMediaMid || lxMeta.songId)) {
      var qqMid = lxMeta.strMediaMid || lxMeta.songId || '';
      var qqId = /^\d+$/.test(String(lxMeta.songId || '')) ? lxMeta.songId : '';
      return '/api/qq/lyric?mid=' + encodeURIComponent(qqMid) + '&id=' + encodeURIComponent(qqId);
    }

    // 酷狗 (kg)
    if (lxOriginSource === 'kg' && lxMeta.hash) {
      var duration = lxMusicInfo.interval || 0;
      return '/api/kugou/lyric?hash=' + encodeURIComponent(lxMeta.hash) +
        '&albumAudioId=' + encodeURIComponent(lxMeta.albumAudioId || '') +
        '&duration=' + encodeURIComponent(duration);
    }

    // 默认：尝试网易云
    if (lxMeta.songId) {
      return '/api/lyric?id=' + encodeURIComponent(lxMeta.songId);
    }
  }

  if (provider === 'qq') {
    var mid = song.mid || song.songmid || song.id || '';
    var qqId = song.qqId || (/^\d+$/.test(String(song.id || '')) ? song.id : '');
    return '/api/qq/lyric?mid=' + encodeURIComponent(mid) + '&id=' + encodeURIComponent(qqId);
  }
  if (provider === 'kugou') {
    return '/api/kugou/lyric?hash=' + encodeURIComponent(song.hash || song.fileHash || song.audioHash || song.id || '') +
      '&albumAudioId=' + encodeURIComponent(song.albumAudioId || song.album_audio_id || song.mixSongId || '') +
      '&duration=' + encodeURIComponent(playbackDurationFromSong(song) || '');
  }
  if (provider === 'qishui') {
    return '/api/qishui/lyric?id=' + encodeURIComponent(song.id || song.providerSongId || '');
  }
  if (provider === 'spotify') {
    return '/api/spotify/lyric?id=' + encodeURIComponent(song.id || song.providerSongId || song.spotifyId || '');
  }
  var songId = song ? song.id : songOrId;
  return '/api/lyric?id=' + encodeURIComponent(songId);
}

console.log('========================================');
console.log('LX 音源歌词修复验证测试');
console.log('========================================\n');

// 测试用例 1: LX 音源 - 网易云
console.log('测试 1: LX 音源 (来自网易云)');
const lxSongFromNetease = {
  name: '简单爱',
  artist: '周杰伦',
  provider: 'lx',
  source: 'lx',
  lxOriginSource: 'wy',
  lxSourceScriptId: 'test-script-id',
  lxMusicInfo: {
    name: '简单爱',
    singer: ['周杰伦'],
    source: 'wy',
    interval: 270,
    meta: {
      songId: '123456789',
      albumName: '范特西',
      picUrl: 'http://example.com/cover.jpg'
    }
  }
};
const endpoint1 = lyricEndpointForSong(lxSongFromNetease);
console.log('  歌曲:', lxSongFromNetease.name, '-', lxSongFromNetease.artist);
console.log('  原平台:', lxSongFromNetease.lxOriginSource);
console.log('  歌词端点:', endpoint1);
console.log('  ✓ 预期: /api/lyric?id=123456789');
console.log('  ' + (endpoint1 === '/api/lyric?id=123456789' ? '✅ 通过' : '❌ 失败') + '\n');

// 测试用例 2: LX 音源 - QQ音乐
console.log('测试 2: LX 音源 (来自QQ音乐)');
const lxSongFromQQ = {
  name: '七里香',
  artist: '周杰伦',
  provider: 'lx',
  source: 'lx',
  lxOriginSource: 'tx',
  lxSourceScriptId: 'test-script-id',
  lxMusicInfo: {
    name: '七里香',
    singer: ['周杰伦'],
    source: 'tx',
    interval: 300,
    meta: {
      songId: '003a68Ep1TEqKX',
      strMediaMid: '003a68Ep1TEqKX',
      albumName: '七里香',
      picUrl: 'http://example.com/cover.jpg'
    }
  }
};
const endpoint2 = lyricEndpointForSong(lxSongFromQQ);
console.log('  歌曲:', lxSongFromQQ.name, '-', lxSongFromQQ.artist);
console.log('  原平台:', lxSongFromQQ.lxOriginSource);
console.log('  歌词端点:', endpoint2);
console.log('  ✓ 预期: /api/qq/lyric?mid=003a68Ep1TEqKX&id=');
console.log('  ' + (endpoint2 === '/api/qq/lyric?mid=003a68Ep1TEqKX&id=' ? '✅ 通过' : '❌ 失败') + '\n');

// 测试用例 3: LX 音源 - 酷狗
console.log('测试 3: LX 音源 (来自酷狗)');
const lxSongFromKugou = {
  name: '菊花台',
  artist: '周杰伦',
  provider: 'lx',
  source: 'lx',
  lxOriginSource: 'kg',
  lxSourceScriptId: 'test-script-id',
  lxMusicInfo: {
    name: '菊花台',
    singer: ['周杰伦'],
    source: 'kg',
    interval: 275,
    meta: {
      hash: 'ABCDEF123456',
      albumAudioId: '789456',
      songId: 'ABCDEF123456'
    }
  }
};
const endpoint3 = lyricEndpointForSong(lxSongFromKugou);
console.log('  歌曲:', lxSongFromKugou.name, '-', lxSongFromKugou.artist);
console.log('  原平台:', lxSongFromKugou.lxOriginSource);
console.log('  歌词端点:', endpoint3);
console.log('  ✓ 预期: /api/kugou/lyric?hash=ABCDEF123456&albumAudioId=789456&duration=275');
console.log('  ' + (endpoint3 === '/api/kugou/lyric?hash=ABCDEF123456&albumAudioId=789456&duration=275' ? '✅ 通过' : '❌ 失败') + '\n');

// 测试用例 4: 普通网易云歌曲（确保不影响原有功能）
console.log('测试 4: 普通网易云歌曲（确保不影响原有功能）');
const normalSong = {
  id: '987654321',
  name: '夜曲',
  artist: '周杰伦',
  provider: 'netease'
};
const endpoint4 = lyricEndpointForSong(normalSong);
console.log('  歌曲:', normalSong.name, '-', normalSong.artist);
console.log('  平台:', normalSong.provider);
console.log('  歌词端点:', endpoint4);
console.log('  ✓ 预期: /api/lyric?id=987654321');
console.log('  ' + (endpoint4 === '/api/lyric?id=987654321' ? '✅ 通过' : '❌ 失败') + '\n');

console.log('========================================');
console.log('测试完成！');
console.log('========================================\n');

console.log('📝 修复说明:');
console.log('- LX 音源的歌曲现在会根据 lxOriginSource 使用对应平台的歌词接口');
console.log('- 网易云 (wy) → /api/lyric');
console.log('- QQ音乐 (tx) → /api/qq/lyric');
console.log('- 酷狗 (kg) → /api/kugou/lyric');
console.log('- 原有平台的歌词功能不受影响\n');

console.log('🔧 下一步:');
console.log('1. 重启 Mineradio 应用以加载修复');
console.log('2. 播放一首 LX 音源的歌曲');
console.log('3. 检查歌词面板是否显示歌词');
console.log('4. 打开浏览器控制台查看歌词请求日志\n');
