// LX音源播放链路调试脚本
// 用法: node debug-lx-playback.js

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

async function main() {
  console.log('=== LX音源播放链路调试 ===\n');

  // 1. 检查LX源状态
  console.log('1. 检查LX音源列表...');
  const sources = await request('GET', '/api/lx/sources');
  console.log(`   已导入 ${sources.sources?.length || 0} 个音源`);
  if (sources.sources) {
    sources.sources.forEach((s, i) => {
      console.log(`   [${i}] ${s.name} - ${s.initStatus} - 支持: ${s.supportedSources?.join(',')}`);
      if (s.initError) console.log(`       错误: ${s.initError}`);
    });
  }
  console.log('');

  // 2. 网易云搜索"简单爱"
  console.log('2. 网易云搜索"简单爱 周杰伦"...');
  const searchResult = await request('GET', '/api/search?keywords=' + encodeURIComponent('简单爱 周杰伦') + '&limit=3');
  if (searchResult.songs && searchResult.songs.length > 0) {
    const song = searchResult.songs[0];
    console.log(`   找到: ${song.name} - ${song.artist}`);
    console.log(`   ID: ${song.id}, 时长: ${song.duration}ms`);
    console.log(`   VIP状态: ${song.vipRequired ? '需要VIP' : '免费'}`);
    console.log('');

    // 3. 尝试获取网易云播放URL
    console.log('3. 尝试获取网易云播放URL...');
    const urlResult = await request('GET', `/api/song/url?id=${song.id}&quality=exhigh`);
    console.log(`   返回URL: ${urlResult.url ? '有' : '无'}`);
    console.log(`   试听: ${urlResult.trial ? '是' : '否'}`);
    console.log(`   VIP要求: ${urlResult.vipRequired ? '是' : '否'}`);
    console.log('');

    // 4. 测试LX接管 - search-and-url接口
    console.log('4. 测试LX音源接管（/api/lx/search-and-url）...');
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

    console.log(`   请求payload:`, JSON.stringify(lxPayload, null, 2));

    try {
      const lxResult = await request('POST', '/api/lx/search-and-url', lxPayload);
      console.log(`   LX返回结果:`);
      console.log(`   - url: ${lxResult.url ? '✓ 有URL' : '✗ 无URL'}`);
      console.log(`   - playable: ${lxResult.playable}`);
      console.log(`   - error: ${lxResult.error || '无'}`);
      if (lxResult.matchedSong) {
        console.log(`   - 匹配歌曲: ${lxResult.matchedSong.name} - ${lxResult.matchedSong.artist}`);
        console.log(`   - 匹配平台: ${lxResult.matchedSong.source}`);
        console.log(`   - musicInfo:`, JSON.stringify(lxResult.matchedSong.musicInfo, null, 2));
      }
      if (lxResult.scriptName) {
        console.log(`   - 使用音源: ${lxResult.scriptName}`);
      }
      console.log('');

      // 5. 如果有候选但没URL，显示详细信息
      if (!lxResult.url && lxResult.candidate) {
        console.log('5. ⚠️ 找到候选但无法解析URL');
        console.log(`   候选: ${lxResult.candidate.name} - ${lxResult.candidate.artist}`);
        console.log(`   来源: ${lxResult.candidate.source}`);
      }

      if (lxResult.url) {
        console.log('5. ✓ 成功！LX音源返回了可播放URL');
        console.log(`   URL前100字符: ${lxResult.url.substring(0, 100)}...`);
      }

    } catch (e) {
      console.error('   ✗ LX接管失败:', e.message);
    }

  } else {
    console.log('   ✗ 搜索无结果');
  }

  console.log('\n=== 调试完成 ===');
}

main().catch(console.error);
