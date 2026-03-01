#!/usr/bin/env node
const http = require('http');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || process.argv[2] || 2999;
let services = [];
let lastScan = null;

const IGNORED_PORTS = [53, 631, 3306, 5432, 6379, 27017, 9000, 9042, PORT];

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function parseLsof(stdout) {
  const lines = stdout.split('\n').slice(1);
  const found = new Map();

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;

    const command = parts[0];
    const pid = parseInt(parts[1]);
    const nameStr = parts[8];
    const portMatch = nameStr.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1]);
    if (port <= 1024 || IGNORED_PORTS.includes(port)) continue;
    if (found.has(port)) continue;

    found.set(port, { port, pid, command });
  }
  return Array.from(found.values());
}

function getCwd(pid) {
  try {
    const out = execSync(`lsof -p ${pid} -a -d cwd -Fn`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
    const line = out.split('\n').find(l => l.startsWith('n'));
    return line ? line.substring(1).trim() : null;
  } catch (e) { return null; }
}

function enrichMetadata(service) {
  const cwd = getCwd(service.pid);
  let meta = {
    name: service.command.charAt(0).toUpperCase() + service.command.slice(1),
    description: `Process ${service.command} running on port ${service.port}`,
    stack: 'unknown',
    color: '#666'
  };

  if (!cwd) return { ...service, ...meta };

  const dirName = path.basename(cwd).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  meta.name = dirName;

  // 1. Check Files
  const files = fs.readdirSync(cwd);

  if (files.includes('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      if (pkg.name) meta.name = pkg.name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if (pkg.description) meta.description = pkg.description;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) { meta.stack = 'next'; meta.color = '#fff'; }
      else if (deps.vite) { meta.stack = 'vite'; meta.color = '#ffdc40'; }
      else if (deps.react) { meta.stack = 'react'; meta.color = '#61dafb'; }
      else if (deps.express) { meta.stack = 'express'; meta.color = '#828282'; }
    } catch (e) {}
  }

  if (files.includes('manage.py')) { meta.stack = 'django'; meta.color = '#092e20'; }
  if (files.includes('Cargo.toml')) { meta.stack = 'rust'; meta.color = '#f74c00'; }
  if (files.includes('go.mod')) { meta.stack = 'go'; meta.color = '#00add8'; }
  if (files.includes('Gemfile')) { meta.stack = 'ruby'; meta.color = '#701516'; }

  if (files.includes('README.md')) {
    try {
      const readme = fs.readFileSync(path.join(cwd, 'README.md'), 'utf8');
      const titleMatch = readme.match(/^#\s+(.+)$/m);
      if (titleMatch) meta.name = titleMatch[1].trim();
      const paraMatch = readme.split('\n').find(l => l.trim() && !l.startsWith('#'));
      if (paraMatch) meta.description = paraMatch.trim();
    } catch (e) {}
  }

  return { ...service, ...meta };
}

async function runScan() {
  try {
    const stdout = execSync('lsof -i -n -P -sTCP:LISTEN').toString();
    const rawServices = parseLsof(stdout);
    services = rawServices.map(enrichMetadata);
    lastScan = new Date().toLocaleTimeString();
  } catch (e) { services = []; }
}

setInterval(runScan, 5000);
runScan();

const server = http.createServer((req, res) => {
  if (req.url === '/api/services') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ services, lastScan }));
  }

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LocalHarbor</title>
    <style>
        :root { --bg: #0a0a0f; --card: #16161d; --text: #eee; --muted: #888; }
        body { background: var(--bg); color: var(--text); font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 2rem; }
        header { margin-bottom: 3rem; }
        h1 { margin: 0; font-size: 1.5rem; letter-spacing: -0.5px; }
        .net-url { color: var(--muted); font-size: 0.9rem; margin-top: 0.5rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.5rem; }
        .card { background: var(--card); padding: 1.5rem; border-radius: 18px; text-decoration: none; color: inherit;
                transition: transform 0.2s, box-shadow 0.2s; position: relative; border: 1px solid #ffffff0a; cursor: pointer; }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 30px rgba(0,0,0,0.5); border-color: #ffffff1a; }
        .stack-icon { width: 44px; height: 44px; border-radius: 10px; margin-bottom: 1rem; display: flex;
                      align-items: center; justify-content: center; font-weight: bold; font-size: 1.2rem; }
        .name { font-weight: 700; display: block; margin-bottom: 0.25rem; }
        .desc { font-size: 0.85rem; color: var(--muted); line-height: 1.4; }
        .port { position: absolute; bottom: 1rem; right: 1rem; font-family: monospace; font-size: 0.75rem; color: #444; }
        #last-scan { position: fixed; bottom: 1rem; left: 1rem; font-size: 0.7rem; color: #333; }
        .empty { grid-column: 1/-1; text-align: center; padding: 4rem; color: var(--muted); opacity: 0.5; }
    </style>
</head>
<body>
    <header>
        <h1>${os.hostname()}</h1>
        <div class="net-url">Network: http://${getLocalIP()}:${PORT}</div>
    </header>
    <div class="grid" id="grid"></div>
    <div id="last-scan">Last scanned: --</div>
    <script>
        let lastData = "";
        async function update() {
            try {
                const res = await fetch('/api/services');
                const data = await res.json();
                const dataStr = JSON.stringify(data.services);
                if (dataStr === lastData) return;
                lastData = dataStr;

                const grid = document.getElementById('grid');
                document.getElementById('last-scan').innerText = "Last scanned: " + data.lastScan;

                if (data.services.length === 0) {
                    grid.innerHTML = '<div class="empty">No services found. Start a dev server to see it here.</div>';
                    return;
                }

                grid.innerHTML = data.services.map(s => \`
                    <a href="http://localhost:\${s.port}" target="_blank" class="card">
                        <div class="stack-icon" style="background: \${s.color}22; color: \${s.color}">
                            \${s.stack === 'unknown' ? s.name[0] : ''}
                        </div>
                        <span class="name">\${s.name}</span>
                        <div class="desc">\${s.description}</div>
                        <span class="port">:\${s.port}</span>
                    </a>
                \`).join('');
            } catch(e) {}
        }
        setInterval(update, 5000);
        update();
    </script>
</body>
</html>`;
    res.end(html);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\x1b[32mLocalHarbor started\x1b[0m`);
  console.log(`Local:   http://localhost:${PORT}`);
  console.log(`Network: http://${getLocalIP()}:${PORT}\n`);
});

module.exports = { parseLsof, enrichMetadata, getLocalIP, server };