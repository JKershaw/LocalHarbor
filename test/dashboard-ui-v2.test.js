const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const os = require('os');

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

test('Dashboard UI Requirements', async (t) => {
  const PORT = '3009';
  
  // Start the server
  const serverProcess = spawn('node', ['index.js', PORT], {
    env: { ...process.env },
    stdio: 'pipe'
  });

  // Cleanup on exit
  t.after(() => serverProcess.kill());

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  await t.test('Server serves the new HTML dashboard on /', async () => {
    const { body, headers } = await fetchRoot(PORT);
    
    // Check content type
    assert.match(headers['content-type'], /text\/html/);

    // Check DOCTYPE
    assert.ok(body.includes('<!DOCTYPE html>'), 'Should return a full HTML5 document');
    
    // Check Dark Theme (Requirement: #0a0a0f)
    assert.ok(body.includes('#0a0a0f'), 'Should contain the dark theme hex code #0a0a0f');
    
    // Check for required UI elements
    assert.ok(body.includes('id="grid"') || body.includes("id='grid'"), 'Should contain a div with id="grid"');
    
    // Check for Server Metadata
    const hostname = os.hostname();
    assert.ok(body.includes(hostname), `Dashboard should display hostname: ${hostname}`);
    // Check if it includes the PORT (as a string in the HTML)
    assert.ok(body.includes(PORT), `Dashboard should display port: ${PORT}`);
  });

  await t.test('HTML contains script to fetch data every 5 seconds', async () => {
    const { body } = await fetchRoot(PORT);

    // Check for API fetch endpoint
    assert.ok(body.includes('/api/services'), 'Should contain a script fetching /api/services');
    
    // Check for 5-second interval (5000ms)
    assert.ok(body.includes('5000'), 'Should contain setInterval (or similar) with 5000ms delay');
    
    // Verify script exists
    assert.ok(body.match(/<script[\s\S]*?>[\s\S]*?<\/script>/), 'Should contain actual script logic');
  });

  await t.test('Response includes the result of generateHTML()', async () => {
    const { body } = await fetchRoot(PORT);
    
    // The old string should no longer be the entire response
    const oldString = '<h1>LocalHarbor</h1><p>Scanning for local services...</p>';
    assert.notStrictEqual(body.trim(), oldString);
    
    // Should have basic HTML structure now
    assert.ok(body.toLowerCase().includes('<body'), 'Should contain a body tag');
    assert.ok(body.toLowerCase().includes('<head'), 'Should contain a head tag');
  });
});