const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

test('LocalHarbor Server Functional Requirements', async (t) => {
  const PORT = '3001';
  
  // Start the server process
  const serverProcess = spawn('node', ['index.js', PORT], {
    env: { ...process.env }
  });

  // Helper to kill server on test completion
  t.after(() => serverProcess.kill());

  // Wait for server to start up
  await new Promise(resolve => setTimeout(resolve, 1500));

  await t.test('GET / returns HTML content', async () => {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${PORT}/`, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.match(res.headers['content-type'], /text\/html/);
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          assert.ok(data.length > 0, 'Response should not be empty');
          resolve();
        });
      }).on('error', reject);
    });
  });

  await t.test('GET /api/services returns JSON array', async () => {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${PORT}/api/services`, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.match(res.headers['content-type'], /application\/json/);
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const json = JSON.parse(data);
          assert.ok(Array.isArray(json), 'Result should be an array');
          resolve();
        });
      }).on('error', reject);
    });
  });

  await t.test('Invalid route returns 404', async () => {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${PORT}/invalid-path-xyz`, (res) => {
        assert.strictEqual(res.statusCode, 404);
        resolve();
      }).on('error', reject);
    });
  });
});

test('index.js Source Code Requirements', async (t) => {
  const indexPath = path.join(process.cwd(), 'index.js');
  const content = fs.readFileSync(indexPath, 'utf8');

  await t.test('Uses only built-in modules', () => {
    const requireCalls = content.match(/require\(['"](.+?)['"]\)/g) || [];
    const modules = requireCalls.map(m => m.match(/['"](.+?)['"]/)[1]);
    const allowed = ['http', 'os', 'path', 'node:http', 'node:os', 'node:path'];
    
    modules.forEach(mod => {
      assert.ok(allowed.includes(mod), `Forbidden dependency found: ${mod}`);
    });
  });

  await t.test('Defines required functions and logic', () => {
    assert.ok(content.includes('getLocalIP'), 'Should define getLocalIP');
    assert.ok(content.includes('scanServices'), 'Should define scanServices');
    assert.ok(content.includes('cachedServices'), 'Should define cachedServices');
    assert.ok(content.includes('setInterval'), 'Should implement scanning interval');
    assert.ok(content.includes('5000'), 'Interval should be 5000ms');
  });

  await t.test('Port logic follows priority', () => {
    assert.ok(content.includes('process.env.PORT'), 'Should check process.env.PORT');
    assert.ok(content.includes('process.argv'), 'Should check process.argv');
    assert.ok(content.includes('2999'), 'Should default to 2999');
  });
});