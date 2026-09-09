// 测试真正需要VIP的歌曲
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

async function testVipSong() {
  console.log('=== 测试VIP歌曲的LX接管 ===\n');

  // 测试周杰伦的歌曲（通常需要VIP）
  const testSongs = [
    { keywords: '七里香 周杰伦', title: '七里香' },
    { keywords: '简单爱 周杰伦', title: '简单爱' },
    { keywords: '稻香 周杰伦', title: '稻香' },
    { keywords: '晴天 周杰伦', title: '晴天' }
  ];

  for (const test of testSongs) {
    console.log(`\n【测试】搜索 "${test.keywords}"...`);

    try {
      const searchResult = await request('GET', '/api/search?keywords=' + encodeURIComponent(test.keywords) + '&limit=10');

      if (!searchResult.songs || searchResult.songs.length === 0) {
        console.log('  无搜索结果，跳过');
        continue;
      }

      // 找到周杰伦的版本
      const jayVersion = searchResult.songs.find(s =>
        s.artist && s.artist.includes('周杰伦') &&
        s.name && s.name.includes(test.title)
      );

      if (!jayVersion) {
        console.log('  未找到周杰伦版本，跳过');
        continue;
      }

      console.log(`  找到: ${jayVersion.name} - ${jayVersion.artist}`);
      console.log(`  ID: ${jayVersion.id}`);

      // 测试URL获取
      const urlResult = await request('GET', `/api/song/url?id=${jayVersion.id}&quality=exhigh`);

      console.log(`  URL: ${urlResult.url ? '有' : '无'}`);
      console.log(`  试听: ${urlResult.trial ? '是' : '否'}`);
      console.log(`  VIP: ${urlResult.vipRequired ? '是' : '否'}`);

      const needsLx = !urlResult.url || urlResult.trial || urlResult.vipRequired;

      if (needsLx) {
        console.log(`\n  ✓ 此歌曲需要VIP，适合测试LX接管！`);

        // 测试LX接管
        console.log('\n  测试LX接管...');
        const lxPayload = {
          source: 'netease',
          song: {
            name: jayVersion.name,
            artist: jayVersion.artist,
            artists: jayVersion.artists || [{ name: jayVersion.artist }],
            album: jayVersion.album || jayVersion.albumName || '',
            duration: jayVersion.duration || jayVersion.dt || 0
          },
          quality: 'exhigh'
        };

        const lxResult = await request('POST', '/api/lx/search-and-url', lxPayload);

        console.log(`\n  LX接管结果:`);
        console.log(`    playable: ${lxResult.playable}`);
        console.log(`    url: ${lxResult.url ? '✓ 成功获取' : '✗ 失败'}`);
        console.log(`    error: ${lxResult.error || '无'}`);

        if (lxResult.matchedSong) {
          console.log(`    匹配: ${lxResult.matchedSong.name} - ${lxResult.matchedSong.artist}`);
          console.log(`    平台: ${lxResult.matchedSong.source}`);
        }

        if (lxResult.scriptName) {
          console.log(`    音源: ${lxResult.scriptName}`);
        }

        if (lxResult.url) {
          console.log(`\n  ✓✓✓ 成功！LX音源可以播放此歌曲！`);
          console.log(`  URL: ${lxResult.url.substring(0, 80)}...`);
          return; // 找到一首成功的就够了
        } else {
          console.log(`\n  ✗ LX接管失败`);
          if (lxResult.error === 'LX_SEARCH_NO_CANDIDATE') {
            console.log(`  原因: 在其它平台（QQ/酷狗）没找到匹配的歌曲`);
          } else if (lxResult.error === 'LX_RESOLVE_EMPTY') {
            console.log(`  原因: 找到了候选但LX音源无法解析URL`);
            if (lxResult.candidate) {
              console.log(`  候选: ${lxResult.candidate.name} - ${lxResult.candidate.artist} (${lxResult.candidate.source})`);
            }
          }
        }
      } else {
        console.log(`\n  此歌曲可以直接播放，不需要LX接管`);
      }

    } catch (e) {
      console.error(`  测试出错: ${e.message}`);
    }
  }

  console.log('\n=== 测试完成 ===');
}

testVipSong().catch(console.error);
