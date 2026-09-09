// 测试酷狗搜索并检查匹配逻辑
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

// 模拟匹配算法
function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[()（）【】\[\]<>《》""''「」『』]/g, '')
    .replace(/[\s\-_·•]/g, '')
    .replace(/[^\w一-龥]/g, '');
}

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

function isArtistMatch(a, b) {
  const listA = normalizeArtistList(a);
  const listB = normalizeArtistList(b);
  if (!listA.length || !listB.length) return false;
  for (const itemA of listA) {
    for (const itemB of listB) {
      if (itemA === itemB || itemA.includes(itemB) || itemB.includes(itemA)) return true;
    }
  }
  return false;
}

async function testKugouMatch() {
  console.log('=== 测试酷狗搜索和匹配逻辑 ===\n');

  const target = {
    name: '简单爱',
    artist: '周杰伦',
    duration: 270000
  };

  console.log('目标歌曲:');
  console.log(`  歌名: ${target.name}`);
  console.log(`  歌手: ${target.artist}`);
  console.log(`  时长: ${Math.round(target.duration / 1000)}秒\n`);

  // 1. 搜索酷狗
  console.log('【步骤1】在酷狗搜索"简单爱 周杰伦"...');
  const kgResult = await request('GET', '/api/kugou/search?keywords=' + encodeURIComponent('简单爱 周杰伦') + '&limit=12');

  if (!kgResult.songs || kgResult.songs.length === 0) {
    console.log('  ✗ 搜索失败或无结果\n');
    return;
  }

  console.log(`  ✓ 找到 ${kgResult.songs.length} 个结果\n`);

  // 2. 逐个检查匹配度
  console.log('【步骤2】检查每个结果的匹配度:\n');

  const targetNameNorm = normalizeText(target.name);
  const targetArtistNorm = normalizeText(target.artist);
  const targetDuration = Math.round(target.duration / 1000);

  let bestMatch = null;
  let bestScore = 0;

  kgResult.songs.forEach((song, i) => {
    const songNameNorm = normalizeText(song.name);
    const songArtistNorm = normalizeText(song.artist);
    const songDuration = Math.round((song.duration || 0) / 1000);

    // 检查匹配
    const nameMatch = songNameNorm === targetNameNorm ||
                     songNameNorm.includes(targetNameNorm) ||
                     targetNameNorm.includes(songNameNorm);
    const artistMatch = isArtistMatch(target.artist, song.artist);
    const durationMatch = Math.abs(songDuration - targetDuration) <= 15;

    console.log(`[${i+1}] ${song.name} - ${song.artist}`);
    console.log(`    时长: ${songDuration}秒 (误差: ${Math.abs(songDuration - targetDuration)}秒)`);
    console.log(`    歌名匹配: ${nameMatch ? '✓' : '✗'} (${songNameNorm} vs ${targetNameNorm})`);
    console.log(`    歌手匹配: ${artistMatch ? '✓' : '✗'} (${song.artist} vs ${target.artist})`);
    console.log(`    时长匹配: ${durationMatch ? '✓' : '✗'}`);

    // 计算分数
    let score = 0;
    if (nameMatch) score += 3;
    if (artistMatch) score += 3;
    if (durationMatch) score += 1;

    console.log(`    总分: ${score}/7`);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }

    if (nameMatch && artistMatch && durationMatch) {
      console.log(`    ✅ 完美匹配！\n`);
    } else {
      console.log('');
    }
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【匹配结果】\n');

  if (bestMatch && bestScore >= 6) {
    console.log(`✓ 最佳匹配: ${bestMatch.name} - ${bestMatch.artist}`);
    console.log(`  分数: ${bestScore}/7`);
    console.log(`  hash: ${bestMatch.hash || '无'}\n`);
    console.log('这个结果应该会被 lxStyleFindBestMatch 函数选中。\n');
  } else if (bestMatch) {
    console.log(`⚠️ 最佳匹配但分数较低: ${bestMatch.name} - ${bestMatch.artist}`);
    console.log(`  分数: ${bestScore}/7`);
    console.log('  可能不会被匹配算法选中。\n');
  } else {
    console.log('✗ 没有找到合适的匹配\n');
  }

  console.log('如果酷狗能找到匹配，但最后还是用了网易云的翻唱版，');
  console.log('说明匹配算法或探测逻辑还有问题。\n');
}

testKugouMatch().catch(console.error);
