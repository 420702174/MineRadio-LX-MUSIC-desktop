// 直接测试LX接管（绕过前端判断）
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

async function directTest() {
  console.log('=== 直接测试LX接管（使用网易云ID：18638057）===\n');

  // 1. 获取歌曲详情
  console.log('【步骤1】获取歌曲详情...');
  const detailResult = await request('GET', '/api/song/detail?id=18638057');

  if (detailResult.song) {
    const song = detailResult.song;
    console.log(`  歌名: ${song.name}`);
    console.log(`  歌手: ${song.artist}`);
    console.log(`  专辑: ${song.album}`);
    console.log(`  时长: ${Math.round((song.duration || 0) / 1000)}秒\n`);

    // 2. 测试LX接管
    console.log('【步骤2】强制触发LX接管...');
    const lxPayload = {
      source: 'netease',
      song: {
        name: song.name,
        artist: song.artist,
        artists: song.artists || [{name: song.artist}],
        album: song.album || '',
        duration: song.duration || 0
      },
      quality: 'exhigh'
    };

    console.log('  请求payload:');
    console.log(JSON.stringify(lxPayload, null, 2));
    console.log('\n  调用 /api/lx/search-and-url...\n');

    const startTime = Date.now();
    const lxResult = await request('POST', '/api/lx/search-and-url', lxPayload);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  耗时: ${elapsed}秒\n`);
    console.log('【结果】');
    console.log(`  playable: ${lxResult.playable}`);
    console.log(`  url: ${lxResult.url ? '✅ 成功' : '❌ 失败'}`);
    console.log(`  error: ${lxResult.error || '无'}\n`);

    if (lxResult.matchedSong) {
      console.log('  匹配信息:');
      console.log(`    歌名: ${lxResult.matchedSong.name}`);
      console.log(`    歌手: ${lxResult.matchedSong.artist}`);
      console.log(`    平台: ${lxResult.matchedSong.source}\n`);
    }

    if (lxResult.scriptName) {
      console.log(`  使用音源: ${lxResult.scriptName}\n`);
    }

    if (lxResult.url) {
      console.log('✅✅✅ LX音源可以解析这首歌！');
      console.log(`URL: ${lxResult.url.substring(0, 100)}...\n`);
    } else {
      console.log('❌ LX接管失败\n');

      if (lxResult.error === 'LX_SEARCH_NO_CANDIDATE') {
        console.log('失败原因: 跨平台搜索未找到匹配的候选');
        console.log('说明: 在QQ音乐、酷狗等平台搜索时，没有找到同名同歌手的歌曲\n');
      } else if (lxResult.error === 'LX_RESOLVE_EMPTY') {
        console.log('失败原因: 找到候选但LX音源无法解析');
        if (lxResult.candidate) {
          console.log(`候选: ${lxResult.candidate.name} - ${lxResult.candidate.artist} (${lxResult.candidate.source})\n`);
        }
      }
    }
  } else {
    console.log('  ✗ 获取歌曲详情失败\n');
  }

  console.log('=== 测试完成 ===\n');
}

directTest().catch(console.error);
