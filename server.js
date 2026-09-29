// Lokaler Server: node server.js  (auf Vercel läuft stattdessen api/index.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const handler = require('./lib/handler');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'public');
const types = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css' };

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p.startsWith('/api/')) return handler(req, res);
  const file = path.join(INDEX, path.normalize(p));
  const isFile = file.startsWith(INDEX) && p !== '/' && fs.existsSync(file) && fs.statSync(file).isFile();
  const target = isFile ? file : path.join(INDEX, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'text/plain' });
  fs.createReadStream(target).pipe(res);
}).listen(PORT, () => console.log(`Wunsch-Chaste läuft auf http://localhost:${PORT}`));
