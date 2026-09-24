/**
 * Tests for the browser script the local ECC2 control pane serves.
 */

const assert = require('assert');
const path = require('path');
const vm = require('vm');

const { buildControlPaneSnapshot } = require('../../scripts/lib/control-pane/state');
const { renderControlPaneHtml } = require('../../scripts/lib/control-pane/ui');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function inlineScript(html) {
  const start = html.indexOf('<script>') + '<script>'.length;
  return html.slice(start, html.lastIndexOf('</script>'));
}

// Runs the page script against a stand-in for the few browser APIs it uses:
// elements looked up by selector, fetch, and a setInterval whose callback the
// test fires itself.
function openPage(snapshot) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        hidden: selector === '#app',
        textContent: '',
        innerHTML: '',
        value: '',
        dataset: {},
        addEventListener() {}
      });
    }
    return elements.get(selector);
  };
  const page = { online: true, refresh: null, element };
  vm.runInNewContext(inlineScript(renderControlPaneHtml()), {
    document: { hidden: false, querySelector: element, querySelectorAll: () => [] },
    window: { location: { href: 'http://127.0.0.1:8765/' } },
    URL,
    Intl,
    console,
    fetch: async () => {
      if (!page.online) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, statusText: 'OK', json: async () => snapshot };
    },
    setInterval: callback => {
      page.refresh = callback;
    }
  });
  return page;
}

const settle = () => new Promise(resolve => setImmediate(resolve));

async function runTests() {
  console.log('\n=== Testing control-pane UI ===\n');

  let passed = 0;
  let failed = 0;

  const snapshot = JSON.parse(
    JSON.stringify(
      await buildControlPaneSnapshot({
        dbPath: path.join(__dirname, 'no-such-ecc2.db'),
        repoRoot: path.join(__dirname, '..', '..'),
        query: ''
      })
    )
  );

  if (
    await test('a failed live refresh is reported, and cleared by the next one that succeeds', async () => {
      const page = openPage(snapshot);
      await settle();
      assert.strictEqual(page.element('#app').hidden, true, 'the first load succeeds');

      page.online = false;
      page.refresh();
      await settle();
      const box = page.element('#app');
      assert.strictEqual(box.hidden, false, 'the failure is shown');
      assert.match(box.textContent, /Live refresh failed\. The data below is from /);
      assert.match(box.textContent, /Failed to fetch/);

      page.online = true;
      page.refresh();
      await settle();
      assert.strictEqual(page.element('#app').hidden, true, 'a successful refresh clears it');
    })
  )
    passed++;
  else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
