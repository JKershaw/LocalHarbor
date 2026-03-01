const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');

test('scanServices - schema enrichment integration', async (t) => {
  const PORT = '3002';
  
  // Start the server process
  const serverProcess = spawn('node', ['index.js', PORT], {
    env: { ...process.env }
  });

  t.after(() => serverProcess.kill());

  // Wait for server to start up
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Fetch the services from the API
  const getServices = () => new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}/api/services`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
  });

  const services = await getServices();
  
  assert(Array.isArray(services), 'API should return an array of services');
  
  // If there are running services on the test machine, verify their structure
  if (services.length > 0) {
    const s = services[0];
    const requiredKeys = ['port', 'pid', 'processName', 'cwd', 'name', 'description', 'stack', 'color'];
    
    for (const key of requiredKeys) {
      assert.ok(s.hasOwnProperty(key), `Service object missing key: ${key}`);
    }

    assert.strictEqual(typeof s.name, 'string', 'name should be a string');
    assert.strictEqual(typeof s.description, 'string', 'description should be a string');
    assert.strictEqual(typeof s.stack, 'string', 'stack should be a string');
    assert.strictEqual(typeof s.color, 'string', 'color should be a string');
  }
});