// A small JavaScript syntax colourer. Reads text, builds DOM nodes (never HTML), so hostile file contents cannot inject markup.
const RE = new RegExp([
  '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))',                                              // 1 comment
  '(\'(?:\\\\.|[^\'\\\\\\n])*\'?|"(?:\\\\.|[^"\\\\\\n])*"?|`(?:\\\\[\\s\\S]|[^`\\\\])*`?)',      // 2 string
  '(\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)',                              // 3 number
  '(\\b(?:export|default|function|const|let|var|return|if|else|for|while|of|in|new|class|extends|import|from|async|await|try|catch|finally|throw|switch|case|break|continue|typeof|instanceof|this|null|undefined|true|false|void|yield|delete)\\b)', // 4 keyword
  '(\\bctx(?:\\.[A-Za-z_$][\\w$]*)+)',                                                        // 5 game API
  '([A-Za-z_$][\\w$]*)(?=\\s*\\()',                                                           // 6 call
  '([\\s\\S])',                                                                               // 7 anything else
].join('|'), 'gy');
const CLASS = [null, 'tk-c', 'tk-s', 'tk-n', 'tk-k', 'tk-a', 'tk-f', null];

export function tokenize(text) {
  const out = [];
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(text)) !== null) {
    let g = 1; while (g < 8 && m[g] === undefined) g++;
    const cls = CLASS[g] ?? null;
    const last = out[out.length - 1];
    if (last && last[0] === cls && cls === null) last[1] += m[0]; else out.push([cls, m[0]]);
    if (RE.lastIndex >= text.length) break;
  }
  return out;
}

export function highlight(text, { maxLines = 5000 } = {}) {
  const frag = document.createDocumentFragment();
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const mk = () => { const d = document.createElement('span'); d.className = 'l'; frag.append(d); return d; };
  if (lines.length > maxLines) { for (const ln of lines) mk().textContent = ln; return frag; }
  let cur = mk();
  for (const [cls, tok] of tokenize(lines.join('\n'))) {
    const parts = tok.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) cur = mk();
      if (!part) return;
      if (cls) { const s = document.createElement('span'); s.className = cls; s.textContent = part; cur.append(s); } else cur.append(document.createTextNode(part));
    });
  }
  return frag;
}
