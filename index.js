#!/usr/bin/env node

const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || process.argv[2] || '2999', 10);
const SCAN_INTERVAL = 5000;

const SKIP_PORTS = new Set([
  53, 631, 5432, 5433, 3306, 3307, 6379, 6380, 27017, 27018, 9200, 9300,
  2181, 5672, 15672, 11211, 1521, 1433, 389, 636, 88, 464, 749,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function tryReadFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

function titleCase(str) {
  return str
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// ---------------------------------------------------------------------------
// Port Discovery  (lsof -i -n -P -sTCP:LISTEN)
// ---------------------------------------------------------------------------

function discoverPorts() {
  let raw = '';
  try {
    raw = execSync('lsof -i -n -P -sTCP:LISTEN 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
  } catch (e) {
    // lsof may exit non-zero when nothing is listening
    if (e.stdout) raw = e.stdout;
    else return [];
  }

  const lines = raw.split('\n').slice(1); // skip header
  const seen = new Map(); // port -> { pid, name }

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.trim().split(/\s+/);
    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    if (cols.length < 9) continue;
    const procName = cols[0];
    const pid = parseInt(cols[1], 10);
    const nameField = cols[cols.length - 1]; // e.g. *:3000 or 127.0.0.1:3000 or [::]:3000
    const portMatch = nameField.match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = parseInt(portMatch[1], 10);

    if (port < 1024) continue;
    if (port === PORT) continue; // exclude ourselves
    if (SKIP_PORTS.has(port)) continue;

    if (!seen.has(port)) {
      seen.set(port, { pid, procName });
    }
  }

  return Array.from(seen.entries()).map(([port, info]) => ({
    port,
    pid: info.pid,
    procName: info.procName,
  }));
}

// ---------------------------------------------------------------------------
// CWD resolution
// ---------------------------------------------------------------------------

function getCwd(pid) {
  try {
    const out = execSync(`lsof -p ${pid} -a -d cwd -Fn 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
    const lines = out.split('\n');
    for (const l of lines) {
      if (l.startsWith('n') && l.length > 1 && l[1] === '/') return l.slice(1);
    }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Metadata enrichment
// ---------------------------------------------------------------------------

function detectStack(cwd) {
  if (!cwd) return { stack: 'unknown', framework: null };

  const pkgPath = path.join(cwd, 'package.json');
  const pkgContent = tryReadFile(pkgPath);
  if (pkgContent) {
    const lower = pkgContent.toLowerCase();
    // Order matters — more specific first
    if (lower.includes('"next"') || lower.includes('"next/'))       return { stack: 'node', framework: 'Next.js' };
    if (lower.includes('"nuxt"') || lower.includes('"nuxt/'))       return { stack: 'node', framework: 'Nuxt' };
    if (lower.includes('"svelte"') || lower.includes('"sveltekit')) return { stack: 'node', framework: 'Svelte' };
    if (lower.includes('"astro"'))                                  return { stack: 'node', framework: 'Astro' };
    if (lower.includes('"gatsby"'))                                 return { stack: 'node', framework: 'Gatsby' };
    if (lower.includes('"remix"'))                                  return { stack: 'node', framework: 'Remix' };
    if (lower.includes('"vite"'))                                   return { stack: 'node', framework: 'Vite' };
    if (lower.includes('"react"'))                                  return { stack: 'node', framework: 'React' };
    if (lower.includes('"vue"'))                                    return { stack: 'node', framework: 'Vue' };
    if (lower.includes('"angular'))                                 return { stack: 'node', framework: 'Angular' };
    if (lower.includes('"express"'))                                return { stack: 'node', framework: 'Express' };
    if (lower.includes('"fastify"'))                                return { stack: 'node', framework: 'Fastify' };
    if (lower.includes('"koa"'))                                    return { stack: 'node', framework: 'Koa' };
    if (lower.includes('"hono"'))                                   return { stack: 'node', framework: 'Hono' };
    if (lower.includes('"elysia"'))                                 return { stack: 'node', framework: 'Elysia' };
    return { stack: 'node', framework: 'Node.js' };
  }

  if (fs.existsSync(path.join(cwd, 'manage.py'))) {
    const reqContent = tryReadFile(path.join(cwd, 'requirements.txt')) || '';
    if (reqContent.toLowerCase().includes('fastapi'))               return { stack: 'python', framework: 'FastAPI' };
    return { stack: 'python', framework: 'Django' };
  }

  if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
    const pyproj = tryReadFile(path.join(cwd, 'pyproject.toml')) || '';
    if (pyproj.toLowerCase().includes('fastapi'))                   return { stack: 'python', framework: 'FastAPI' };
    if (pyproj.toLowerCase().includes('flask'))                     return { stack: 'python', framework: 'Flask' };
    if (pyproj.toLowerCase().includes('django'))                    return { stack: 'python', framework: 'Django' };
    return { stack: 'python', framework: 'Python' };
  }

  if (fs.existsSync(path.join(cwd, 'requirements.txt'))) {
    const req = tryReadFile(path.join(cwd, 'requirements.txt')) || '';
    if (req.toLowerCase().includes('fastapi'))                      return { stack: 'python', framework: 'FastAPI' };
    if (req.toLowerCase().includes('flask'))                        return { stack: 'python', framework: 'Flask' };
    if (req.toLowerCase().includes('django'))                       return { stack: 'python', framework: 'Django' };
    return { stack: 'python', framework: 'Python' };
  }

  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    const cargo = tryReadFile(path.join(cwd, 'Cargo.toml')) || '';
    if (cargo.toLowerCase().includes('actix'))                      return { stack: 'rust', framework: 'Actix' };
    if (cargo.toLowerCase().includes('axum'))                       return { stack: 'rust', framework: 'Axum' };
    if (cargo.toLowerCase().includes('rocket'))                     return { stack: 'rust', framework: 'Rocket' };
    return { stack: 'rust', framework: 'Rust' };
  }

  if (fs.existsSync(path.join(cwd, 'go.mod')))                     return { stack: 'go', framework: 'Go' };
  if (fs.existsSync(path.join(cwd, 'Gemfile'))) {
    const gem = tryReadFile(path.join(cwd, 'Gemfile')) || '';
    if (gem.toLowerCase().includes('rails'))                        return { stack: 'ruby', framework: 'Rails' };
    if (gem.toLowerCase().includes('sinatra'))                      return { stack: 'ruby', framework: 'Sinatra' };
    return { stack: 'ruby', framework: 'Ruby' };
  }

  return { stack: 'unknown', framework: null };
}

function getProcessArgv(pid) {
  try {
    const out = execSync(`ps -p ${pid} -o args= 2>/dev/null`, { encoding: 'utf8', timeout: 3000 });
    return out.trim();
  } catch { return ''; }
}

function nameFromArgv(argv) {
  if (!argv) return null;
  const patterns = [
    /\b(vite|next|nuxt|svelte|astro|remix|gatsby)\b/i,
    /\b(express|fastify|koa|hono|elysia)\b/i,
    /\b(manage\.py|uvicorn|gunicorn|flask)\b/i,
    /\b(cargo|rustc)\b/i,
  ];
  for (const p of patterns) {
    const m = argv.match(p);
    if (m) return titleCase(m[1].replace('.py', ''));
  }
  return null;
}

function repoNameFromGitConfig(cwd) {
  const cfg = tryReadFile(path.join(cwd, '.git', 'config'));
  if (!cfg) return null;
  const m = cfg.match(/url\s*=\s*.*?([^/\s]+?)(?:\.git)?\s*$/m);
  return m ? titleCase(m[1]) : null;
}

function nameFromReadme(cwd) {
  const readme = tryReadFile(path.join(cwd, 'README.md')) || tryReadFile(path.join(cwd, 'readme.md'));
  if (!readme) return null;
  const headingMatch = readme.match(/^#\s+(.+)/m);
  const name = headingMatch ? headingMatch[1].trim() : null;
  let description = null;

  if (headingMatch) {
    // Find first non-empty body paragraph after the heading
    const afterHeading = readme.slice(readme.indexOf(headingMatch[0]) + headingMatch[0].length);
    const lines = afterHeading.split('\n');
    for (const l of lines) {
      const trimmed = l.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) break; // another heading
      if (trimmed.startsWith('!') || trimmed.startsWith('[!')) continue; // badges
      if (trimmed.startsWith('[![')) continue; // badge links
      description = trimmed.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // strip links
      break;
    }
  }

  return { name, description };
}

function nameFromPackageJson(cwd) {
  const raw = tryReadFile(path.join(cwd, 'package.json'));
  if (!raw) return null;
  try {
    const pkg = JSON.parse(raw);
    return {
      name: pkg.name ? titleCase(pkg.name) : null,
      description: pkg.description || null,
    };
  } catch { return null; }
}

function nameFromToml(cwd) {
  for (const file of ['pyproject.toml', 'Cargo.toml']) {
    const raw = tryReadFile(path.join(cwd, file));
    if (!raw) continue;
    const nameMatch = raw.match(/^name\s*=\s*"([^"]+)"/m);
    const descMatch = raw.match(/^description\s*=\s*"([^"]+)"/m);
    if (nameMatch) {
      return {
        name: titleCase(nameMatch[1]),
        description: descMatch ? descMatch[1] : null,
      };
    }
  }
  return null;
}

function nameFromGoMod(cwd) {
  const raw = tryReadFile(path.join(cwd, 'go.mod'));
  if (!raw) return null;
  const m = raw.match(/^module\s+(\S+)/m);
  if (!m) return null;
  const parts = m[1].split('/');
  return { name: titleCase(parts[parts.length - 1]), description: null };
}

function enrichService(entry) {
  const { port, pid, procName } = entry;
  const cwd = getCwd(pid);
  const { stack, framework } = detectStack(cwd);

  let name = null;
  let description = null;

  // Priority chain for name + description
  if (cwd) {
    const readme = nameFromReadme(cwd);
    if (readme && readme.name) {
      name = readme.name;
      description = readme.description;
    }

    if (!name) {
      const pkg = nameFromPackageJson(cwd);
      if (pkg && pkg.name) { name = pkg.name; description = description || pkg.description; }
    }

    if (!name) {
      const toml = nameFromToml(cwd);
      if (toml && toml.name) { name = toml.name; description = description || toml.description; }
    }

    if (!name) {
      const gomod = nameFromGoMod(cwd);
      if (gomod && gomod.name) { name = gomod.name; description = description || gomod.description; }
    }

    if (!name) {
      const repo = repoNameFromGitConfig(cwd);
      if (repo) name = repo;
    }
  }

  if (!name) {
    const argv = getProcessArgv(pid);
    const fromArgv = nameFromArgv(argv);
    if (fromArgv) name = fromArgv;
  }

  if (!name && cwd) {
    name = titleCase(path.basename(cwd));
  }

  if (!name) {
    name = `Port ${port}`;
  }

  return {
    port,
    pid,
    procName,
    name,
    description: description || null,
    stack,
    framework,
    cwd: cwd || null,
  };
}

// ---------------------------------------------------------------------------
// Scanner state
// ---------------------------------------------------------------------------
let services = [];
let lastScanned = null;

function scan() {
  try {
    const entries = discoverPorts();
    services = entries.map(enrichService);
    lastScanned = new Date().toISOString();
  } catch (e) {
    console.error('Scan error:', e.message);
  }
}

// ---------------------------------------------------------------------------
// UI  — single template literal
// ---------------------------------------------------------------------------

function dashboardHTML() {
  const hostname = os.hostname();
  const ip = getLocalIP();
  const networkURL = `http://${ip}:${PORT}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LocalHarbor</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #0a0a0f;
    color: #e0e0e6;
    min-height: 100vh;
    overflow-x: hidden;
  }

  .header {
    text-align: center;
    padding: 40px 20px 10px;
  }
  .header h1 {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.5px;
    background: linear-gradient(135deg, #6ee7b7, #3b82f6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 8px;
  }
  .header .subtitle {
    font-size: 13px;
    color: #555;
  }
  .header .subtitle a {
    color: #6ee7b7;
    text-decoration: none;
  }
  .header .subtitle a:hover { text-decoration: underline; }
  .last-scan {
    text-align: center;
    font-size: 11px;
    color: #333;
    padding: 4px 0 24px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 24px 60px;
  }

  .card {
    background: #12121a;
    border: 1px solid #1e1e2a;
    border-radius: 16px;
    padding: 24px 20px 18px;
    cursor: pointer;
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
  .card:hover {
    transform: translateY(-4px);
    border-color: var(--accent, #3b82f6);
    box-shadow: 0 8px 30px rgba(0,0,0,0.4), 0 0 20px color-mix(in srgb, var(--accent, #3b82f6) 25%, transparent);
  }

  .card-icon {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .card-name {
    font-size: 15px;
    font-weight: 600;
    color: #f0f0f5;
    margin-bottom: 4px;
    line-height: 1.3;
    word-break: break-word;
  }
  .card-desc {
    font-size: 12px;
    color: #666;
    line-height: 1.4;
    flex: 1;
    margin-bottom: 10px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-port {
    font-size: 11px;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    color: #333;
    align-self: flex-end;
  }
  .card-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 7px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent, #3b82f6) 15%, transparent);
    color: var(--accent, #3b82f6);
  }

  .empty {
    text-align: center;
    padding: 80px 20px;
    max-width: 480px;
    margin: 0 auto;
  }
  .empty-icon {
    font-size: 64px;
    margin-bottom: 20px;
    animation: float 3s ease-in-out infinite;
  }
  .empty h2 {
    font-size: 20px;
    color: #555;
    margin-bottom: 10px;
  }
  .empty p {
    font-size: 14px;
    color: #333;
    line-height: 1.6;
  }
  .empty code {
    background: #1a1a24;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: #6ee7b7;
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-10px); }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .card { animation: fadeIn 0.3s ease both; }
</style>
</head>
<body>
<div class="header">
  <h1>LocalHarbor</h1>
  <div class="subtitle">${hostname} &middot; <a href="${networkURL}" title="Access from any device on your network">${networkURL}</a></div>
</div>
<div class="last-scan" id="lastScan"></div>
<div id="root"></div>

<script>
(function() {
  const root = document.getElementById('root');
  const lastScanEl = document.getElementById('lastScan');
  let currentServices = [];

  const STACK_COLORS = {
    'Next.js':'#0070f3','Nuxt':'#00dc82','Svelte':'#ff3e00','Astro':'#bc52ee',
    'Gatsby':'#663399','Remix':'#3992ff','Vite':'#646cff','React':'#61dafb',
    'Vue':'#42b883','Angular':'#dd0031','Express':'#68a063','Fastify':'#000',
    'Koa':'#33333d','Hono':'#ff6a00','Elysia':'#a855f7','Node.js':'#68a063',
    'FastAPI':'#009688','Django':'#0c4b33','Flask':'#000',
    'Python':'#ffd43b','Rust':'#ce422b','Actix':'#ce422b','Axum':'#ce422b',
    'Rocket':'#d33847','Go':'#00add8','Rails':'#cc0000','Sinatra':'#000',
    'Ruby':'#cc342d',
  };

  const STACK_ICONS = {
    'Next.js':'N','Nuxt':'Nx','Svelte':'S','Astro':'A','Gatsby':'G',
    'Remix':'R','Vite':'V','React':'R','Vue':'V','Angular':'Ng',
    'Express':'Ex','Fastify':'F','Koa':'K','Hono':'H','Elysia':'El',
    'Node.js':'JS','FastAPI':'FA','Django':'Dj','Flask':'Fl',
    'Python':'Py','Rust':'Rs','Actix':'Ax','Axum':'Ax','Rocket':'Rk',
    'Go':'Go','Rails':'Ra','Sinatra':'Si','Ruby':'Rb',
  };

  function accentFor(svc) {
    if (svc.framework && STACK_COLORS[svc.framework]) return STACK_COLORS[svc.framework];
    // Generate from port number
    var hue = (svc.port * 137) % 360;
    return 'hsl(' + hue + ', 55%, 55%)';
  }

  function iconFor(svc) {
    if (svc.framework && STACK_ICONS[svc.framework]) return STACK_ICONS[svc.framework];
    return svc.name.charAt(0).toUpperCase();
  }

  function renderEmpty() {
    return '<div class="empty">' +
      '<div class="empty-icon">&#9875;</div>' +
      '<h2>No services detected</h2>' +
      '<p>Start a dev server on this machine and it will appear here automatically.<br>' +
      'For example: <code>npx vite</code> or <code>python -m http.server 8000</code></p>' +
      '</div>';
  }

  function renderCard(svc, i) {
    var accent = accentFor(svc);
    var icon = iconFor(svc);
    var delay = (i * 0.04) + 's';
    var badge = svc.framework ? '<div class="card-badge">' + svc.framework + '</div>' : '';
    var desc = svc.description ? '<div class="card-desc">' + escapeHtml(svc.description) + '</div>' : '<div class="card-desc"></div>';
    return '<a class="card" href="http://localhost:' + svc.port + '" target="_blank" rel="noopener" ' +
      'style="--accent:' + accent + '; animation-delay:' + delay + '">' +
      badge +
      '<div class="card-icon" style="background:' + accent + '">' + icon + '</div>' +
      '<div class="card-name">' + escapeHtml(svc.name) + '</div>' +
      desc +
      '<div class="card-port">:' + svc.port + '</div>' +
      '</a>';
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function render(data) {
    if (!data.services || data.services.length === 0) {
      root.innerHTML = renderEmpty();
    } else {
      root.innerHTML = '<div class="grid">' + data.services.map(function(s,i){ return renderCard(s,i); }).join('') + '</div>';
    }
    if (data.lastScanned) {
      var d = new Date(data.lastScanned);
      lastScanEl.textContent = 'Last scanned ' + d.toLocaleTimeString();
    }
    currentServices = data.services || [];
  }

  function sameServices(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].port !== b[i].port || a[i].name !== b[i].name || a[i].framework !== b[i].framework || a[i].pid !== b[i].pid) return false;
    }
    return true;
  }

  function poll() {
    fetch('/api/services')
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (!sameServices(currentServices, data.services || [])) {
          render(data);
        } else if (data.lastScanned) {
          var d = new Date(data.lastScanned);
          lastScanEl.textContent = 'Last scanned ' + d.toLocaleTimeString();
        }
      })
      .catch(function(){});
  }

  // Initial render
  poll();
  setInterval(poll, 5000);
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/services') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ services, lastScanned }));
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(dashboardHTML());
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

scan();
setInterval(scan, SCAN_INTERVAL);

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`
  ╔══════════════════════════════════════════╗
  ║            ⚓  LocalHarbor               ║
  ╠══════════════════════════════════════════╣
  ║  Local:    http://localhost:${PORT}        ║
  ║  Network:  http://${ip}:${PORT}     ║
  ╚══════════════════════════════════════════╝
  `);
});
