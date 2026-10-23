'use strict';

// `<<WORD`, `<<-WORD`, `<<'WORD'` or `<<"WORD"`. A delimiter starts with a letter or an
// underscore, so a shift such as `$((x << 2))` is not read as a here-document.
const HEREDOC_RE = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([A-Za-z_][\w.-]*))/;

// A here-document opener at `index`, but not a here-string (<<<).
function heredocAt(command, index) {
  if (command[index - 1] === '<' || command[index + 2] === '<') return null;
  const match = HEREDOC_RE.exec(command.slice(index));
  return match && { text: match[0], delimiter: match[2] ?? match[3] ?? match[4], stripTabs: match[1] === '-' };
}

// The index after the `))` that closes the arithmetic `((` at `index`, or -1.
function endOfArithmetic(command, index) {
  let depth = 0;
  for (let i = index; i < command.length; i++) {
    if (command[i] === '(') depth++;
    else if (command[i] === ')' && --depth === 0) return command[i - 1] === ')' ? i + 1 : -1;
  }
  return -1;
}

// The end of a span copied as is, or -1: a comment, which runs to the end of its line, or an
// arithmetic expression such as $((x << n)), whose `<<` is a shift and `&&` an operator.
function literalSpanEnd(command, index, atWordStart) {
  if (command[index] === '#' && atWordStart) {
    const newline = command.indexOf('\n', index);
    return newline === -1 ? command.length : newline;
  }
  return command[index] === '(' && command[index + 1] === '(' ? endOfArithmetic(command, index) : -1;
}

// The end of the here-document bodies that start at `start`, one after the other.
function endOfHeredocBodies(command, start, heredocs) {
  let end = start;
  for (const { delimiter, stripTabs } of heredocs) {
    while (end < command.length) {
      const newline = command.indexOf('\n', end);
      const lineEnd = newline === -1 ? command.length : newline;
      // A CRLF line ends in \r, which is not part of the delimiter.
      const line = command.slice(end, lineEnd).replace(/\r$/, '');
      end = lineEnd + 1;
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break;
    }
  }
  return Math.min(end, command.length);
}

/**
 * Split a shell command into segments by operators (&&, ||, ;, &) and by
 * newlines, while respecting quoting (single/double) and escaped characters.
 * Redirection operators (&>, >&, 2>&1) are NOT treated as separators, and the
 * body of a here-document stays in the segment of the command that reads it.
 */
function splitShellSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  // Here-documents opened on the current line, read after its newline.
  let heredocs = [];

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    // Inside quotes: handle escapes and closing quote
    if (quote) {
      if (ch === '\\' && i + 1 < command.length) {
        current += ch + command[i + 1];
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }

    // Backslash escape outside quotes
    if (ch === '\\' && i + 1 < command.length) {
      current += ch + command[i + 1];
      i++;
      continue;
    }

    // Opening quote
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    const next = command[i + 1] || '';
    const prev = i > 0 ? command[i - 1] : '';

    const spanEnd = literalSpanEnd(command, i, current === '' || /[\s;&|(]/.test(prev));
    if (spanEnd !== -1) {
      current += command.slice(i, spanEnd);
      i = spanEnd - 1;
      continue;
    }

    const heredoc = ch === '<' && next === '<' ? heredocAt(command, i) : null;
    if (heredoc) {
      heredocs.push(heredoc);
      current += heredoc.text;
      i += heredoc.text.length - 1;
      continue;
    }

    // A newline ends a command, after the bodies of the here-documents opened on its line
    if (ch === '\n') {
      const end = endOfHeredocBodies(command, i + 1, heredocs);
      current += command.slice(i, end);
      i = end - 1;
      heredocs = [];
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }

    // && operator
    if (ch === '&' && next === '&') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i++;
      continue;
    }

    // || operator
    if (ch === '|' && next === '|') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i++;
      continue;
    }

    // ; separator
    if (ch === ';') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }

    // Single & — but skip redirection patterns (&>, >&, digit>&)
    if (ch === '&' && next !== '&') {
      if (next === '>' || prev === '>') {
        current += ch;
        continue;
      }
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

module.exports = { splitShellSegments };
