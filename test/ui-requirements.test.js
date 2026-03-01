const assert = require('assert');
const { server } = require('../index');

/**
 * Tests UI-related technical requirements:
 * - Dark background #0a0a0f
 * - Generated initial letter for icons
 * - Empty state animation presence
 */

try {
  console.log('Running UI Requirements tests...');

  // We check the HTML template directly as it is exported/available via the server's response
  // For this test, we simulate calling the dashboard route
  const http = require('http');
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    http.get(`http://127.0.0.1:${address.port}/`, (res) => {
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        // 1. Dark Background
        assert.ok(html.includes('#0a0a0f'), 'CSS should include the specified dark background color');

        // 2. Hover Glow (Implementation check)
        // Spec: "Subtle hover state (lift + glow)"
        assert.ok(html.includes('box-shadow') && html.includes(':hover'), 'Should have glow effect (box-shadow) on hover');

        // 3. Empty State Animation
        // Spec: "Empty state: a message and a subtle animation"
        // FAIL EXPECTED: current index.js only has static text
        assert.ok(html.includes('@keyframes') || html.includes('animation:'), 'Empty state should contain an animation');

        server.close();
        console.log('✅ UI Requirements tests passed!');
      });
    });
  });

} catch (err) {
  console.error('❌ UI Requirements tests failed:');
  console.error(err);
  process.exit(1);
}