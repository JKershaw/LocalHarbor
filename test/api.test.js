const assert = require('assert');
const http = require('http');

describe('LocalHarbor API Specification', () => {
  const TEST_PORT = 3001;
  
  it('GET /api/services should return a JSON array', (done) => {
    http.get(`http://localhost:${TEST_PORT}/api/services`, (res) => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['content-type'], 'application/json');
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        assert(Array.isArray(json), 'Response should be an array');
        done();
      });
    }).on('error', (err) => {
      // If server isn't running, this test fails, which is expected for the plan
      done(err);
    });
  });

  it('Service object should contain name, port, description, and color', (done) => {
    http.get(`http://localhost:${TEST_PORT}/api/services`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const services = JSON.parse(data);
        if (services.length > 0) {
          const s = services[0];
          assert(s.name, 'Service should have a name');
          assert(s.port, 'Service should have a port');
          assert(s.color, 'Service should have a color');
          assert(typeof s.description === 'string', 'Service should have a description string');
        }
        done();
      });
    });
  });
});