// 专门诊断LX接管失败的原因
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

async function diagnoseFailure() {
  console.log('=== 诊断LX接管失败原因 ===\n');

  // 1. 搜索周杰伦的简单爱
  console.log('【步骤1】搜索周杰伦的简单爱（原版）...');
  const searchResult = await request('GET', '/api/search?keywords=' + encodeURIComponent('简单爱 周杰伦') + '&limit=20');

  // 找周杰伦的版本（不是翻唱）
  const jaySong = searchResult.songs?.find(s =>
    s.artist === '周杰伦' &&
    s.name === '简单爱'
  );

  if (!jaySong) {
    console.log('  ❌ 未找到周杰伦的原版《简单爱》\n');
    console.log('  搜索到的结果：');
    searchResult.songs?.slice(0, 5).forEach((s, i) => {
      console.log(`    [${i+1}] ${s.name} - ${s.artist}`);
    });
    return;
  }

  console.log(`  ✓ 找到: ${jaySong.name} - ${jaySong.artist}`);
  console.log(`    ID: ${jaySong.id}`);
  console.log(`    专辑: ${jaySong.album || '未知'}`);
  console.log(`    时长: ${Math.round((jaySong.duration || 0) / 1000)}秒\n`);

  // 2. 测试网易云URL
  console.log('【步骤2】测试网易云是否可播放...');
  const urlResult = await request('GET', `/api/song/url?id=${jaySong.id}&quality=exhigh`);

  console.log(`  URL: ${urlResult.url ? '有' : '无'}`);
  console.log(`  试听: ${urlResult.trial ? '是' : '否'}`);
  console.log(`  VIP: ${urlResult.vipRequired ? '是' : '否'}`);
  console.log(`  登录要求: ${urlResult.restriction?.category === 'login_required' ? '是' : '否'}\n`);

  if (urlResult.url && !urlResult.trial && !urlResult.vipRequired) {
    console.log('  ℹ️ 网易云可以直接播放，不会触发LX接管\n');
    return;
  }

  // 3. 测试LX接管
  console.log('【步骤3】测试LX音源接管...');
  console.log('  正在调用 /api/lx/search-and-url（可能需要10-30秒）...\n');

  const startTime = Date.now();

  try {
    const lxPayload = {
      source: 'netease',
      song: {
        name: jaySong.name,
        artist: jaySong.artist,
        artists: jaySong.artists || [{name: jaySong.artist}],
        album: jaySong.album || '',
        duration: jaySong.duration || 0
      },
      quality: 'exhigh'
    };

    const lxResult = await request('POST', '/api/lx/search-and-url', lxPayload);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  ⏱️ 耗时: ${elapsed}秒\n`);
    console.log('  结果:');
    console.log(`    playable: ${lxResult.playable}`);
    console.log(`    url: ${lxResult.url ? '✅ 成功' : '❌ 失败'}`);
    console.log(`    error: ${lxResult.error || '无'}\n`);

    if (lxResult.matchedSong) {
      console.log('  匹配到的歌曲:');
      console.log(`    歌名: ${lxResult.matchedSong.name}`);
      console.log(`    歌手: ${lxResult.matchedSong.artist}`);
      console.log(`    来源平台: ${lxResult.matchedSong.source}\n`);
    }

    if (lxResult.scriptName) {
      console.log(`  使用的LX音源: ${lxResult.scriptName}\n`);
    }

    // 4. 分析失败原因
    if (!lxResult.url) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('【失败原因分析】');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      if (lxResult.error === 'LX_SEARCH_NO_CANDIDATE') {
        console.log('❌ 错误: LX_SEARCH_NO_CANDIDATE');
        console.log('\n📝 含义: 在其它平台（QQ音乐、酷狗）搜索时，没有找到匹配的候选歌曲\n');
        console.log('🔍 Mineradio的工作流程:');
        console.log('  1. 你搜索"简单爱 周杰伦"（网易云）');
        console.log('  2. 网易云返回需要VIP/登录');
        console.log('  3. 触发LX接管');
        console.log('  4. Mineradio在QQ音乐搜索"简单爱 周杰伦" ❌ 没找到匹配');
        console.log('  5. Mineradio在酷狗搜索"简单爱 周杰伦" ❌ 没找到匹配');
        console.log('  6. 返回失败\n');

        console.log('💡 可能的原因:');
        console.log('  1. QQ音乐/酷狗确实没有这首歌（地区限制、下架等）');
        console.log('  2. 艺术家名称不匹配（虽然已修复，但可能还有边界情况）');
        console.log('  3. 歌名有细微差异（括号、空格等）');
        console.log('  4. 时长差异超过15秒\n');

        console.log('🔧 解决方案:');
        console.log('  请运行: node test-qq-kugou-search.js');
        console.log('  这个脚本会显示QQ音乐和酷狗的搜索结果，帮你确认是否能找到这首歌\n');

      } else if (lxResult.error === 'LX_RESOLVE_EMPTY') {
        console.log('❌ 错误: LX_RESOLVE_EMPTY');
        console.log('\n📝 含义: 在其它平台找到了候选歌曲，但LX音源无法解析出播放URL\n');

        if (lxResult.candidate) {
          console.log('✓ 找到的候选:');
          console.log(`  歌名: ${lxResult.candidate.name}`);
          console.log(`  歌手: ${lxResult.candidate.artist}`);
          console.log(`  平台: ${lxResult.candidate.source}\n`);
        }

        console.log('💡 可能的原因:');
        console.log('  1. LX音源脚本不支持该平台');
        console.log('  2. musicInfo结构不完整（缺少songId等关键字段）');
        console.log('  3. LX音源脚本内部请求失败（网络、API变更等）\n');

        console.log('🔧 解决方案:');
        console.log('  1. 检查你的LX音源是否支持候选平台');
        console.log('  2. 在LX Desktop中测试相同的音源是否能播放');
        console.log('  3. 查看服务器控制台是否有LX音源的错误日志\n');

      } else {
        console.log(`❌ 错误: ${lxResult.error}\n`);
        console.log('这是一个未预期的错误，请查看服务器控制台的详细日志\n');
      }
    } else {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('【诊断结果】');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('✅✅✅ LX音源接管成功！\n');
      console.log('URL已获取，说明LX音源功能正常。');
      console.log('如果界面还是跳过，可能是前端播放逻辑的问题。\n');
    }

  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ❌ 请求失败（耗时${elapsed}秒）: ${e.message}\n`);

    if (e.code === 'ETIMEDOUT' || e.message.includes('timeout')) {
      console.log('⚠️ 请求超时！\n');
      console.log('可能的原因:');
      console.log('  1. QQ音乐或酷狗的API响应太慢');
      console.log('  2. LX音源脚本内部请求超时');
      console.log('  3. 网络问题\n');
    }
  }

  console.log('=== 诊断完成 ===\n');
}

diagnoseFailure().catch(console.error);
