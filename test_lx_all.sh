#!/usr/bin/env bash
set -uo pipefail
DIR="D:/lxMusic/mucis"
PORT=38889
RESULTS_FILE="d:/code/Mineradio-main/lx_test_results.txt"
> "$RESULTS_FILE"

for file in "$DIR"/*.js; do
  echo "=== 测试脚本: $(basename "$file") ===" | tee -a "$RESULTS_FILE"

  # 启动服务器
  PORT=$PORT node d:/code/Mineradio-main/server.js > server.tmp 2>&1 &
  SERVER_PID=$!
  sleep 5

  # 导入脚本
  IMPORT_BODY=$(python3 -c "import json; print(json.dumps({'sourcePath':'$file','rawScript':open(r'$file','r',encoding='utf-8').read()}))" 2>/dev/null || python -c "import json; print(json.dumps({'sourcePath':'$file','rawScript':open(r'$file','r',encoding='utf-8').read()}))")
  import_resp=$(curl -s -X POST "http://127.0.0.1:${PORT}/api/lx/source/import-file" \
    -H "Content-Type: application/json" \
    -d "$IMPORT_BODY")
  echo "导入返回: $import_resp" | tee -a "$RESULTS_FILE"

  # 调用搜索 & 解析 URL
  result=$(curl -s -X POST "http://127.0.0.1:${PORT}/api/lx/search-and-url" \
    -H "Content-Type: application/json" \
    -d '{"source":"netease","song":{"name":"Baby","artist":"Justin Bieber","artists":[{"name":"Justin Bieber"},{"name":"Ludacris"}],"duration":210000}}')
  echo "search-and-url 返回: $result" | tee -a "$RESULTS_FILE"
  echo "" | tee -a "$RESULTS_FILE"

  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
done
echo "所有脚本测试完成，结果保存到 $RESULTS_FILE"
