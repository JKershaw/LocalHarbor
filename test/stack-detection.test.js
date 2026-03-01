const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

/**
 * Helper to extract internal functions from index.js for testing.
 * Since the functions are not exported, we extract them from the source.
 */
function getInternalFunction(name) {
  const indexSource = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  const startIdx = indexSource.indexOf(`function ${name}`);
  if (startIdx === -1) throw new Error(`Function ${name} not found in index.js`);
  
  let braces = 0;
  let endIdx = -1;
  let started = false;
  for (let i = startIdx; i < indexSource.length; i++) {
    if (indexSource[i] === '{') { braces++; started = true; }
    else if (indexSource[i] === '}') { braces--; }
    if (started && braces === 0) {
      endIdx = i + 1;
      break;
    }
  }
  const fnStr = indexSource.slice(startIdx, endIdx);
  
  // Create a function constructor that injects necessary dependencies
  return new Function('fs', 'path', 'execSync', `return (${fnStr})`)(
    require('node:fs'),
    require('node:path'),
    require('node:child_process').execSync
  );
}

test('getCwd(pid) functionality', async (t) => {
  const getCwd = getInternalFunction('getCwd');
  
  await t.test('returns current directory for own process', () => {
    const result = getCwd(process.pid);
    assert.strictEqual(typeof result, 'string');
    // Normalize paths for cross-platform comparison
    assert.strictEqual(path.resolve(result), path.resolve(process.cwd()));
  });

  await t.test('returns null for invalid pid', () => {
    const result = getCwd(999999);
    assert.strictEqual(result, null);
  });
});

test('detectStack(cwd, port) functionality', async (t) => {
  const detectStack = getInternalFunction('detectStack');
  const tmpBase = path.join(os.tmpdir(), 'harbor-tests-');

  await t.test('detects Next.js from package.json', () => {
    const dir = fs.mkdtempSync(tmpBase);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'next': '^14.0.0' }
    }));
    const result = detectStack(dir, 3000);
    assert.strictEqual(result.stack, 'Next.js');
    assert.strictEqual(result.color, '#000');
    fs.rmSync(dir, { recursive: true });
  });

  await t.test('detects Django from manage.py', () => {
    const dir = fs.mkdtempSync(tmpBase);
    fs.writeFileSync(path.join(dir, 'manage.py'), '');
    const result = detectStack(dir, 8000);
    assert.strictEqual(result.stack, 'Django');
    assert.strictEqual(result.color, '#092e20');
    fs.rmSync(dir, { recursive: true });
  });

  await t.test('detects Rust from Cargo.toml', () => {
    const dir = fs.mkdtempSync(tmpBase);
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '');
    const result = detectStack(dir, 8080);
    assert.strictEqual(result.stack, 'Rust');
    assert.strictEqual(result.color, '#ce412b');
    fs.rmSync(dir, { recursive: true });
  });

  await t.test('returns Unknown with deterministic HSL color when no indicators found', () => {
    const dir = fs.mkdtempSync(tmpBase);
    const port = 5000;
    const result = detectStack(dir, port);
    assert.strictEqual(result.stack, 'Unknown');
    const expectedColor = 'hsl(' + ((port * 137) % 360) + ', 70%, 60%)';
    assert.strictEqual(result.color, expectedColor);
    fs.rmSync(dir, { recursive: true });
  });

  await t.test('returns Unknown when cwd is null', () => {
    const port = 1234;
    const result = detectStack(null, port);
    assert.strictEqual(result.stack, 'Unknown');
  });
});

test('fs requirement exists in index.js', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  assert.ok(indexSource.includes('const fs = require("fs");'), 'fs module should be required in index.js');
});