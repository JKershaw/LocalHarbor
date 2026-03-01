const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Assuming the functions will be exported for testing
const index = require('../index.js');

test('getProjectMeta - Priority 1: README.md', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-readme-'));
  fs.writeFileSync(path.join(tmp, 'README.md'), '# My Cool Project\n\nThis is a description of the project.');
  
  const meta = index.getProjectMeta(tmp, 3000);
  assert.strictEqual(meta.name, 'My Cool Project');
  assert.strictEqual(meta.description, 'This is a description of the project.');
  
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('getProjectMeta - Priority 2: package.json', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-pkg-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
    name: 'node-app',
    description: 'A node application'
  }));
  
  const meta = index.getProjectMeta(tmp, 3001);
  assert.strictEqual(meta.name, 'node-app');
  assert.strictEqual(meta.description, 'A node application');
  
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('getProjectMeta - Priority 3: pyproject.toml', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-py-'));
  fs.writeFileSync(path.join(tmp, 'pyproject.toml'), 'name = "python-service"\ndescription = "Python desc"');
  
  const meta = index.getProjectMeta(tmp, 3002);
  assert.strictEqual(meta.name, 'python-service');
  assert.strictEqual(meta.description, 'Python desc');
  
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('getProjectMeta - Priority 4: Cargo.toml', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-rs-'));
  fs.writeFileSync(path.join(tmp, 'Cargo.toml'), 'name = "rust-crate"\ndescription = "Rust desc"');
  
  const meta = index.getProjectMeta(tmp, 3003);
  assert.strictEqual(meta.name, 'rust-crate');
  assert.strictEqual(meta.description, 'Rust desc');
  
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('getProjectMeta - Priority 5: go.mod', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-go-'));
  fs.writeFileSync(path.join(tmp, 'go.mod'), 'module github.com/user/my-go-api');
  
  const meta = index.getProjectMeta(tmp, 3004);
  assert.strictEqual(meta.name, 'my-go-api');
  
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('getProjectMeta - Priority 6: .git/config', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-git-'));
  fs.mkdirSync(path.join(tmp, '.git'));
  fs.writeFileSync(path.join(tmp, '.git', 'config'), '[remote "origin"]\nurl = https://github.com/org/git-repo-name.git');
  
  const meta = index.getProjectMeta(tmp, 3005);
  assert.strictEqual(meta.name, 'git-repo-name');
  
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('getProjectMeta - Priority 7: Directory Name fallback with formatting', (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-naming-'));
  const projectDir = path.join(tmpBase, 'my-awesome_web-service');
  fs.mkdirSync(projectDir);
  
  const meta = index.getProjectMeta(projectDir, 3006);
  // Expected: My Awesome Web Service
  assert.strictEqual(meta.name, 'My Awesome Web Service');
  
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test('getProjectMeta - Priority 8: Port Fallback', (t) => {
  const meta = index.getProjectMeta('/non/existent/path/at/all', 9999);
  assert.strictEqual(meta.name, 'Port 9999');
  assert.strictEqual(meta.description, '');
});