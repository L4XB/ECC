'use strict';

// A here-document opener at `index`, but not a here-string (<<<): `<<` or `<<-`, then the
// delimiter, a shell word whose quotes are removed (`<<'EOF'`, `<<E"OF"`, `<<EOF/END`, `<<123`,
// and `<<''`, whose body ends at the first empty line). Unless part of the word is quoted, Bash
// expands the body, so its command substitutions run.
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
      quoted = true;
    } else if (/[\s|&;()<>]/.test(ch)) {
      break;
    } else {
      delimiter += ch;
    }
  }
  if ((!delimiter && !quoted) || quote) return null;
  return { text: command.slice(index, i), delimiter, stripTabs, expands: !quoted };
}

// The index after the `)` that closes the `(` at `index`, or -1. Quoted parentheses and escaped
// characters do not count.
function endOfParens(command, index) {
  let depth = 0;
  let quote = null;
  for (let i = index; i < command.length; i++) {
    const ch = command[i];
    if (ch === '\\' && quote !== "'") i++;
    else if (quote) quote = ch === quote ? null : quote;
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

// The index after the `))` that closes the arithmetic `((` at `index`, or -1.
function endOfArithmetic(command, index) {
  const end = endOfParens(command, index);
  return end !== -1 && command[end - 2] === ')' ? end : -1;
}

// The commands of the `$(...)` and backquoted substitutions in an expanded here-document body.
// Bash runs them while it reads the body, where quotes are plain text and a backslash escapes.
function commandSubstitutions(body) {
  const commands = [];
  let i = 0;
  while (i < body.length) {
    const backquoted = body[i] === '`';
    if (body[i] === '\\') {
      i += 2;
    } else if (backquoted || (body[i] === '$' && body[i + 1] === '(')) {
      const end = backquoted ? body.indexOf('`', i + 1) + 1 : endOfParens(body, i + 1);
      if (end <= 0) break;
      commands.push(body.slice(backquoted ? i + 1 : i + 2, end - 1));
      i = end;
    } else {
      i++;
    }
  }
  return commands;
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

// The here-document bodies that start at `start`, one after the other: the index after them,
// and the commands that the expanded ones run through command substitution.
function readHeredocBodies(command, start, heredocs) {
  let end = start;
  const substitutions = [];
  for (const { delimiter, stripTabs, expands } of heredocs) {
    const bodyStart = end;
    let bodyEnd = command.length;
    while (end < command.length) {
      const newline = command.indexOf('\n', end);
      const lineEnd = newline === -1 ? command.length : newline;
      // A CRLF line ends in \r, which is not part of the delimiter.
      const line = command.slice(end, lineEnd).replace(/\r$/, '');
      const lineStart = end;
      end = lineEnd + 1;
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) {
        bodyEnd = lineStart;
        break;
      }
    }
    if (expands) substitutions.push(...commandSubstitutions(command.slice(bodyStart, bodyEnd)));
  }
  return { end: Math.min(end, command.length), substitutions };
}

// At the newline at `index` the command ends. The bodies of the here-documents opened on its
// line follow it. They are data, not commands, so they are left out of the segments, except for
// the commands that an expanded body runs. Returns the index after the bodies.
function endLine(command, index, current, heredocs, segments) {
  if (current.trim()) segments.push(current.trim());
  const { end, substitutions } = readHeredocBodies(command, index + 1, heredocs);
  for (const substitution of substitutions) segments.push(...splitShellSegments(substitution));
  return end;
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
