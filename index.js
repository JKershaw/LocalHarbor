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
  const lines = stdout.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].trim().split(/\s+/);
  const pidIdx = headers.indexOf('PID');
  const nameIdx = headers.indexOf('NAME');
  const commandIdx = headers.indexOf('COMMAND');

  if (pidIdx === -1 || nameIdx === -1) return [];

  const found = new Map();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    // Handle potential column shifts due to spaces in COMMAND or USER
    // by working backwards from the NAME column if needed,
    // but typically splitting by whitespace is sufficient for lsof -i -n -P
    const pid = parseInt(parts[pidIdx]);
    const nameStr = parts[parts.length - 1]; // NAME is usually last
    const command = parts[commandIdx] || 'unknown';

    // Matches :3000 (IPv4) or [::1]:3000 (IPv6)
    const portMatch = nameStr.match(/[:](\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1]);
    if (port <= 1024 || IGNORED_PORTS.includes(port)) continue;

    // Deduplicate: same port might appear for IPv4 and IPv6
    if (!found.has(port)) {
      found.set(port, { port, pid, command });
    }
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
  let name = service.command.charAt(0).toUpperCase() + service.command.slice(1);
  let description = `Process ${service.command} running on port ${service.port}`;
  let stack = 'unknown';
  let color = '#666';

  const titleCase = (s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  if (cwd) {
    // 1. Base name from directory
    name = titleCase(path.basename(cwd));

    // 2. Extract from argv (ps -p <pid> -o args=)
    try {
      const argv = execSync(`ps -p ${service.pid} -o args=`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      const parts = argv.split(/\s+/);
      const cmd = parts.find(p => ['vite', 'next', 'manage.py', 'flask', 'uvicorn', 'nodemon'].some(s => p.includes(s)));
      if (cmd) name = titleCase(path.basename(cmd));
    } catch (e) {}

    // 3. Git remote URL
    try {
      const gitConfigPath = path.join(cwd, '.git', 'config');
      if (fs.existsSync(gitConfigPath)) {
        const config = fs.readFileSync(gitConfigPath, 'utf8');
        const remoteMatch = config.match(/url\s*=\s*.*\/([^/\n]+?)(\.git)?\s*$/m);
        if (remoteMatch) name = titleCase(remoteMatch[1]);
      }
    } catch (e) {}

    const files = fs.readdirSync(cwd);

    // 4. Tech manifests (pyproject.toml, Cargo.toml, go.mod)
    if (files.includes('pyproject.toml')) {
      try {
        const content = fs.readFileSync(path.join(cwd, 'pyproject.toml'), 'utf8');
        const nameMatch = content.match(/^name\s*=\s*["'](.+?)["']/m);
        if (nameMatch) name = titleCase(nameMatch[1]);
        stack = 'fastapi'; color = '#05998b';
      } catch (e) {}
    }
    if (files.includes('Cargo.toml')) {
      try {
        const content = fs.readFileSync(path.join(cwd, 'Cargo.toml'), 'utf8');
        const nameMatch = content.match(/^name\s*=\s*["'](.+?)["']/m);
        if (nameMatch) name = titleCase(nameMatch[1]);
        stack = 'rust'; color = '#f74c00';
      } catch (e) {}
    }
    if (files.includes('go.mod')) {
      try {
        const content = fs.readFileSync(path.join(cwd, 'go.mod'), 'utf8');
        const modMatch = content.match(/^module\s+(.+)$/m);
        if (modMatch) name = titleCase(path.basename(modMatch[1].trim()));
        stack = 'go'; color = '#00add8';
      } catch (e) {}
    }

    // 5. package.json
    if (files.includes('package.json')) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
        if (pkg.name) name = titleCase(pkg.name);
        if (pkg.description) description = pkg.description;
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.next) { stack = 'next'; color = '#fff'; }
        else if (deps.vite) { stack = 'vite'; color = '#ffdc40'; }
        else if (deps.react) { stack = 'react'; color = '#61dafb'; }
        else if (deps.express) { stack = 'express'; color = '#828282'; }
      } catch (e) {}
    }

    // 6. Framework specific flags
    if (files.includes('manage.py')) { stack = 'django'; color = '#092e20'; }
    if (files.includes('Gemfile')) { stack = 'ruby'; color = '#701516'; }
    if (files.includes('requirements.txt')) {
      const reqs = fs.readFileSync(path.join(cwd, 'requirements.txt'), 'utf8');
      if (reqs.includes('fastapi')) { stack = 'fastapi'; color = '#05998b'; }
    }

    // 7. README.md (Highest priority for name and description)
    if (files.includes('README.md')) {
      try {
        const readme = fs.readFileSync(path.join(cwd, 'README.md'), 'utf8');
        const titleMatch = readme.match(/^#\s+(.+)$/m);
        if (titleMatch) name = titleMatch[1].trim();
        const paragraphs = readme.split(/\n\s*\n/);
        const firstPara = paragraphs.find(p => p.trim() && !p.trim().startsWith('#'));
        if (firstPara) description = firstPara.trim().replace(/\n/g, ' ');
      } catch (e) {}
    }
  }

  return { ...service, name, description, stack, color };
}

async function runScan() {
  try {
    const stdout = execSync('lsof -i -n -P -sTCP:LISTEN', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
    const rawServices = parseLsof(stdout);
    services = rawServices.map(enrichMetadata);
    lastScan = new Date().toLocaleTimeString();
  } catch (e) {
    services = [];
  }
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