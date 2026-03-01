const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// We import the functions to test. index.js must export these.
const LocalHarbor = require('../index.js');

/**
 * TEST 1: lsof Output Parsing
 * Verifies that the raw string output from lsof is correctly transformed into structured data.
 */
try {
  console.log('Running Test 1: lsof parsing...');
  const mockLsofOutput = `
COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node     1234 user   12u  IPv6 0xdeadbeef      0t0  TCP *:3000 (LISTEN)
node     1234 user   13u  IPv4 0xdeadbeef      0t0  TCP *:3000 (LISTEN)
python   5678 user    5u  IPv4 0xdeadbeef      0t0  TCP *:8000 (LISTEN)
postgres  111 user    3u  IPv4 0xdeadbeef      0t0  TCP *:5432 (LISTEN)
  `.trim();

  // Expected logic: Filter out noise (postgres), deduplicate IPv4/v6 for same port
  const results = LocalHarbor.parseLsof(mockLsofOutput);
  
  assert.strictEqual(results.length, 2, 'Should find 2 dev services, excluding postgres');
  assert.ok(results.some(s => s.port === 3000 && s.pid === 1234), 'Should contain port 3000');
  assert.ok(results.some(s => s.port === 8000 && s.pid === 5678), 'Should contain port 8000');
  console.log('✅ Test 1 Passed');
} catch (e) {
  console.error('❌ Test 1 Failed:', e.message);
  process.exit(1);
}

/**
 * TEST 2: Metadata Enrichment (Filesystem)
 * Verifies that the app correctly reads project names from READMEs or config files.
 */
try {
  console.log('Running Test 2: Metadata enrichment...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-test-'));
  
  // Create a mock project structure
  fs.writeFileSync(path.join(tempDir, 'README.md'), '# Project Alpha\n\nThis is a test project description.');
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'ignored-name', dependencies: { 'next': '14.0.0' } }));

  // Logic: README header usually takes priority over package.json name if present
  const metadata = LocalHarbor.enrichFromCwd(tempDir, 3000, 'node');
  
  assert.strictEqual(metadata.name, 'Project Alpha');
  assert.strictEqual(metadata.description, 'This is a test project description.');
  assert.strictEqual(metadata.stack, 'next');
  
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('✅ Test 2 Passed');
} catch (e) {
  console.error('❌ Test 2 Failed:', e.message);
  process.exit(1);
}

/**
 * TEST 3: Fallback Naming
 * Verifies that if no files are found, it falls back to directory name or command.
 */
try {
  console.log('Running Test 3: Fallback naming...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'my-cool-app'));
  
  const metadata = LocalHarbor.enrichFromCwd(tempDir, 5173, 'node');
  
  // Should title-case the directory name
  assert.strictEqual(metadata.name, 'My Cool App');
  
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('✅ Test 3 Passed');
} catch (e) {
  console.error('❌ Test 3 Failed:', e.message);
  process.exit(1);
}