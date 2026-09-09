// 测试 isArtistMatch 函数
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
      .replace(/[^\w一-龥]/g, ''))  // 修复：保留中文字符
    .filter(Boolean);
}

function isArtistMatch(a, b) {
  const listA = normalizeArtistList(a);
  const listB = normalizeArtistList(b);
  if (!listA.length || !listB.length) return false;
  return listA.some(item => listB.includes(item));
}

console.log('=== 测试 isArtistMatch 函数 ===\n');

const tests = [
  ['周杰伦', '周杰伦'],
  ['周杰伦', '王大毛'],
  ['周杰伦', '周杰伦/方文山'],
  ['周杰伦', '简单爱 (青涩版) - 王大毛'],
  ['Jay Chou', 'Jay Chou'],
  ['Jay Chou', 'Justin Bieber'],
];

tests.forEach(([a, b]) => {
  const listA = normalizeArtistList(a);
  const listB = normalizeArtistList(b);
  const match = isArtistMatch(a, b);

  console.log(`"${a}" vs "${b}"`);
  console.log(`  归一化A: [${listA.join(', ')}]`);
  console.log(`  归一化B: [${listB.join(', ')}]`);
  console.log(`  匹配: ${match ? '✓ 是' : '✗ 否'}\n`);
});

console.log('如果"周杰伦" vs "王大毛"显示"匹配: ✓ 是"，那就是bug！');
