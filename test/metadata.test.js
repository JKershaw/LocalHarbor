const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('path');
const os = require('os');
const { spawn } = require('node:child_process');

/**
 * This test validates the metadata enrichment logic in LocalHarbor.
 * It simulates various project structures (Node, Python, README-based)
 * and asserts that the /api/services endpoint returns the expected 
 * name, description, stack, and color.
 */
test('Metadata Enrichment Integration', async (t) => {
  const TEST_PORT = '3005';
  const tmpDir = path.join(os.tmpdir(), `harbor-test-${Date.now()}`);
  
  // Create dummy project structures
  const nodeProject = path.join(tmpDir, 'my-web-app');
  const pythonProject = path.join(tmpDir, 'data-service');
  
  fs.mkdirSync(nodeProject, { recursive: true });
  fs.mkdirSync(pythonProject, { recursive: true });

  // 1. Node Project with React
  fs.writeFileSync(path.join(nodeProject, 'package.json'), JSON.stringify({
    name: 'react-dashboard',
    description: 'A React dashboard project',
    dependencies: { 'react': '^18.2.0' }
  }));

  // 2. Python Project with README
  fs.writeFileSync(path.join(pythonProject, 'README.md'), '# Python API\n\nHigh performance data service.');
  fs.writeFileSync(path.join(pythonProject, 'requirements.txt'), 'fastapi\nuvicorn');

  // Start dummy listeners
  // We use separate node processes to simulate different CWDs
  const dummy1 = spawn('node', ['-e', 'require("http").createServer((req, res) => res.end()).listen(4001)'], { cwd: nodeProject });
  const dummy2 = spawn('node', ['-e', 'require("http").createServer((req, res) => res.end()).listen(4002)'], { cwd: pythonProject });

  t.after(() => {
    dummy1.kill();
    dummy2.kill();
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  // Start LocalHarbor server
  const serverProcess = spawn('node', ['index.js', TEST_PORT]);
  t.after(() => serverProcess.kill());

  // Wait for everything to spin up and lsof to be able to catch them
  await new Promise(resolve => setTimeout(resolve, 2000));

  const fetchServices = async () => {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${TEST_PORT}/api/services`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  };

  const services = await fetchServices();

  await t.test('Enriches Node.js/React project metadata', () => {
    const s = services.find(svc => svc.port === 4001);
    assert.ok(s, 'Service on 4001 should be detected');
    assert.strictEqual(s.name, 'react-dashboard');
    assert.strictEqual(s.description, 'A React dashboard project');
    assert.strictEqual(s.stack, 'React');
    assert.strictEqual(s.color, '#61dafb');
    assert.strictEqual(s.cwd, nodeProject);
  });

  await t.test('Enriches Python project metadata via README and requirements', () => {
    const s = services.find(svc => svc.port === 4002);
    assert.ok(s, 'Service on 4002 should be detected');
    assert.strictEqual(s.name, 'Python API');
    assert.strictEqual(s.description, 'High performance data service.');
    assert.strictEqual(s.stack, 'Python');
    assert.strictEqual(s.color, '#3776ab');
    assert.strictEqual(s.cwd, pythonProject);
  });

  await t.test('Handles unknown directories with HSL color fallback', () => {
    // Port 3005 itself is LocalHarbor
    const s = services.find(svc => svc.port === parseInt(TEST_PORT));
    if (s) {
      assert.ok(s.stack === 'Node.js' || s.stack === 'Unknown');
      if (s.stack === 'Unknown') {
        assert.match(s.color, /hsl\(\d+, 70%, 60%\)/);
      }
    }
  });
});