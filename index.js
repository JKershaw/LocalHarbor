const http = require('http');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const PORT = process.env.PORT || process.argv[2] || 2999;
let cachedServices = [];

/**
 * Finds the first non-internal IPv4 address.
 * @returns {string} The local IP address or 127.0.0.1 as fallback.
 */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // Skip over internal (i.e. 127.0.0.1) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

function getCwd(pid) {
  try {
    const out = execSync('lsof -p ' + pid + ' -a -d cwd -Fn', { encoding: 'utf8' });
    const lines = out.trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('n')) return line.slice(1);
    }
    return null;
  } catch (e) { return null; }
}

function detectStack(cwd, port) {
  if (!cwd) return { stack: 'Unknown', color: 'hsl(' + ((port * 137) % 360) + ', 70%, 60%)' };
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
      if (deps['next']) return { stack: 'Next.js', color: '#000' };
      if (deps['react']) return { stack: 'React', color: '#61dafb' };
      if (deps['vue']) return { stack: 'Vue', color: '#42b883' };
      if (deps['svelte']) return { stack: 'Svelte', color: '#ff3e00' };
      if (deps['@angular/core']) return { stack: 'Angular', color: '#dd0031' };
      if (deps['nuxt']) return { stack: 'Nuxt', color: '#00dc82' };
      if (deps['express']) return { stack: 'Express', color: '#68a063' };
      if (deps['fastify']) return { stack: 'Fastify', color: '#000' };
      if (deps['vite']) return { stack: 'Vite', color: '#646cff' };
      return { stack: 'Node.js', color: '#68a063' };
    }
    if (fs.existsSync(path.join(cwd, 'manage.py'))) return { stack: 'Django', color: '#092e20' };
    if (fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'setup.py'))) return { stack: 'Python', color: '#3776ab' };
    if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return { stack: 'Rust', color: '#ce412b' };
    if (fs.existsSync(path.join(cwd, 'go.mod'))) return { stack: 'Go', color: '#00add8' };
    if (fs.existsSync(path.join(cwd, 'Gemfile'))) return { stack: 'Ruby', color: '#cc342d' };
  } catch (e) {}
  return { stack: 'Unknown', color: 'hsl(' + ((port * 137) % 360) + ', 70%, 60%)' };
}

function getProjectMeta(cwd, port) {
  if (!cwd) return { name: 'Port ' + port, description: '' };
  try {
    const readmePath = path.join(cwd, 'README.md');
    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf8');
      const headingMatch = content.match(/^#\s+(.+)/m);
      if (headingMatch) {
        const lines = content.split('\n');
        let desc = '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) { desc = trimmed; break; }
        }
        return { name: headingMatch[1].trim(), description: desc };
      }
    }
  } catch (e) {}
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return { name: pkg.name, description: pkg.description || '' };
    }
  } catch (e) {}
  try {
    const pyPath = path.join(cwd, 'pyproject.toml');
    if (fs.existsSync(pyPath)) {
      const content = fs.readFileSync(pyPath, 'utf8');
      const nm = content.match(/^name\s*=\s*"(.+?)"/m);
      const ds = content.match(/^description\s*=\s*"(.+?)"/m);
      if (nm) return { name: nm[1], description: ds ? ds[1] : '' };
    }
  } catch (e) {}
  try {
    const cargoPath = path.join(cwd, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      const content = fs.readFileSync(cargoPath, 'utf8');
      const nm = content.match(/^name\s*=\s*"(.+?)"/m);
      const ds = content.match(/^description\s*=\s*"(.+?)"/m);
      if (nm) return { name: nm[1], description: ds ? ds[1] : '' };
    }
  } catch (e) {}
  try {
    const goPath = path.join(cwd, 'go.mod');
    if (fs.existsSync(goPath)) {
      const content = fs.readFileSync(goPath, 'utf8');
      const m = content.match(/^module\s+(.+)/m);
      if (m) {
        const parts = m[1].trim().split('/');
        return { name: parts[parts.length - 1], description: '' };
      }
    }
  } catch (e) {}
  try {
    const gitConfig = path.join(cwd, '.git', 'config');
    if (fs.existsSync(gitConfig)) {
      const content = fs.readFileSync(gitConfig, 'utf8');
      const m = content.match(/url\s*=\s*(.+)/m);
      if (m) {
        const parts = m[1].trim().split('/');
        const repoName = parts[parts.length - 1].replace(/\.git$/, '');
        return { name: repoName, description: '' };
      }
    }
  } catch (e) {}
  const dirName = path.basename(cwd);
  const titleCased = dirName.replace(/[-_]/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (titleCased) return { name: titleCased, description: '' };
  return { name: 'Port ' + port, description: '' };
}

/**
 * Scans for listening TCP services using lsof.
 * @returns {Promise<Array>}
 */
async function scanServices() {
  const knownNonWebPorts = [5432, 3306, 6379, 53, 27017, 11211, 9200, 2181, 4369, 25, 587, 143, 993, 110, 995];
  try {
    const output = execSync('lsof -i -n -P -sTCP:LISTEN', { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    const services = [];
    const seenPorts = new Set();

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(/\s+/);
      if (parts.length < 9) continue;

      const processName = parts[0];
      const pid = parseInt(parts[1], 10);
      const name = parts[8];
      const portStr = name.split(':').pop();
      const port = parseInt(portStr, 10);

      if (isNaN(port) || isNaN(pid)) continue;

      // Filter: below 1024, own port, and known non-web ports
      if (port < 1024 || port === Number(PORT) || knownNonWebPorts.includes(port)) {
        continue;
      }

      // Deduplicate by port
      if (!seenPorts.has(port)) {
        seenPorts.add(port);
        services.push({ port, pid, processName });
      }
    }
    return services.map(s => {
      const cwd = getCwd(s.pid);
      const si = detectStack(cwd, s.port);
      const meta = getProjectMeta(cwd, s.port);
      return { port: s.port, pid: s.pid, processName: s.processName, cwd, name: meta.name, description: meta.description, stack: si.stack, color: si.color };
    });
  } catch (err) {
    return [];
  }
}

/**
 * Updates the service cache by calling scanServices.
 */
async function updateCache() {
  try {
    cachedServices = await scanServices();
  } catch (err) {
    console.error('Error scanning services:', err);
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>LocalHarbor</h1><p>Scanning for local services...</p>');
  } else if (req.method === 'GET' && req.url === '/api/services') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cachedServices));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Initialize background scanning
updateCache();
setInterval(updateCache, 5000);

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`LocalHarbor started on port ${PORT}`);
  console.log(`Local Network URL: http://${localIP}:${PORT}/`);
});