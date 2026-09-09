// 直接测试LX音源解析能力
// 绕过所有限制检查，直接调用LX接管接口

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

async function testLxDirect() {
  console.log('=== 直接测试LX音源解析 ===\n');
  console.log('此测试绕过VIP检查，直接调用LX音源\n');

  const testSongs = [
    {
      name: '简单爱',
      artist: '周杰伦',
      artists: [{name: '周杰伦'}],
      album: '范特西',
      duration: 270000
    },
    {
      name: '七里香',
      artist: '周杰伦',
      artists: [{name: '周杰伦'}],
      album: '七里香',
      duration: 300000
    },
    {
      name: '晴天',
      artist: '周杰伦',
      artists: [{name: '周杰伦'}],
      album: '叶惠美',
      duration: 270000
    }
  ];

  for (const song of testSongs) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`测试: ${song.name} - ${song.artist}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    try {
      const lxPayload = {
        source: 'netease',  // 从网易云作为源平台
        song: song,
        quality: 'exhigh'
      };

      console.log('1️⃣ 调用 /api/lx/search-and-url...');
      const lxResult = await request('POST', '/api/lx/search-and-url', lxPayload);

      console.log('\n📊 结果:');
      console.log(`   playable: ${lxResult.playable}`);
      console.log(`   url: ${lxResult.url ? '✅ 成功' : '❌ 失败'}`);
      console.log(`   error: ${lxResult.error || '无'}`);

      if (lxResult.matchedSong) {
        console.log('\n🎵 匹配信息:');
        console.log(`   歌名: ${lxResult.matchedSong.name}`);
        console.log(`   歌手: ${lxResult.matchedSong.artist}`);
        console.log(`   平台: ${lxResult.matchedSong.source}`);

        if (lxResult.matchedSong.musicInfo) {
          const info = lxResult.matchedSong.musicInfo;
          console.log('\n📝 musicInfo:');
          console.log(`   name: ${info.name}`);
          console.log(`   singer: ${(info.singer || []).join(', ')}`);
          console.log(`   source: ${info.source}`);
          console.log(`   interval: ${info.interval}`);
          if (info.meta) {
            console.log(`   meta.songId: ${info.meta.songId || '无'}`);
            console.log(`   meta.hash: ${info.meta.hash || '无'}`);
            console.log(`   meta.strMediaMid: ${info.meta.strMediaMid || '无'}`);
          }
        }
      }

      if (lxResult.scriptName) {
        console.log(`\n🔧 使用音源: ${lxResult.scriptName}`);
      }

      if (lxResult.url) {
        console.log('\n✅✅✅ 成功获取播放URL！');
        console.log(`URL: ${lxResult.url.substring(0, 100)}...`);
        console.log(`\n👉 这说明LX音源功能正常，可以解析此歌曲\n`);
        return; // 找到一个成功的就返回
      } else {
        console.log('\n❌ 获取URL失败');

        if (lxResult.error === 'LX_SEARCH_NO_CANDIDATE') {
          console.log('\n🔍 失败原因: 跨平台搜索未找到匹配');
          console.log('   说明: 在QQ音乐、酷狗等平台搜索时，没找到同名同歌手的歌曲');
          console.log('   这可能是因为:');
          console.log('   - 艺术家名称格式不匹配（已修复但可能仍有问题）');
          console.log('   - 其它平台根本没有这首歌');
          console.log('   - 歌名有差异（括号、版本等）');

        } else if (lxResult.error === 'LX_RESOLVE_EMPTY') {
          console.log('\n🔍 失败原因: 找到候选但无法解析URL');
          if (lxResult.candidate) {
            console.log(`   候选歌曲: ${lxResult.candidate.name} - ${lxResult.candidate.artist}`);
            console.log(`   来自平台: ${lxResult.candidate.source}`);
          }
          console.log('   这可能是因为:');
          console.log('   - LX音源脚本无法解析该平台的URL');
          console.log('   - musicInfo结构不完整');
          console.log('   - 网络请求失败');

        } else if (lxResult.error === 'LX_CANDIDATE_MISSING_ID') {
          console.log('\n🔍 失败原因: 候选歌曲缺少平台ID');
          console.log('   这是代码bug，buildLxMusicInfoFromMatch函数有问题');
        }
      }

    } catch (e) {
      console.error(`\n❌ 测试出错: ${e.message}`);
    }

    console.log('\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('测试完成');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('💡 如果所有歌曲都失败:');
  console.log('   1. 检查你的LX音源是否支持 wy/tx/kg 这些平台');
  console.log('   2. 在LX Desktop中测试同样的音源是否正常');
  console.log('   3. 查看服务器控制台的详细错误日志\n');
}

testLxDirect().catch(console.error);
