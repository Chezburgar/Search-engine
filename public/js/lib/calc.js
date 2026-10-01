// Safe arithmetic evaluator (no eval): + - * / ^ %, parentheses, unary minus,
// constants pi/e and a few functions. Returns null for anything else.

const FUNCS = {
  sqrt: Math.sqrt,
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

function tokenize(src) {
  const s = src
    .toLowerCase()
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/(\d),(?=\d{3}\b)/g, '$1');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/);
    if (num) {
      tokens.push({ t: 'num', v: parseFloat(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = s.slice(i).match(/^[a-z]+/);
    if (word) {
      const w = word[0];
      if (w === 'pi') tokens.push({ t: 'num', v: Math.PI });
      else if (w === 'e') tokens.push({ t: 'num', v: Math.E });
      else if (FUNCS[w]) tokens.push({ t: 'fn', v: w });
      else return null;
      i += w.length;
      continue;
    }
    if ('+-*/^%()'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

export function evaluate(src) {
  const tokens = tokenize(String(src));
  if (!tokens || !tokens.length) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v) => {
    if (peek()?.v === v) {
      pos++;
      return true;
    }
    return false;
  };

  function expr() {
    let v = term();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = tokens[pos++].v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    while (true) {
      const p = peek();
      if (p?.t === 'op' && (p.v === '*' || p.v === '/')) {
        pos++;
        const r = unary();
        v = p.v === '*' ? v * r : v / r;
      } else if (p?.t === 'op' && p.v === '%') {
        pos++;
        // "50 % 3" is modulo; a trailing "20%" means percent.
        const next = peek();
        if (next && (next.t === 'num' || next.t === 'fn' || next.v === '(')) v = v % unary();
        else v = v / 100;
      } else if (p && (p.t === 'num' || p.t === 'fn' || p.v === '(')) {
        v *= unary(); // implicit multiplication: 2(3+4), 2pi
      } else break;
    }
    return v;
  }
  function unary() {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    return power();
  }
  function power() {
    const base = atom();
    if (eat('^')) return base ** unary();
    return base;
  }
  function atom() {
    const p = tokens[pos++];
    if (!p) throw new Error('end');
    if (p.t === 'num') return p.v;
    if (p.t === 'fn') {
      const arg = atom();
      return FUNCS[p.v](arg);
    }
    if (p.v === '(') {
      const v = expr();
      eat(')');
      return v;
    }
    throw new Error('unexpected');
  }

  try {
    const v = expr();
    if (pos !== tokens.length || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

export function looksLikeMath(q) {
  const s = q.trim();
  if (!/\d/.test(s) || s.length > 80) return false;
  if (!/[+\-*/^%×÷()]|sqrt|sin|cos|tan|log|ln/.test(s)) return false;
  if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(s)) return false; // dates
  return evaluate(s) !== null;
}

export function formatNumber(v) {
  if (v === null || v === undefined) return '';
  if (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0)) return v.toExponential(8).replace(/\.?0+e/, 'e');
  const rounded = Math.round(v * 1e10) / 1e10;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 10 });
}
