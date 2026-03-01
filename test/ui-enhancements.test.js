const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');

/**
 * Helper to fetch content from the server
 */
function fetchRoot(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}/`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('UI Enhancements in generateHTML', async (t) => {
  const PORT = '3011';
  const serverProcess = spawn('node', ['index.js', PORT], {
    env: { ...process.env },
    stdio: 'pipe'
  });

  // Cleanup
  t.after(() => serverProcess.kill());

  // Wait for server boot
  await new Promise(resolve => setTimeout(resolve, 1500));

  const { body } = await fetchRoot(PORT);

  await t.test('CSS Class Definitions and Keyframes', () => {
    // Check for the new classes
    assert.match(body, /\.card\s+\.icon/i, 'Should define .card .icon');
    assert.match(body, /\.card\s+\.port/i, 'Should define .card .port');
    assert.match(body, /\.card:hover/i, 'Should define .card:hover');
    assert.match(body, /\.empty/i, 'Should define .empty');
    assert.match(body, /\.timestamp/i, 'Should define .timestamp');
    
    // Check icon dimensions
    assert.match(body, /width:\s*48px/i, 'Icon should be 48px wide');
    assert.match(body, /height:\s*48px/i, 'Icon should be 48px high');
    
    // Check animation
    assert.match(body, /@keyframes\s+pulse/i, 'Should define pulse keyframes');
  });

  await t.test('Header Requirements', () => {
    // Check for timestamp span
    assert.match(body, /id=['"]timestamp['"]/i, 'Header should have a timestamp span');
    
    // Check for network URL link (IP:PORT)
    const networkUrlPattern = new RegExp(`href=['"]http://[0-9.]+:3011['"]`, 'i');
    assert.match(body, networkUrlPattern, 'Header should contain a clickable network URL link');
  });

  await t.test('Client-side Script Logic', () => {
    // Check for JSON change detection
    assert.match(body, /let\s+lastJson\s*=\s*['"]{}/i, 'Script should initialize lastJson');
    assert.match(body, /if\s*\(lastJson\s*===\s*json\)\s*return/i, 'Script should check for changes before re-rendering');
    
    // Check for timestamp updating
    assert.match(body, /document\.getElementById\(['"]timestamp['"]\)\.textContent/i, 'Script should update timestamp text');
  });

  await t.test('Empty State UI', () => {
    assert.match(body, /id=['"]empty-state['"]/i, 'Should have an empty state container');
    assert.match(body, /No services detected yet/i, 'Should contain scanning message');
    assert.match(body, /class=['"]dot['"]/i, 'Should have a pulsing dot element');
  });

  await t.test('Card Template Structure', () => {
    // Check that the template literal inside the script uses the new features
    assert.match(body, /style=['"]--accent:\s*\${s\.color}/i, 'Card template should set --accent variable');
    assert.match(body, /s\.name\[0\]/i, 'Card template should use the first letter of the name');
    assert.match(body, /class=['"]icon['"]/i, 'Card template should include icon div');
    assert.match(body, /class=['"]port['"]/i, 'Card template should include port div');
  });
});