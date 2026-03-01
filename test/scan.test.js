const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

/**
 * This test validates the scanServices() implementation by spawning the 
 * LocalHarbor server and checking its /services endpoint after 
 * creating dummy TCP listeners.
 */
test('scanServices() Functional Requirements', async (t) => {
  const TEST_PORT = '3005';
  const DUMMY_WEB_PORT = 4000;
  const NR_PORT = 5432; // Postgres (should be filtered)
  const SYSTEM_PORT = 80; // Should be filtered (< 1024)

  // 1. Setup a dummy service that should be detected
  const dummyService = net.createServer();
  await new Promise(resolve => dummyService.listen(DUMMY_WEB_PORT, '127.0.0.1', resolve));

  // 2. Start the LocalHarbor server process
  // We pass TEST_PORT so the app knows its own port to filter it out.
  const serverProcess = spawn('node', ['index.js', TEST_PORT], {
    env: { ...process.env, PORT: TEST_PORT }
  });

  // Cleanup: kill server and close dummy socket
  t.after(() => {
    dummyService.close();
    serverProcess.kill();
  });

  // Wait for server to start and perform its initial scan (updateCache)
  // The app calls updateCache() immediately on start.
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Helper to fetch services from the running app's API
  const fetchServices = () => new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${TEST_PORT}/services`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse JSON response: ' + data));
        }
      });
    });
    req.on('error', reject);
  });

  await t.test('detects active web service with correct data types', async () => {
    const services = await fetchServices();
    const found = services.find(s => s.port === DUMMY_WEB_PORT);
    
    assert.ok(found, `Service on port ${DUMMY_WEB_PORT} not found in ${JSON.stringify(services)}`);
    assert.strictEqual(typeof found.port, 'number', 'Port should be a Number');
    assert.strictEqual(typeof found.pid, 'number', 'PID should be a Number');
    assert.strictEqual(typeof found.processName, 'string', 'processName should be a String');
    assert.ok(found.port === DUMMY_WEB_PORT);
  });

  await t.test('filters out the application own port', async () => {
    const services = await fetchServices();
    const self = services.find(s => s.port === parseInt(TEST_PORT));
    assert.strictEqual(self, undefined, `App should filter out its own port (${TEST_PORT})`);
  });

  await t.test('filters out internal/system ports (< 1024)', async () => {
    const services = await fetchServices();
    const lowPort = services.find(s => s.port < 1024);
    assert.strictEqual(lowPort, undefined, 'Should not return ports below 1024');
  });

  await t.test('filters out known non-web ports', async () => {
    const services = await fetchServices();
    const forbiddenPorts = [5432, 3306, 6379, 27017];
    for (const p of forbiddenPorts) {
      const found = services.find(s => s.port === p);
      assert.strictEqual(found, undefined, `Should have filtered out port ${p}`);
    }
  });

  await t.test('deduplicates ports appearing in both IPv4 and IPv6', async () => {
    const services = await fetchServices();
    const ports = services.map(s => s.port);
    const uniquePorts = new Set(ports);
    assert.strictEqual(ports.length, uniquePorts.size, 'Service list contains duplicate ports');
  });
});