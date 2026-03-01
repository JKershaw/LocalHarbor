const http = require('http');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

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
    return services;
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