// 查看网易云搜索"简单爱"返回的所有结果
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

function normalizeText(text) {
  return String(text || '').toLowerCase()
    .replace(/[()（）【】\[\]<>《》""''「」『』]/g, '')
    .replace(/[\s\-_·•]/g, '')
    .replace(/[^\w一-龥]/g, '');
}

async function inspectSearch() {
  console.log('=== 检查网易云搜索"简单爱"的返回结果 ===\n');

  const result = await request('GET', '/api/search?keywords=' + encodeURIComponent('简单爱') + '&limit=15');

  console.log(`共找到 ${result.songs?.length || 0} 个结果:\n`);

  if (result.songs) {
    result.songs.forEach((song, i) => {
      console.log(`[${i+1}] ${song.name} - ${song.artist}`);
      console.log(`    ID: ${song.id}`);
      console.log(`    时长: ${Math.round((song.duration || 0) / 1000)}秒`);
      console.log(`    专辑: ${song.album || '未知'}`);

      // 检查是否匹配"简单爱 - 周杰伦"
      const nameNorm = normalizeText(song.name);
      const artistNorm = normalizeText(song.artist);
      const targetNameNorm = normalizeText('简单爱');
      const targetArtistNorm = normalizeText('周杰伦');

      const nameMatch = nameNorm === targetNameNorm || nameNorm.includes(targetNameNorm);
      const artistMatch = artistNorm.includes(targetArtistNorm);

      if (nameMatch && artistMatch) {
        console.log(`    ✓✓✓ 这是周杰伦的版本！`);
      } else if (nameMatch) {
        console.log(`    ⚠️ 歌名匹配但歌手不是周杰伦（翻唱版）`);
      }
      console.log('');
    });
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('结论:');
  console.log('如果周杰伦的版本不在前12个结果中，');
  console.log('那么跨平台搜索就会匹配不到（默认limit=12）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

inspectSearch().catch(console.error);
