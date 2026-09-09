// 实时监控LX音源播放问题的调试脚本
// 这个脚本会持续监听服务器日志，帮助定位问题

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

async function diagnose() {
  console.log('=== LX音源实时诊断 ===\n');

  // 1. 检查服务器状态
  console.log('【步骤1】检查服务器连接...');
  try {
    const ping = await request('GET', '/api/lx/sources');
    console.log('  ✓ 服务器运行正常\n');
  } catch (e) {
    console.error('  ✗ 服务器未响应:', e.message);
    console.error('  请确保已运行: npm run start 或 node server.js\n');
    return;
  }

  // 2. 检查LX音源状态
  console.log('【步骤2】检查LX音源状态...');
  try {
    const sources = await request('GET', '/api/lx/sources');

    if (!sources.sources || sources.sources.length === 0) {
      console.log('  ⚠️ 没有导入任何LX音源！');
      console.log('  请在界面中导入音源文件：');
      console.log('  - HYWmusic_beta_公益测试 v0.74.0.js');
      console.log('  - 聚合API接口.js\n');
      return;
    }

    console.log(`  找到 ${sources.sources.length} 个音源:\n`);
    sources.sources.forEach((s, i) => {
      console.log(`  [${i + 1}] ${s.name}`);
      console.log(`      版本: ${s.version || '未知'}`);
      console.log(`      状态: ${s.initStatus}`);
      console.log(`      启用: ${s.enabled ? '是' : '否'}`);
      console.log(`      支持平台: ${(s.supportedSources || []).join(', ') || '未知'}`);
      console.log(`      能力: ${s.searchEnabled ? '搜索 ' : ''}${s.urlResolveEnabled ? 'URL解析' : ''}`);

      if (s.initStatus !== 'ready') {
        console.log(`      ⚠️ 错误: ${s.initError || '未就绪'}`);
      }
      console.log('');
    });

    const readySources = sources.sources.filter(s => s.enabled && s.initStatus === 'ready');
    if (readySources.length === 0) {
      console.log('  ⚠️ 没有可用的音源（需要：已启用 且 状态为ready）\n');
      return;
    }

  } catch (e) {
    console.error('  ✗ 获取音源列表失败:', e.message, '\n');
    return;
  }

  // 3. 测试搜索
  console.log('【步骤3】测试网易云搜索"简单爱 周杰伦"...');
  try {
    const searchResult = await request('GET', '/api/search?keywords=' + encodeURIComponent('简单爱 周杰伦') + '&limit=3');

    if (!searchResult.songs || searchResult.songs.length === 0) {
      console.log('  ✗ 搜索无结果\n');
      return;
    }

    const song = searchResult.songs[0];
    console.log(`  ✓ 找到: ${song.name} - ${song.artist}`);
    console.log(`     ID: ${song.id}`);
    console.log(`     时长: ${Math.round((song.duration || song.dt || 0) / 1000)}秒`);
    console.log('');

    // 4. 测试网易云URL获取
    console.log('【步骤4】测试网易云URL获取...');
    const urlResult = await request('GET', `/api/song/url?id=${song.id}&quality=exhigh`);

    console.log(`     URL: ${urlResult.url ? '有' : '无'}`);
    console.log(`     试听: ${urlResult.trial ? '是' : '否'}`);
    console.log(`     VIP要求: ${urlResult.vipRequired ? '是' : '否'}`);
    console.log('');

    const needsLx = !urlResult.url || urlResult.trial || urlResult.vipRequired;

    if (!needsLx) {
      console.log('  ℹ️ 此歌曲网易云可以直接播放，不会触发LX接管');
      console.log('     LX接管只在VIP/试听/登录受限时触发\n');
      return;
    }

    // 5. 测试LX接管
    console.log('【步骤5】测试LX音源接管...');
    console.log('  发送请求到 /api/lx/search-and-url...\n');

    const lxPayload = {
      source: 'netease',
      song: {
        name: song.name,
        artist: song.artist,
        artists: song.artists || [{ name: song.artist }],
        album: song.album || song.albumName || '',
        duration: song.duration || song.dt || 0
      },
      quality: 'exhigh'
    };

    console.log('  请求内容:');
    console.log(JSON.stringify(lxPayload, null, 2));
    console.log('');

    const lxResult = await request('POST', '/api/lx/search-and-url', lxPayload);

    console.log('  响应结果:');
    console.log(`     playable: ${lxResult.playable}`);
    console.log(`     url: ${lxResult.url ? '✓ 有URL' : '✗ 无URL'}`);
    console.log(`     error: ${lxResult.error || '无'}`);
    console.log('');

    if (lxResult.matchedSong) {
      console.log('  匹配信息:');
      console.log(`     歌名: ${lxResult.matchedSong.name}`);
      console.log(`     歌手: ${lxResult.matchedSong.artist}`);
      console.log(`     平台: ${lxResult.matchedSong.source}`);
      console.log('');
    }

    if (lxResult.scriptName) {
      console.log(`  使用音源: ${lxResult.scriptName}`);
      console.log('');
    }

    // 6. 分析失败原因
    if (!lxResult.url) {
      console.log('【失败原因分析】');

      if (lxResult.error === 'LX_SEARCH_NO_CANDIDATE') {
        console.log('  ❌ 跨平台搜索未找到匹配候选');
        console.log('  原因: 在QQ音乐、酷狗等其它平台搜索时，没有找到同名同歌手的歌曲');
        console.log('  可能性:');
        console.log('    1. 艺术家名称格式差异（即使修复后仍可能不匹配）');
        console.log('    2. 歌名有差异（括号、版本信息等）');
        console.log('    3. 时长差异超过15秒');
        console.log('    4. 其它平台根本没有这首歌');
        console.log('');
        console.log('  建议解决方案:');
        console.log('    1. 检查 QQ音乐/酷狗 是否有这首歌');
        console.log('    2. 手动在其它平台搜索"简单爱 周杰伦"对比结果');
        console.log('');

      } else if (lxResult.error === 'LX_RESOLVE_EMPTY') {
        console.log('  ❌ 找到候选但LX音源无法解析URL');
        console.log(`  匹配到: ${lxResult.candidate?.name} - ${lxResult.candidate?.artist}`);
        console.log(`  来自平台: ${lxResult.candidate?.source}`);
        console.log('');
        console.log('  可能性:');
        console.log('    1. LX音源脚本本身有问题');
        console.log('    2. musicInfo结构不完整（缺少必要字段）');
        console.log('    3. LX音源不支持该平台');
        console.log('    4. 网络请求失败');
        console.log('');
        console.log('  建议解决方案:');
        console.log('    1. 在LX Desktop中测试同样的音源是否正常');
        console.log('    2. 检查音源是否支持匹配到的平台');
        console.log('    3. 查看服务器控制台的详细错误日志');
        console.log('');

      } else if (lxResult.error === 'LX_CANDIDATE_MISSING_ID') {
        console.log('  ❌ 候选歌曲缺少平台ID');
        console.log('  原因: buildLxMusicInfoFromMatch 无法提取songId');
        console.log('  这是代码bug，需要检查该函数');
        console.log('');

      } else {
        console.log(`  ❌ 未知错误: ${lxResult.error}`);
        console.log('  建议查看服务器控制台的详细日志');
        console.log('');
      }
    } else {
      console.log('【诊断结果】');
      console.log('  ✓ LX音源接管成功！');
      console.log('  URL已获取，理论上应该可以播放');
      console.log('');
      console.log('  如果界面仍然跳过，可能的原因:');
      console.log('    1. 前端没有正确处理LX接管的响应');
      console.log('    2. 音频解码/播放器问题');
      console.log('    3. 需要查看浏览器控制台的错误');
      console.log('');
    }

  } catch (e) {
    console.error('  ✗ 测试过程出错:', e.message);
    console.error('  详细信息:', e);
  }

  console.log('=== 诊断完成 ===\n');
}

// 运行诊断
diagnose().catch(err => {
  console.error('诊断脚本出错:', err);
  process.exit(1);
});
