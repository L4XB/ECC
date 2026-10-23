'use strict';

// A here-document opener at `index`, but not a here-string (<<<): `<<` or `<<-`, then the
// delimiter, a shell word whose quotes are removed (`<<'EOF'`, `<<E"OF"`, `<<EOF/END`, `<<123`,
// and `<<''`, whose body ends at the first empty line).
function heredocAt(command, index) {
  if (command[index - 1] === '<' || command[index + 2] === '<') return null;
  let i = index + 2;
  const stripTabs = command[i] === '-';
  if (stripTabs) i++;
  while (command[i] === ' ' || command[i] === '\t') i++;
  let delimiter = '';
  let quote = null;
  let quoted = false;
  for (; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else delimiter += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
    } else if (ch === '\\' && i + 1 < command.length) {
      delimiter += command[++i];
    } else if (/[\s|&;()<>]/.test(ch)) {
      break;
    } else {
      delimiter += ch;
    }
  }
  return (delimiter || quoted) && !quote ? { text: command.slice(index, i), delimiter, stripTabs } : null;
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

// At the newline at `index` the command ends. The bodies of the here-documents opened on its
// line follow it. They are data, not commands, so they are left out of the segments. Returns the
// index after the bodies.
function endLine(command, index, current, heredocs, segments) {
  if (current.trim()) segments.push(current.trim());
  return endOfHeredocBodies(command, index + 1, heredocs);
}

/**
 * Split a shell command into segments by operators (&&, ||, ;, &) and by
 * newlines, while respecting quoting (single/double) and escaped characters.
 * Redirection operators (&>, >&, 2>&1) are NOT treated as separators, and the
 * body of a here-document, which is data, is left out of the segments.
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
      i = endLine(command, i, current, heredocs, segments) - 1;
      heredocs = [];
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
