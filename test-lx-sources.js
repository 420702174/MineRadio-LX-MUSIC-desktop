const fs = require('fs');
const path = require('path');

// 读取音源文件
const data = JSON.parse(fs.readFileSync('./data/lx-sources.json', 'utf8'));

console.log('总共有', data.sources.length, '个音源');
console.log('开始逐个测试...\n');

// 逐个测试每个音源
data.sources.forEach((source, index) => {
  console.log(`[${index + 1}/${data.sources.length}] 测试音源:`, source.name || source.id);

  try {
    // 测试可能导致问题的字段
    const testFields = {
      id: source.id,
      name: source.name,
      supportedSources: source.supportedSources,
      sourceSchemas: source.sourceSchemas,
      sources: source.sources,
    };

    // 检查 supportedSources
    if (source.supportedSources) {
      console.log('  - supportedSources 类型:', typeof source.supportedSources, Array.isArray(source.supportedSources) ? '(数组)' : '(对象)');
      if (typeof source.supportedSources === 'object' && !Array.isArray(source.supportedSources)) {
        console.log('  - supportedSources keys:', Object.keys(source.supportedSources));
      }
    }

    // 检查 sourceSchemas
    if (source.sourceSchemas) {
      console.log('  - sourceSchemas 类型:', typeof source.sourceSchemas);
      if (typeof source.sourceSchemas === 'object') {
        console.log('  - sourceSchemas keys:', Object.keys(source.sourceSchemas));
      }
    }

    // 检查 sources 字段（可能是遗留字段）
    if (source.sources) {
      console.log('  - sources 类型:', typeof source.sources);
      if (typeof source.sources === 'object') {
        console.log('  - sources keys:', Object.keys(source.sources));
      }
    }

    console.log('  ✓ 通过\n');
  } catch (e) {
    console.error('  ✗ 错误:', e.message);
    console.error('  完整音源数据:', JSON.stringify(source, null, 2));
    process.exit(1);
  }
});

console.log('所有音源测试通过！');
