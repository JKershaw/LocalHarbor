const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

test('Dashboard UI Requirements', async (t) => {
  const PORT = '3007';
  
  // Start the server
  const serverProcess = spawn('node', ['index.js', PORT], {
    env: { ...process.env },
    stdio: 'pipe'
  });

  // Cleanup on exit
  t.after(() => serverProcess.kill());

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  await t.test('GET / returns the full dashboard HTML with specific requirements', async () => {
    const response = await new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${PORT}/`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      req.on('error', reject);
    });

    assert.strictEqual(response.status, 200);
    assert.match(response.headers['content-type'], /text\/html/);

    // 1. Dark Theme Requirement
    assert.ok(response.body.includes('#0a0a0f'), 'Should contain the dark background color #0a0a0f');

    // 2. Hostname and Network URL Requirements
    const hostname = os.hostname();
    assert.ok(response.body.includes(hostname), `Should display hostname: ${hostname}`);
    // Check for the presence of the port in the instructions area
    assert.ok(response.body.includes(PORT), 'Should display the current port number');

    // 3. Grid Layout Requirements
    assert.ok(response.body.includes('display: grid'), 'Should contain CSS grid layout');
    assert.ok(response.body.includes('minmax(280px, 1fr)'), 'Should use the specified grid card constraints');

    // 4. Animation and UI State
    assert.match(response.body, /pulse|pulsing/, 'Should have a pulsing animation defined for empty state');

    // 5. Client-Side Script Requirements
    assert.ok(response.body.includes('/api/services'), 'Script should fetch from /api/services');
    assert.ok(response.body.includes('5000'), 'Should poll every 5000ms (5 seconds)');
    assert.ok(response.body.includes('JSON.stringify'), 'Should use JSON.stringify for data comparison');
    
    // 6. Card interaction requirements
    assert.ok(response.body.includes('target="_blank"'), 'Service cards should open in a new tab');
    assert.ok(response.body.includes('translateY'), 'Should have hover effect using translateY');
  });

  await t.test('index.js contains generateHTML function', async () => {
    const indexPath = path.join(__dirname, '../index.js');
    const content = fs.readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('function generateHTML'), 'index.js must define generateHTML function');
    assert.ok(content.includes('generateHTML()'), 'index.js must call generateHTML function in the route handler');
  });
});