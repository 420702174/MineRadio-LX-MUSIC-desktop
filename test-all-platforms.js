// 测试QQ音乐和酷狗能否搜索到周杰伦的歌
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

async function testAllPlatforms() {
  console.log('=== 测试各平台能否搜索到周杰伦的歌 ===\n');

  const testSongs = ['简单爱', '七里香', '晴天', '稻香'];

  for (const songName of testSongs) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`测试歌曲: ${songName} - 周杰伦`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // 网易云
    console.log('【网易云】');
    try {
      const wyResult = await request('GET', '/api/search?keywords=' + encodeURIComponent(songName + ' 周杰伦') + '&limit=10');
      const jayVersion = wyResult.songs?.find(s =>
        s.artist === '周杰伦' &&
        (s.name === songName || s.name.includes(songName))
      );

      if (jayVersion) {
        console.log(`  ✓ 找到: ${jayVersion.name} - ${jayVersion.artist}`);
        console.log(`    ID: ${jayVersion.id}, 专辑: ${jayVersion.album || '未知'}`);
      } else {
        console.log(`  ✗ 未找到周杰伦的版本`);
        if (wyResult.songs?.length > 0) {
          console.log(`    搜索到的: ${wyResult.songs[0].name} - ${wyResult.songs[0].artist}`);
        }
      }
    } catch (e) {
      console.log(`  ✗ 搜索失败: ${e.message}`);
    }

    // QQ音乐
    console.log('\n【QQ音乐】');
    try {
      const qqResult = await request('GET', '/api/qq/search?keywords=' + encodeURIComponent(songName + ' 周杰伦') + '&limit=10');
      const jayVersion = qqResult.songs?.find(s =>
        (s.artist === '周杰伦' || s.artist?.includes('周杰伦')) &&
        (s.name === songName || s.name.includes(songName))
      );

      if (jayVersion) {
        console.log(`  ✓ 找到: ${jayVersion.name} - ${jayVersion.artist}`);
        console.log(`    ID: ${jayVersion.mid || jayVersion.id}, 专辑: ${jayVersion.album || '未知'}`);
      } else {
        console.log(`  ✗ 未找到周杰伦的版本`);
        if (qqResult.songs?.length > 0) {
          console.log(`    搜索到的: ${qqResult.songs[0].name} - ${qqResult.songs[0].artist}`);
        }
      }
    } catch (e) {
      console.log(`  ✗ 搜索失败: ${e.message}`);
    }

    // 酷狗
    console.log('\n【酷狗】');
    try {
      const kgResult = await request('GET', '/api/kugou/search?keywords=' + encodeURIComponent(songName + ' 周杰伦') + '&limit=10');
      const jayVersion = kgResult.songs?.find(s =>
        (s.artist === '周杰伦' || s.artist?.includes('周杰伦')) &&
        (s.name === songName || s.name.includes(songName))
      );

      if (jayVersion) {
        console.log(`  ✓ 找到: ${jayVersion.name} - ${jayVersion.artist}`);
        console.log(`    ID: ${jayVersion.hash || jayVersion.id}, 专辑: ${jayVersion.album || '未知'}`);
      } else {
        console.log(`  ✗ 未找到周杰伦的版本`);
        if (kgResult.songs?.length > 0) {
          console.log(`    搜索到的: ${kgResult.songs[0].name} - ${kgResult.songs[0].artist}`);
        }
      }
    } catch (e) {
      console.log(`  ✗ 搜索失败: ${e.message}`);
    }
  }

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【总结】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('如果所有平台都搜不到周杰伦的原版歌曲，可能是：');
  console.log('  1. 地区限制（版权原因）');
  console.log('  2. 需要登录后才能搜索到');
  console.log('  3. API返回的数据被过滤\n');
  console.log('如果QQ音乐或酷狗能搜到，说明Mineradio的跨平台搜索应该能工作。\n');
  console.log('如果都搜不到，那就解释了为什么LX接管会失败（LX_SEARCH_NO_CANDIDATE）。\n');
}

testAllPlatforms().catch(console.error);
