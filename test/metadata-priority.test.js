const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { enrichMetadata } = require('../index');

/**
 * Tests the Metadata Enrichment priority chain:
 * 1. README.md (# Heading -> name, first paragraph -> description)
 * 2. package.json (name + description)
 * 3. pyproject.toml / Cargo.toml / go.mod (name + description)
 * 4. .git/config (remote URL -> repo name)
 * 5. Process argv (vite, manage.py, etc)
 * 6. Directory name (title-case)
 * 7. Fallback: Port
 */

const mockCwd = path.join(__dirname, 'mock-project');

function setupMockFiles(files) {
  if (!fs.existsSync(mockCwd)) fs.mkdirSync(mockCwd, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(mockCwd, name), content);
  }
}

function teardownMock() {
  if (fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
}

try {
  console.log('Running Metadata Priority tests...');

  // Test Case 1: README priority over package.json
  setupMockFiles({
    'README.md': '# High Priority Title\n\nThis is the winning description.',
    'package.json': JSON.stringify({ name: 'low-priority', description: 'ignored' })
  });
  
  let meta = enrichMetadata(12345, 3000, mockCwd);
  assert.strictEqual(meta.name, 'High Priority Title', 'README heading should win');
  assert.strictEqual(meta.description, 'This is the winning description.', 'README body should win');

  // Test Case 2: pyproject.toml / Cargo.toml support
  teardownMock();
  setupMockFiles({
    'Cargo.toml': '[package]\nname = "rust-service"\nversion = "0.1.0"'
  });
  meta = enrichMetadata(12345, 3000, mockCwd);
  // FAIL EXPECTED: Current index.js detects Cargo.toml for stack but doesn't extract name
  assert.strictEqual(meta.name, 'Rust Service', 'Should extract name from Cargo.toml');

  // Test Case 3: Git remote name extraction
  teardownMock();
  setupMockFiles({
    '.git/config': '[remote "origin"]\nurl = https://github.com/user/my-git-repo.git'
  });
  meta = enrichMetadata(12345, 3000, mockCwd);
  // FAIL EXPECTED: Missing .git/config logic
  assert.strictEqual(meta.name, 'My Git Repo', 'Should fallback to git repo name if no manifests found');

  console.log('✅ Metadata Priority tests passed!');
} catch (err) {
  console.error('❌ Metadata Priority tests failed:');
  console.error(err);
  process.exit(1);
} finally {
  teardownMock();
}