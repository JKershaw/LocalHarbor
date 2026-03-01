const assert = require('node:assert');
const http = require('node:http');
const LocalHarbor = require('../index.js');

/**
 * TEST 4: API Response Structure
 * Verifies the /api/services route returns valid JSON and correct schema.
 */
try {
  console.log('Running Test 4: API structure...');
  
  // Start server on ephemeral port
  process.env.PORT = '0';
  const server = LocalHarbor.server;
  
  // We need to wait for the server to actually start listening
  if (!server.listening) {
    server.listen(0, '127.0.0.1');
  }

  // Use a timeout to wait for server address to be available
  setTimeout(() => {
    const port = server.address().port;
    http.get(`http://127.0.0.1:${port}/api/services`, (res) => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['content-type'], 'application/json');
      
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const data = JSON.parse(body);
        assert.ok(Array.isArray(data.services), 'Response should have a services array');
        assert.ok(typeof data.lastUpdated === 'number', 'Response should have a lastUpdated timestamp');
        
        server.close();
        console.log('✅ Test 4 Passed');
      });
    }).on('error', (err) => {
      console.error('❌ Test 4 Failed (Request Error):', err.message);
      process.exit(1);
    });
  }, 100);

} catch (e) {
  console.error('❌ Test 4 Failed:', e.message);
  process.exit(1);
}

/**
 * TEST 5: Network IP Utility
 * Verifies getLocalIP returns a valid non-internal IPv4.
 */
try {
  console.log('Running Test 5: getLocalIP...');
  const ip = LocalHarbor.getLocalIP();
  const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  
  assert.ok(ipv4Regex.test(ip), `Result "${ip}" should be a valid IPv4 address`);
  assert.notStrictEqual(ip, '127.0.0.1', 'Should return external/local IP, not just loopback');
  console.log('✅ Test 5 Passed');
} catch (e) {
  console.error('❌ Test 5 Failed:', e.message);
  process.exit(1);
}