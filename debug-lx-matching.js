// LX音源匹配逻辑调试工具
// 用于诊断为什么同样的歌曲在LX Desktop能播放，在Mineradio不能播放

const http = require('http');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(body))
      } : {}
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// 模拟server.js中的艺术家匹配逻辑
function normalizeArtistList(str) {
  if (!str) return [];
  const raw = String(str).toLowerCase();
  const replaced = raw
    .replace(/[\/、&;|\\]/g, ',')
    .replace(/[()【\[\]{}（）]/g, '')
    .replace(/[·•·]/g, '');
  return replaced
    .split(',')
    .map(s => s
      .trim()
      .replace(/[\s\-_\.]+/g, '')
      .replace(/[^\w]/g, ''))
    .filter(Boolean);
}

function lxStyleNormalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[()（）【】\[\]<>《》""''「」『』]/g, '')
    .replace(/[\s\-_·•]/g, '')
    .replace(/[^\w一-龥]/g, '');
}

function lxStyleSplitArtists(artist) {
  if (!artist) return [];
  return String(artist)
    .split(/[\/、&,，;；]/)
    .map(s => s.trim())
    .filter(Boolean);
}

async function main() {
  console.log('=== LX音源匹配逻辑诊断 ===\n');

  const songName = '简单爱';
  const artistName = '周杰伦';

  console.log(`目标歌曲: ${songName} - ${artistName}\n`);

  // 1. 测试艺术家归一化
  console.log('【步骤1】测试艺术家名称归一化');
  const artistVariants = [
    '周杰伦',
    'Jay Chou',
    '周杰伦/方文山',
    '周杰伦、方文山',
    '周杰伦 & 方文山',
    '周杰伦,方文山'
  ];

  console.log('不同格式的艺术家名称归一化结果：');
  artistVariants.forEach(variant => {
    const normalized = normalizeArtistList(variant);
    const lxStyle = lxStyleSplitArtists(variant).map(s => lxStyleNormalizeText(s));
    console.log(`  "${variant}"`);
    console.log(`    -> normalizeArtistList: [${normalized.join(', ')}]`);
    console.log(`    -> lxStyle: [${lxStyle.join(', ')}]`);
  });
  console.log('');

  // 2. 搜索各平台的结果
  console.log('【步骤2】在各平台搜索歌曲');

  const platforms = [
    { name: '网易云', endpoint: '/api/search', key: 'wy' },
    { name: 'QQ音乐', endpoint: '/api/qq/search', key: 'tx' },
    { name: '酷狗', endpoint: '/api/kugou/search', key: 'kg' }
  ];

  const platformResults = {};

  for (const platform of platforms) {
    try {
      console.log(`\n  [${platform.name}] 搜索中...`);
      const result = await request('GET', `${platform.endpoint}?keywords=${encodeURIComponent(songName + ' ' + artistName)}&limit=5`);

      if (result.songs && result.songs.length > 0) {
        console.log(`  找到 ${result.songs.length} 个结果:`);
        result.songs.slice(0, 3).forEach((song, i) => {
          console.log(`    [${i+1}] ${song.name} - ${song.artist}`);
          console.log(`        ID: ${song.id || song.mid || song.hash}`);
          console.log(`        专辑: ${song.album || song.albumName || '无'}`);
          console.log(`        时长: ${Math.round((song.duration || song.dt || 0) / 1000)}秒`);

          // 检查归一化后的匹配度
          const normalizedName = lxStyleNormalizeText(song.name);
          const normalizedArtist = lxStyleNormalizeText(song.artist);
          const targetName = lxStyleNormalizeText(songName);
          const targetArtist = lxStyleNormalizeText(artistName);

          const nameMatch = normalizedName === targetName || normalizedName.includes(targetName) || targetName.includes(normalizedName);
          const artistMatch = normalizedArtist.includes(targetArtist) || targetArtist.includes(normalizedArtist);

          console.log(`        匹配: 歌名${nameMatch ? '✓' : '✗'} 歌手${artistMatch ? '✓' : '✗'}`);
        });

        platformResults[platform.key] = result.songs[0];
      } else {
        console.log(`  ✗ 无结果`);
      }
    } catch (e) {
      console.log(`  ✗ 搜索失败: ${e.message}`);
    }
  }

  console.log('\n【步骤3】测试跨平台匹配逻辑');

  // 模拟Mineradio的跨平台匹配
  if (Object.keys(platformResults).length > 0) {
    console.log('\n从网易云搜索结果出发，测试能否在其它平台找到匹配：');

    const wyResult = platformResults.wy;
    if (wyResult) {
      console.log(`\n  网易云原始结果: ${wyResult.name} - ${wyResult.artist}`);
      console.log(`  时长: ${Math.round((wyResult.duration || wyResult.dt || 0) / 1000)}秒`);

      // 测试能否在QQ音乐和酷狗找到匹配
      for (const key of ['tx', 'kg']) {
        const candidate = platformResults[key];
        if (candidate) {
          const platformName = key === 'tx' ? 'QQ音乐' : '酷狗';
          console.log(`\n  与${platformName}候选对比: ${candidate.name} - ${candidate.artist}`);

          // 歌名匹配
          const wyName = lxStyleNormalizeText(wyResult.name);
          const candName = lxStyleNormalizeText(candidate.name);
          const nameExactMatch = wyName === candName;
          const nameIncludeMatch = wyName.includes(candName) || candName.includes(wyName);

          // 歌手匹配
          const wyArtist = lxStyleSplitArtists(wyResult.artist).sort().join('、');
          const candArtist = lxStyleSplitArtists(candidate.artist).sort().join('、');
          const artistExactMatch = lxStyleNormalizeText(wyArtist) === lxStyleNormalizeText(candArtist);
          const artistIncludeMatch = lxStyleNormalizeText(wyArtist).includes(lxStyleNormalizeText(candArtist)) ||
                                     lxStyleNormalizeText(candArtist).includes(lxStyleNormalizeText(wyArtist));

          // 时长匹配（误差15秒内）
          const wyDuration = Math.round((wyResult.duration || wyResult.dt || 0) / 1000);
          const candDuration = Math.round((candidate.duration || candidate.dt || 0) / 1000);
          const durationMatch = Math.abs(wyDuration - candDuration) <= 15;

          console.log(`    歌名: "${wyName}" vs "${candName}"`);
          console.log(`      完全匹配: ${nameExactMatch ? '✓' : '✗'}, 包含匹配: ${nameIncludeMatch ? '✓' : '✗'}`);
          console.log(`    歌手: "${lxStyleNormalizeText(wyArtist)}" vs "${lxStyleNormalizeText(candArtist)}"`);
          console.log(`      完全匹配: ${artistExactMatch ? '✓' : '✗'}, 包含匹配: ${artistIncludeMatch ? '✓' : '✗'}`);
          console.log(`    时长: ${wyDuration}秒 vs ${candDuration}秒 (误差${Math.abs(wyDuration - candDuration)}秒)`);
          console.log(`      时长匹配: ${durationMatch ? '✓' : '✗'}`);

          const wouldMatch = (nameExactMatch && artistIncludeMatch && durationMatch) ||
                            (artistExactMatch && nameIncludeMatch && durationMatch);

          console.log(`    → 最终判断: ${wouldMatch ? '✓ 会匹配' : '✗ 不会匹配'}`);

          if (wouldMatch) {
            console.log(`    → 会使用此候选调用LX音源的musicUrl接口`);
          }
        }
      }
    }
  }

  console.log('\n【步骤4】检查LX音源能力');

  try {
    const sources = await request('GET', '/api/lx/sources');
    if (sources.sources && sources.sources.length > 0) {
      console.log('\n已导入的LX音源:');
      sources.sources.forEach((s, i) => {
        console.log(`\n  [${i+1}] ${s.name} v${s.version}`);
        console.log(`      状态: ${s.initStatus}`);
        console.log(`      支持平台: ${s.supportedSources?.join(', ') || '未知'}`);
        console.log(`      能力: ${s.searchEnabled ? '搜索' : ''}${s.urlResolveEnabled ? ' 解析URL' : ''}`);
        if (s.initError) {
          console.log(`      ⚠️ 错误: ${s.initError}`);
        }

        // 检查是否支持网易云/QQ/酷狗
        const supportedMap = {
          'wy': '网易云',
          'tx': 'QQ音乐',
          'kg': '酷狗'
        };

        if (s.supportedSources && s.supportedSources.length > 0) {
          console.log(`      → 可解析: ${s.supportedSources.map(key => supportedMap[key] || key).join(', ')}`);
        }
      });
    } else {
      console.log('\n  ⚠️ 没有导入任何LX音源！');
    }
  } catch (e) {
    console.log(`\n  ✗ 获取LX音源列表失败: ${e.message}`);
  }

  console.log('\n【步骤5】实际测试LX接管');

  if (platformResults.wy) {
    const song = platformResults.wy;
    console.log(`\n使用网易云结果测试LX接管...`);

    const lxPayload = {
      source: 'netease',
      song: {
        name: song.name,
        artist: song.artist,
        artists: song.artists || [{name: song.artist}],
        album: song.album || song.albumName || '',
        duration: song.duration || song.dt || 0
      },
      quality: 'exhigh'
    };

    try {
      console.log(`\n发送到 /api/lx/search-and-url:`);
      console.log(JSON.stringify(lxPayload, null, 2));

      const lxResult = await request('POST', '/api/lx/search-and-url', lxPayload);

      console.log(`\n返回结果:`);
      console.log(`  playable: ${lxResult.playable}`);
      console.log(`  url: ${lxResult.url ? '✓ 有' : '✗ 无'}`);
      console.log(`  error: ${lxResult.error || '无'}`);

      if (lxResult.matchedSong) {
        console.log(`\n  匹配到的歌曲:`);
        console.log(`    歌名: ${lxResult.matchedSong.name}`);
        console.log(`    歌手: ${lxResult.matchedSong.artist}`);
        console.log(`    平台: ${lxResult.matchedSong.source}`);
        if (lxResult.matchedSong.musicInfo) {
          console.log(`    musicInfo.meta.songId: ${lxResult.matchedSong.musicInfo.meta?.songId || '无'}`);
        }
      }

      if (lxResult.scriptName) {
        console.log(`\n  使用的LX音源: ${lxResult.scriptName}`);
      }

      if (!lxResult.url) {
        console.log(`\n  ⚠️ 失败原因分析:`);
        if (lxResult.error === 'LX_SEARCH_NO_CANDIDATE') {
          console.log(`    → 在其它平台搜索时没有找到匹配的候选歌曲`);
          console.log(`    → 可能的原因:`);
          console.log(`       - 艺术家名称格式不匹配`);
          console.log(`       - 歌名有差异（括号、版本等）`);
          console.log(`       - 时长误差超过15秒`);
        } else if (lxResult.error === 'LX_RESOLVE_EMPTY') {
          console.log(`    → 找到了候选但LX音源无法解析出URL`);
          console.log(`    → 可能的原因:`);
          console.log(`       - musicInfo结构不完整`);
          console.log(`       - LX音源脚本本身的问题`);
          console.log(`       - 平台ID格式不正确`);
        }
      } else {
        console.log(`\n  ✓ 成功！`);
      }

    } catch (e) {
      console.log(`\n  ✗ 请求失败: ${e.message}`);
    }
  }

  console.log('\n=== 诊断完成 ===\n');
  console.log('【总结建议】');
  console.log('如果发现问题，请检查:');
  console.log('1. 艺术家名称格式是否一致（/、,、& 等分隔符）');
  console.log('2. 歌名是否有括号、版本信息等差异');
  console.log('3. 时长误差是否在15秒内');
  console.log('4. LX音源是否支持匹配到的平台');
  console.log('5. musicInfo是否包含正确的songId/hash等字段');
  console.log('');
}

main().catch(console.error);
