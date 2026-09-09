// LX 音源歌词调试脚本
// 使用方法：在浏览器控制台直接粘贴运行

console.log('========================================');
console.log('LX 音源歌词调试');
console.log('========================================\n');

// 1. 检查当前播放的歌曲
console.log('1. 当前播放歌曲信息:');
if (typeof currentIdx !== 'undefined' && Array.isArray(playQueue) && playQueue[currentIdx]) {
  const song = playQueue[currentIdx];
  console.log('  歌曲名:', song.name);
  console.log('  歌手:', song.artist);
  console.log('  provider:', song.provider || song.source);
  console.log('  lxSourceScriptId:', song.lxSourceScriptId);
  console.log('  lxOriginSource:', song.lxOriginSource);
  console.log('  lxMusicInfo:', song.lxMusicInfo);
  console.log('\n  完整歌曲对象:');
  console.log(song);
} else {
  console.log('  ❌ 没有正在播放的歌曲');
}

// 2. 检查 songProviderKey 函数
console.log('\n2. 检查 songProviderKey 函数:');
if (typeof songProviderKey === 'function' && playQueue[currentIdx]) {
  const provider = songProviderKey(playQueue[currentIdx]);
  console.log('  songProviderKey() 返回:', provider);
  console.log('  是否为 lx:', provider === 'lx');
} else {
  console.log('  ❌ songProviderKey 函数不存在');
}

// 3. 检查歌词端点函数
console.log('\n3. 检查 lyricEndpointForSong 函数:');
if (typeof lyricEndpointForSong === 'function' && playQueue[currentIdx]) {
  const endpoint = lyricEndpointForSong(playQueue[currentIdx]);
  console.log('  lyricEndpointForSong() 返回:', endpoint);
} else {
  console.log('  ❌ lyricEndpointForSong 函数不存在');
}

// 4. 检查当前歌词状态
console.log('\n4. 当前歌词状态:');
if (typeof lyricsLines !== 'undefined') {
  console.log('  lyricsLines 长度:', lyricsLines.length);
  console.log('  lyricsLines[0]:', lyricsLines[0]);
  console.log('  是否 fallback:', lyricsLines[0] && lyricsLines[0].fallback);
} else {
  console.log('  ❌ lyricsLines 不存在');
}

if (typeof originalLyricsState !== 'undefined') {
  console.log('  originalLyricsState.lines 长度:', originalLyricsState.lines.length);
  console.log('  originalLyricsState.timingSource:', originalLyricsState.timingSource);
} else {
  console.log('  ❌ originalLyricsState 不存在');
}

// 5. 手动测试歌词获取
console.log('\n5. 手动测试歌词获取:');
if (playQueue[currentIdx]) {
  const song = playQueue[currentIdx];
  console.log('  尝试手动构建歌词端点...');

  // 检查是否是 LX 音源
  const provider = song.provider || song.source;
  if (provider === 'lx' || song.lxSourceScriptId) {
    console.log('  ✓ 确认是 LX 音源');
    console.log('  lxOriginSource:', song.lxOriginSource);

    if (song.lxMusicInfo && song.lxMusicInfo.meta) {
      console.log('  ✓ 存在 lxMusicInfo.meta');
      console.log('  songId:', song.lxMusicInfo.meta.songId);
      console.log('  hash:', song.lxMusicInfo.meta.hash);
      console.log('  strMediaMid:', song.lxMusicInfo.meta.strMediaMid);

      // 构建歌词 URL
      let lyricUrl = '';
      const origin = String(song.lxOriginSource || '').toLowerCase();
      if (origin === 'wy' && song.lxMusicInfo.meta.songId) {
        lyricUrl = '/api/lyric?id=' + song.lxMusicInfo.meta.songId;
      } else if (origin === 'tx' && (song.lxMusicInfo.meta.strMediaMid || song.lxMusicInfo.meta.songId)) {
        const mid = song.lxMusicInfo.meta.strMediaMid || song.lxMusicInfo.meta.songId;
        lyricUrl = '/api/qq/lyric?mid=' + mid;
      } else if (origin === 'kg' && song.lxMusicInfo.meta.hash) {
        lyricUrl = '/api/kugou/lyric?hash=' + song.lxMusicInfo.meta.hash + '&albumAudioId=&duration=' + (song.lxMusicInfo.interval || 0);
      }

      if (lyricUrl) {
        console.log('  ✓ 构建的歌词 URL:', lyricUrl);
        console.log('\n  尝试手动获取歌词...');
        console.log('  在控制台运行以下命令测试:');
        console.log('  fetch("' + lyricUrl + '").then(r => r.json()).then(data => console.log("歌词数据:", data))');
      } else {
        console.log('  ❌ 无法构建歌词 URL，缺少必要字段');
      }
    } else {
      console.log('  ❌ 缺少 lxMusicInfo.meta');
    }
  } else {
    console.log('  ℹ️ 不是 LX 音源，是:', provider);
  }
}

// 6. 检查是否重新加载了文件
console.log('\n6. 检查文件是否已重新加载:');
console.log('  请确认以下操作:');
console.log('  ✓ 已保存修改的 00-lyrics-fetch-parse.js 文件');
console.log('  ✓ 已重启 Mineradio 服务器');
console.log('  ✓ 已刷新浏览器页面 (Ctrl+F5 强制刷新)');

console.log('\n========================================');
console.log('调试完成！请查看上面的输出');
console.log('========================================');
