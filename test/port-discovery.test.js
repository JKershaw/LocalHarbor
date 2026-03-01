const assert = require('assert');
const { parseLsof } = require('../index');

/**
 * Tests the Port Discovery logic against the specification:
 * - Use lsof -i -n -P -sTCP:LISTEN
 * - Parse carefully (non-fixed width columns)
 * - Handle IPv4 and IPv6
 * - Deduplicate ports
 * - Filter ports < 1024 and known non-web daemons
 */

const mockLsofOutput = `
COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      12345   user   10u  IPv4 0xdeadbeef      0t0  TCP *:3000 (LISTEN)
python    67890   user    4u  IPv6 0xdeadbeef      0t0  TCP *:8000 (LISTEN)
node      12345   user   11u  IPv6 0xdeadbeef      0t0  TCP *:3000 (LISTEN)
postgres    543   root    3u  IPv4 0xdeadbeef      0t0  TCP 127.0.0.1:5432 (LISTEN)
mysql       666   root    3u  IPv4 0xdeadbeef      0t0  TCP *:3306 (LISTEN)
systemd       1   root    5u  IPv4 0xdeadbeef      0t0  TCP *:80 (LISTEN)
`;

try {
  console.log('Running Port Discovery tests...');
  const discovered = parseLsof(mockLsofOutput);

  // 1. Deduplication (Port 3000 appears twice in mock)
  const port3000Count = discovered.filter(p => p.port === 3000).length;
  assert.strictEqual(port3000Count, 1, 'Port 3000 should be deduplicated (IPv4/IPv6)');

  // 2. Filtering system ports (< 1024)
  assert.ok(!discovered.find(p => p.port === 80), 'Should filter system port 80');

  // 3. Filtering known non-web daemons
  assert.ok(!discovered.find(p => p.port === 5432), 'Should filter postgres 5432');
  assert.ok(!discovered.find(p => p.port === 3306), 'Should filter mysql 3306');

  // 4. Correct discovery of dev ports
  assert.ok(discovered.find(p => p.port === 3000), 'Missing dev port 3000');
  assert.ok(discovered.find(p => p.port === 8000), 'Missing dev port 8000');

  console.log('✅ Port Discovery tests passed!');
} catch (err) {
  console.error('❌ Port Discovery tests failed:');
  console.error(err);
  process.exit(1);
}