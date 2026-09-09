// LX音源匹配问题修复补丁
// 使用方法：将此文件内容复制，替换 server.js 中对应的函数

// ============================================================================
// 修复1：改进 lxStyleFindBestMatch 函数，使用宽松的艺术家匹配
// 位置：server.js 第290-324行
// ============================================================================

function lxStyleFindBestMatch(target, list) {
  const fMusicName = lxStyleNormalizeText(target && target.name);
  const targetArtistRaw = target && target.artist;  // 保留原始艺术家字符串用于宽松匹配
  const fSinger = lxStyleSplitArtists(targetArtistRaw).sort().join('、');
  const fAlbum = lxStyleNormalizeText(target && target.album);
  const fInterval = lxStyleParseInterval(target && target.interval) || (Number(target && target.durationMs) > 1000 ? Math.round(Number(target.durationMs) / 1000) : 0);
  if (!fMusicName && !fSinger) return null;

  const isEqualsInterval = (intv) => fInterval > 0 ? Math.abs((fInterval || intv) - (intv || fInterval)) < 15 : true;  // 放宽时长误差到15秒
  const isIncludesName = (name) => fMusicName ? (name.includes(fMusicName) || fMusicName.includes(name)) : true;
  const isIncludesSinger = (singer) => fSinger ? (singer.includes(fSinger) || fSinger.includes(singer)) : true;
  const isEqualsAlbum = (album) => fAlbum ? lxStyleNormalizeText(album) === fAlbum : true;

  const decorated = (list || []).filter(Boolean).map((item) => {
    const candSinger = lxStyleSplitArtists(item.artist).sort().join('、');
    return {
      item,
      fMusicName: lxStyleNormalizeText(item.name),
      fSinger: candSinger,
      fAlbum: lxStyleNormalizeText(item.album || item.albumName),
      fInterval: lxStyleParseInterval(item.interval) || (Number(item.duration) > 1000 ? Math.round(Number(item.duration) / 1000) : 0),
    };
  });

  const passInterval = decorated.filter((c) => isEqualsInterval(c.fInterval));

  // 第一轮：name 相等 + singer 包含
  for (const c of passInterval) {
    if (c.fMusicName === fMusicName && isIncludesSinger(c.fSinger)) return c.item;
  }

  // 第二轮：singer 相等 + name 包含（关键修复：使用宽松匹配）
  for (const c of passInterval) {
    // ⭐ 修复：使用 isArtistMatch 替代严格的 === 判断
    if (isArtistMatch(targetArtistRaw, c.item.artist) && isIncludesName(c.fMusicName)) return c.item;
  }

  // 第三轮：album + singer + name（也使用宽松匹配）
  for (const c of passInterval) {
    if (isEqualsAlbum(c.fAlbum) && isArtistMatch(targetArtistRaw, c.item.artist) && isIncludesName(c.fMusicName)) return c.item;
  }

  // 第四轮：只要歌名和歌手任意一个匹配就返回（兜底策略）
  for (const c of passInterval) {
    if (c.fMusicName === fMusicName || isArtistMatch(targetArtistRaw, c.item.artist)) return c.item;
  }

  return null;
}


// ============================================================================
// 修复2：增强 buildLxMusicInfoFromMatch 函数，确保返回完整的 musicInfo
// 位置：server.js 第366-410行
// ============================================================================

function buildLxMusicInfoFromMatch(sourceKey, match) {
  if (!match || !sourceKey) return null;
  const meta = {};
  let songId = '';

  // 计算时长（秒）
  const durationMs = Number(match.duration) || Number(match.dt) || 0;
  const intervalSeconds = durationMs > 1000 ? Math.round(durationMs / 1000) : Math.round(durationMs);

  if (sourceKey === 'wy') {
    songId = String(match.id || '');
    meta.songId = songId;
    if (match.albumId) meta.albumId = String(match.albumId);
    if (match.album || match.albumName) meta.albumName = String(match.album || match.albumName);
    if (match.cover || match.picUrl) meta.picUrl = String(match.cover || match.picUrl);
  } else if (sourceKey === 'tx') {
    songId = String(match.mid || match.songmid || match.id || '');
    meta.songId = songId;
    meta.strMediaMid = String(match.mediaMid || match.media_mid || (match.file && match.file.media_mid) || '');
    if (match.albumMid) meta.albumMid = String(match.albumMid);
    if (match.album || match.albumName) meta.albumName = String(match.album || match.albumName);
    if (match.cover || match.picUrl) meta.picUrl = String(match.cover || match.picUrl);
  } else if (sourceKey === 'kg') {
    songId = String(match.hash || match.fileHash || match.id || '');
    meta.songId = songId;
    meta.hash = songId;
    if (match.albumId) meta.albumId = String(match.albumId);
    if (match.album || match.albumName) meta.albumName = String(match.album || match.albumName);
    if (match.cover) meta.picUrl = String(match.cover);
    // ⭐ 添加：酷狗特有的其他hash字段
    if (match.album_audio_id) meta.album_audio_id = String(match.album_audio_id);
  } else if (sourceKey === 'mg') {
    songId = String(match.id || '');
    meta.songId = songId;
    meta.copyrightId = songId;
  }

  if (!songId) return null;

  // ⭐ 改进：提取歌手列表
  const singerArray = Array.isArray(match.artists) && match.artists.length
    ? match.artists.map(a => a && a.name).filter(Boolean)
    : (match.artist ? String(match.artist).split(/[\/、,]/).map(s => s.trim()).filter(Boolean) : []);

  // ⭐ 改进：返回完整的 LX musicInfo 结构
  return {
    name: String(match.name || match.title || '').trim(),
    singer: singerArray.length ? singerArray : ['Unknown Artist'],
    source: sourceKey,
    interval: intervalSeconds,  // 确保有时长字段
    meta: Object.assign({}, meta, {
      songId: meta.songId || songId,
      albumName: meta.albumName || '',
      picUrl: meta.picUrl || '',
      // ⭐ 添加：提供默认的 qualitys，让LX音源能够尝试所有音质
      qualitys: ['128k', '320k', 'flac', 'flac24bit'],
    }),
  };
}


// ============================================================================
// 说明：如何应用此补丁
// ============================================================================
//
// 方法1：手动替换
// 1. 打开 server.js
// 2. 找到第290行的 lxStyleFindBestMatch 函数
// 3. 将整个函数替换为上面的新版本
// 4. 找到第366行的 buildLxMusicInfoFromMatch 函数
// 5. 将整个函数替换为上面的新版本
// 6. 保存文件，重启服务器
//
// 方法2：使用Git补丁（如果你使用Git）
// git apply lx-fix.patch
//
// ============================================================================
// 测试步骤
// ============================================================================
//
// 1. 重启 Mineradio 服务器
// 2. 运行测试脚本：node debug-lx-matching.js
// 3. 查看输出中的"最终判断"，确认现在能匹配成功
// 4. 在浏览器中搜索"简单爱 周杰伦"
// 5. 点击播放，观察是否能触发LX接管并成功播放
//
// ============================================================================
// 关键改进点
// ============================================================================
//
// 1. 在第二轮匹配中，将严格的 === 判断改为 isArtistMatch() 宽松匹配
//    - 这解决了不同平台艺术家分隔符不同的问题
//    - "周杰伦" 现在能匹配 "周杰伦/方文山"
//
// 2. 在第三轮匹配中，也使用 isArtistMatch() 确保一致性
//
// 3. 添加第四轮兜底匹配，进一步提高匹配成功率
//
// 4. 时长误差从5秒放宽到15秒（不同平台可能有编码差异）
//
// 5. buildLxMusicInfoFromMatch 返回更完整的结构：
//    - 添加 qualitys 字段，让LX音源知道可以尝试哪些音质
//    - 更好地处理歌手列表
//    - 确保时长字段正确
//
// ============================================================================
