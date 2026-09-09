const fs = require('fs');
const http = require('http');

const path = 'D:/lxMusic/mucis/free.js';
const rawScript = fs.readFileSync(path, 'utf8');
const body = JSON.stringify({ sourcePath: path, rawScript });

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/lx/source/import-file',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log(data);
  });
});
req.on('error', (e) => console.error('ERROR', e.message));
req.write(body);
req.end();
