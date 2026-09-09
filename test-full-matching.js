// 模拟完整的匹配逻辑
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

async function testMatchingLogic() {
  console.log('=== 测试完整的匹配逻辑 ===\n');

  // 目标：QQ音乐的"简单爱 - 周杰伦"
  const target = {
    name: '简单爱',
    artist: '周杰伦',
    duration: 270000
  };

  console.log('目标歌曲（来自QQ音乐）:');
  console.log(`  ${target.name} - ${target.artist}`);
  console.log(`  时长: ${Math.round(target.duration / 1000)}秒\n`);

  // 测试在酷狗搜索
  console.log('【测试1】在酷狗搜索"简单爱 周杰伦"...');
  const kgResult = await request('GET', '/api/kugou/search?keywords=' + encodeURIComponent('简单爱 周杰伦') + '&limit=5');

  if (kgResult.songs && kgResult.songs.length > 0) {
    console.log(`  找到 ${kgResult.songs.length} 个结果:`);
    kgResult.songs.forEach((s, i) => {
      console.log(`    [${i+1}] ${s.name} - ${s.artist} (${Math.round((s.duration || 0) / 1000)}秒)`);
    });
  } else {
    console.log('  ✗ 无结果');
  }

  // 测试在网易云搜索
  console.log('\n【测试2】在网易云搜索"简单爱 周杰伦"...');
  const wyResult = await request('GET', '/api/search?keywords=' + encodeURIComponent('简单爱 周杰伦') + '&limit=5');

  if (wyResult.songs && wyResult.songs.length > 0) {
    console.log(`  找到 ${wyResult.songs.length} 个结果:`);
    wyResult.songs.forEach((s, i) => {
      console.log(`    [${i+1}] ${s.name} - ${s.artist} (${Math.round((s.duration || 0) / 1000)}秒)`);
    });
  } else {
    console.log('  ✗ 无结果');
  }

  // 现在测试实际的LX接管
  console.log('\n【测试3】触发实际的LX接管...');
  console.log('  这将展示Mineradio实际选择了哪个候选\n');

  const lxPayload = {
    source: 'qq',
    song: target,
    quality: 'exhigh'
  };

  const startTime = Date.now();
  const lxResult = await request('POST', '/api/lx/search-and-url', lxPayload);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`  耗时: ${elapsed}秒`);
  console.log(`  结果: ${lxResult.url ? '成功' : '失败'}`);
  console.log(`  error: ${lxResult.error || '无'}`);

  if (lxResult.matchedSong) {
    console.log(`\n  Mineradio选择的候选:`);
    console.log(`    歌名: ${lxResult.matchedSong.name}`);
    console.log(`    歌手: ${lxResult.matchedSong.artist}`);
    console.log(`    平台: ${lxResult.matchedSong.source}`);

    // 判断是否选对了
    if (lxResult.matchedSong.artist === '周杰伦' || lxResult.matchedSong.artist.includes('周杰伦')) {
      console.log(`\n  ✅ 正确！选择了周杰伦的版本`);
    } else {
      console.log(`\n  ❌ 错误！选择了翻唱版而不是周杰伦的原版`);
      console.log(`     这说明匹配算法还有问题`);
    }
  }

  console.log('\n=== 测试完成 ===\n');

  if (lxResult.error === 'LX_RESOLVE_EMPTY' && lxResult.matchedSong && !lxResult.matchedSong.artist.includes('周杰伦')) {
    console.log('【问题总结】');
    console.log('匹配算法选择了错误的候选（翻唱版），导致LX音源无法解析。\n');
    console.log('可能的原因:');
    console.log('1. 第四轮匹配太宽松，只要时长接近就匹配了');
    console.log('2. 网易云的翻唱版排在酷狗之前被选中');
    console.log('3. 匹配算法没有优先选择歌手完全匹配的结果\n');
  }
}

testMatchingLogic().catch(console.error);
