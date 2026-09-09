// 测试从QQ音乐触发LX接管
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
          resolve({ error: 'PARSE_ERROR', raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testQQtoLX() {
  console.log('=== 测试从QQ音乐触发LX接管 ===\n');

  // 1. 从QQ音乐搜索
  console.log('【步骤1】从QQ音乐搜索"简单爱 周杰伦"...');
  const qqResult = await request('GET', '/api/qq/search?keywords=' + encodeURIComponent('简单爱 周杰伦') + '&limit=5');

  const jaySong = qqResult.songs?.find(s =>
    s.name === '简单爱' && (s.artist === '周杰伦' || s.artist?.includes('周杰伦'))
  );

  if (!jaySong) {
    console.log('  ✗ 未找到\n');
    return;
  }

  console.log(`  ✓ 找到: ${jaySong.name} - ${jaySong.artist}`);
  console.log(`    ID/mid: ${jaySong.mid || jaySong.songmid || jaySong.id}`);
  console.log(`    mediaMid: ${jaySong.mediaMid || jaySong.media_mid || '未知'}`);
  console.log(`    专辑: ${jaySong.album || '未知'}`);
  console.log(`    时长: ${Math.round((jaySong.duration || 0) / 1000)}秒\n`);

  // 2. 测试QQ音乐URL获取
  console.log('【步骤2】测试QQ音乐URL获取（检查是否需要VIP）...');
  const qqUrlResult = await request('GET',
    `/api/qq/song/url?mid=${jaySong.mid || jaySong.songmid || jaySong.id}&mediaMid=${jaySong.mediaMid || jaySong.media_mid || ''}&quality=exhigh`
  );

  console.log(`  URL: ${qqUrlResult.url ? '有' : '无'}`);
  console.log(`  试听: ${qqUrlResult.trial ? '是' : '否'}`);
  console.log(`  VIP要求: ${qqUrlResult.vipRequired ? '是' : '否'}\n`);

  const needsLX = !qqUrlResult.url || qqUrlResult.trial || qqUrlResult.vipRequired;

  if (!needsLX) {
    console.log('  ℹ️ QQ音乐可以直接播放，不会触发LX接管\n');
    return;
  }

  // 3. 触发LX接管
  console.log('【步骤3】触发LX音源接管...');
  console.log('  调用 /api/lx/search-and-url（从QQ音乐作为源平台）\n');

  const lxPayload = {
    source: 'qq',  // 注意：这里是 'qq' 不是 'netease'
    song: {
      name: jaySong.name,
      artist: jaySong.artist,
      artists: jaySong.artists || [{name: jaySong.artist}],
      album: jaySong.album || '',
      duration: jaySong.duration || 0
    },
    quality: 'exhigh'
  };

  console.log('  payload:');
  console.log(JSON.stringify(lxPayload, null, 2));
  console.log('');

  const startTime = Date.now();

  try {
    const lxResult = await request('POST', '/api/lx/search-and-url', lxPayload);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  ⏱️ 耗时: ${elapsed}秒\n`);
    console.log('【结果】');
    console.log(`  playable: ${lxResult.playable}`);
    console.log(`  url: ${lxResult.url ? '✅ 成功' : '❌ 失败'}`);
    console.log(`  error: ${lxResult.error || '无'}\n`);

    if (lxResult.matchedSong) {
      console.log('  匹配信息:');
      console.log(`    歌名: ${lxResult.matchedSong.name}`);
      console.log(`    歌手: ${lxResult.matchedSong.artist}`);
      console.log(`    平台: ${lxResult.matchedSong.source}\n`);

      if (lxResult.matchedSong.musicInfo) {
        const info = lxResult.matchedSong.musicInfo;
        console.log('  musicInfo:');
        console.log(`    name: ${info.name}`);
        console.log(`    singer: ${JSON.stringify(info.singer)}`);
        console.log(`    source: ${info.source}`);
        console.log(`    interval: ${info.interval}`);
        if (info.meta) {
          console.log(`    meta.songId: ${info.meta.songId || '无'}`);
          console.log(`    meta.hash: ${info.meta.hash || '无'}`);
        }
        console.log('');
      }
    }

    if (lxResult.scriptName) {
      console.log(`  使用音源: ${lxResult.scriptName}\n`);
    }

    if (lxResult.url) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅✅✅ 成功！LX音源可以播放这首歌！');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log(`URL: ${lxResult.url.substring(0, 100)}...\n`);
      console.log('这说明LX接管功能正常工作。');
      console.log('如果界面还是跳过，可能是前端的问题。\n');
    } else {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('❌ LX接管失败');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      if (lxResult.error === 'LX_SEARCH_NO_CANDIDATE') {
        console.log('失败原因: 跨平台搜索未找到匹配\n');
        console.log('说明：Mineradio尝试在网易云、酷狗等平台搜索，但没有找到匹配的候选。\n');
        console.log('这很奇怪，因为我们知道酷狗和网易云都有这首歌。');
        console.log('可能的原因:');
        console.log('  1. 匹配算法还有问题（艺术家/歌名不匹配）');
        console.log('  2. 搜索超时');
        console.log('  3. API返回了空结果\n');

      } else if (lxResult.error === 'LX_RESOLVE_EMPTY') {
        console.log('失败原因: 找到候选但LX音源无法解析\n');
        if (lxResult.candidate) {
          console.log(`候选: ${lxResult.candidate.name} - ${lxResult.candidate.artist} (${lxResult.candidate.source})\n`);
        }
        console.log('说明：跨平台匹配成功了，但LX音源脚本无法解析出播放URL。\n');
        console.log('可能的原因:');
        console.log('  1. LX音源不支持该平台');
        console.log('  2. musicInfo结构不完整');
        console.log('  3. LX音源脚本内部错误\n');
        console.log('👉 请查看服务器控制台是否有更详细的错误日志。\n');
      }
    }

  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ❌ 请求失败（${elapsed}秒）: ${e.message}\n`);
  }

  console.log('=== 测试完成 ===\n');
}

testQQtoLX().catch(console.error);
