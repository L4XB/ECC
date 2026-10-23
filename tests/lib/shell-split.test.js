'use strict';
const assert = require('assert');
const { splitShellSegments } = require('../../scripts/lib/shell-split');

console.log('=== Testing shell-split.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}: ${e.message}`);
    failed++;
  }
}

// Basic operators
console.log('Basic operators:');
test('&& splits into two segments', () => {
  assert.deepStrictEqual(splitShellSegments('echo hi && echo bye'), ['echo hi', 'echo bye']);
});
test('|| splits into two segments', () => {
  assert.deepStrictEqual(splitShellSegments('echo hi || echo bye'), ['echo hi', 'echo bye']);
});
test('; splits into two segments', () => {
  assert.deepStrictEqual(splitShellSegments('echo hi; echo bye'), ['echo hi', 'echo bye']);
});
test('single & splits (background)', () => {
  assert.deepStrictEqual(splitShellSegments('sleep 1 & echo hi'), ['sleep 1', 'echo hi']);
});

// Redirection operators should NOT split
console.log('\nRedirection operators (should NOT split):');
test('2>&1 stays as one segment', () => {
  const segs = splitShellSegments('cmd 2>&1 | grep error');
  assert.strictEqual(segs.length, 1);
});
test('&> stays as one segment', () => {
  const segs = splitShellSegments('cmd &> /dev/null');
  assert.strictEqual(segs.length, 1);
});
test('>& stays as one segment', () => {
  const segs = splitShellSegments('cmd >& /dev/null');
  assert.strictEqual(segs.length, 1);
});

// Quoting
console.log('\nQuoting:');
test('double-quoted && not split', () => {
  const segs = splitShellSegments('tmux new -d "cd /app && echo hi"');
  assert.strictEqual(segs.length, 1);
});
test('single-quoted && not split', () => {
  const segs = splitShellSegments("tmux new -d 'cd /app && echo hi'");
  assert.strictEqual(segs.length, 1);
});
test('double-quoted ; not split', () => {
  const segs = splitShellSegments('echo "hello; world"');
  assert.strictEqual(segs.length, 1);
});

// Escaped quotes
console.log('\nEscaped quotes:');
test('escaped double quote inside double quotes', () => {
  const segs = splitShellSegments('echo "hello \\"world\\"" && echo bye');
  assert.strictEqual(segs.length, 2);
});
test('escaped single quote inside single quotes', () => {
  const segs = splitShellSegments("echo 'hello \\'world\\'' && echo bye");
  assert.strictEqual(segs.length, 2);
});

// Escaped operators outside quotes
console.log('\nEscaped operators outside quotes:');
test('escaped && outside quotes not split', () => {
  const segs = splitShellSegments('tmux new-session -d bash -lc cd /app \\&\\& npm run dev');
  assert.strictEqual(segs.length, 1);
});
test('escaped ; outside quotes not split', () => {
  const segs = splitShellSegments('echo hello \\; echo bye');
  assert.strictEqual(segs.length, 1);
});

// Complex real-world cases
console.log('\nReal-world cases:');
test('tmux new-session with quoted compound command', () => {
  const segs = splitShellSegments('tmux new-session -d -s dev "cd /app && npm run dev"');
  assert.strictEqual(segs.length, 1);
  assert.ok(segs[0].includes('tmux'));
  assert.ok(segs[0].includes('npm run dev'));
});
test('chained: tmux ls then bare dev', () => {
  const segs = splitShellSegments('tmux ls; npm run dev');
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[1], 'npm run dev');
});
test('background dev server', () => {
  const segs = splitShellSegments('npm run dev & echo started');
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0], 'npm run dev');
});
test('empty string returns empty array', () => {
  assert.deepStrictEqual(splitShellSegments(''), []);
});
test('single command no operators', () => {
  assert.deepStrictEqual(splitShellSegments('npm run dev'), ['npm run dev']);
});

// Newlines and here-documents
console.log('\nNewlines and here-documents:');
test('a newline splits into two segments', () => {
  assert.deepStrictEqual(splitShellSegments('cd app\nnpm run dev'), ['cd app', 'npm run dev']);
  assert.deepStrictEqual(splitShellSegments('a && b\n\nc'), ['a', 'b', 'c']);
});
test('an escaped or quoted newline does not split', () => {
  assert.deepStrictEqual(splitShellSegments('npm run \\\ndev'), ['npm run \\\ndev']);
  assert.deepStrictEqual(splitShellSegments('echo "a\nb"'), ['echo "a\nb"']);
});
test('a here-document body is data, left out of the segments', () => {
  assert.deepStrictEqual(splitShellSegments('cat <<EOF > notes.md\na && b\nnpm run dev\nEOF\nls'), ['cat <<EOF > notes.md', 'ls']);
  assert.deepStrictEqual(splitShellSegments("cat <<-'END'\n\tnpm run dev\n\tEND\nls"), ["cat <<-'END'", 'ls']);
  assert.deepStrictEqual(splitShellSegments('cat <<A <<B\na\nA\nb\nB\nnext'), ['cat <<A <<B', 'next']);
});
test('a here-string or a shift is not a here-document', () => {
  assert.deepStrictEqual(splitShellSegments('cat <<< x && y'), ['cat <<< x', 'y']);
  assert.deepStrictEqual(splitShellSegments('echo $((x << 2))\nnext'), ['echo $((x << 2))', 'next']);
  assert.deepStrictEqual(splitShellSegments('echo $((x << n))\nnpm run dev'), ['echo $((x << n))', 'npm run dev']);
  assert.deepStrictEqual(splitShellSegments('(( n << 2 )) && npm run dev'), ['(( n << 2 ))', 'npm run dev']);
});
test('a << in a comment is not a here-document, and a comment is not split', () => {
  assert.deepStrictEqual(splitShellSegments('echo ok # <<EOF\nnpm run dev'), ['echo ok # <<EOF', 'npm run dev']);
  assert.deepStrictEqual(splitShellSegments('echo hi # a && b'), ['echo hi # a && b']);
  assert.deepStrictEqual(splitShellSegments('echo a#b ${#x} && c'), ['echo a#b ${#x}', 'c']);
});
test('a here-document delimiter is a shell word, read without its quotes', () => {
  assert.deepStrictEqual(splitShellSegments('cat <<EOF/END\nnpm run dev\nEOF/END\nls'), ['cat <<EOF/END', 'ls']);
  assert.deepStrictEqual(splitShellSegments('cat <<E"OF"\nnpm run dev\nEOF\nls'), ['cat <<E"OF"', 'ls']);
  assert.deepStrictEqual(splitShellSegments('cat <<123\nnpm run dev\n123\nls'), ['cat <<123', 'ls']);
  assert.deepStrictEqual(splitShellSegments("cat <<$'EOF'\ntext\nEOF\nnpm run dev"), ["cat <<$'EOF'", 'npm run dev']);
  // An empty delimiter ends the body at the first empty line
  assert.deepStrictEqual(splitShellSegments("cat <<''\nnpm run dev\n\nls"), ["cat <<''", 'ls']);
});
test('an expanded here-document body exposes the commands its substitutions run', () => {
  // Quotes are plain text in the body, so Bash still runs the substitution
  assert.deepStrictEqual(splitShellSegments("npm --version <<EOF\n'$(npm run dev)'\nEOF"), ['npm --version <<EOF', 'npm run dev']);
  assert.deepStrictEqual(splitShellSegments('cat <<EOF\n`npm run dev`\nEOF'), ['cat <<EOF', 'npm run dev']);
  assert.deepStrictEqual(splitShellSegments('cat <<EOF\nStarted: ${x:-$(npm run dev)}\nEOF'), ['cat <<EOF', 'npm run dev']);
  // An escaped substitution, or a body whose delimiter is quoted, is not expanded
  assert.deepStrictEqual(splitShellSegments('cat <<EOF\n\\$(npm run dev)\nEOF'), ['cat <<EOF']);
  assert.deepStrictEqual(splitShellSegments("cat <<'EOF'\n$(npm run dev)\nEOF"), ["cat <<'EOF'"]);
  assert.deepStrictEqual(splitShellSegments('cat <<\\EOF\n$(npm run dev)\nEOF'), ['cat <<\\EOF']);
});
test('a here-document body after an operator is left out too', () => {
  assert.deepStrictEqual(splitShellSegments('cat <<EOF &&\nnpm run dev\nEOF\necho done'), ['cat <<EOF', 'echo done']);
  assert.deepStrictEqual(splitShellSegments('npm --version <<EOF && cat\nnpm run dev\nEOF'), ['npm --version <<EOF', 'cat']);
});
test('a here-document delimiter on a CRLF line still ends the body', () => {
  assert.deepStrictEqual(splitShellSegments('cat <<EOF\r\ntext\r\nEOF\r\nnpm run dev'), ['cat <<EOF', 'npm run dev']);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
