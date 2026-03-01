const http = require('http');
const assert = require('assert');

/**
 * Validates the web server interface and API schema.
 */

const TEST_PORT = 3001;

async function testApiSchema() {
  console.log('Running Test: API Schema and UI Server...');
  
  const harbor = require('child_process').spawn('node', ['index.js', TEST_PORT]);
  
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        // Test 1: HTML Content
        const htmlRes = await fetch(`http://localhost:${TEST_PORT}/`);
        const html = await htmlRes.text();
        assert.strictEqual(htmlRes.status, 200);
        assert.ok(html.includes('<script>'), 'UI must contain service polling script');
        assert.ok(html.includes('/api/services'), 'UI must fetch from the correct API endpoint');

        // Test 2: JSON Schema
        const apiRes = await fetch(`http://localhost:${TEST_PORT}/api/services`);
        const services = await apiRes.json();
        assert.ok(Array.isArray(services), 'API must return an array');
        
        if (services.length > 0) {
          const s = services[0];
          const keys = Object.keys(s);
          assert.ok(keys.includes('port'), 'Service missing port');
          assert.ok(keys.includes('name'), 'Service missing name');
          assert.ok(keys.includes('description'), 'Service missing description');
          assert.ok(keys.includes('color'), 'Service missing color accent');
          assert.ok(keys.includes('pid'), 'Service missing PID');
        }

        console.log('  - API/UI endpoints responding as expected');
        harbor.kill();
        resolve();
      } catch (e) {
        harbor.kill();
        reject(e);
      }
    }, 2000);
  });
}

testApiSchema().catch(err => {
  console.error(err);
  process.exit(1);
});