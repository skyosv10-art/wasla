#!/usr/bin/env node
// ts_evidence.cjs — يستخرج حقائق حالات it()/test() من ملفات الاختبار بمحلل TypeScript الفعلي
// (CLM-0521 · CLM-0523 · الحارس 28 · ADR-069 §2.8/§7.2).
//
// المدخل: مسارات ملفات (argv). المخرج (stdout): JSON
//   { ok: true, files: { <path>: { error?, cases: [CaseFacts] } } }
// أو { ok: false, error } إن تعذّر تحميل typescript — والحارس يفشل مغلقًا عندها.
//
// الحقائق تُستخرج من **جسم الحالة نفسها** فقط (مع حل ثوابت `const` في الحالة ثم في الوحدة)،
// فلا يُحسب تعليق ولا سلسلة نصية ولا اختبار آخر في الملف. الحارس (Python) يطبّق القواعد.

"use strict";
const fs = require("node:fs");
const path = require("node:path");

let ts;
try {
  ts = require("typescript");
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: `typescript غير متاح: ${e.message}` }));
  process.exit(0);
}

const IDENTITY_KEY = /^(obo|onBehalfOf\w*|session\w*|authorization|actor\w*|endUser\w*)$/i;
const STATUS_PROPS = new Set(["statusCode", "status"]);
const EQ_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);

function unwrap(n) {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isAwaitExpression(n) ||
               ts.isNonNullExpression(n) || ts.isTypeAssertionExpression?.(n) || ts.isSatisfiesExpression?.(n))) {
    n = n.expression;
  }
  return n;
}

function propName(p) {
  if (!p.name) return null;
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text;
  if (ts.isComputedPropertyName(p.name) && ts.isIdentifier(p.name.expression)) return `[${p.name.expression.text}]`;
  return null;
}

function collectConsts(root, into) {
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      into.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
}

function chainOf(callee) {
  // it / it.skip / it.skipIf(c) / describe.each(...)  ⇒ { base, mods[] }
  const mods = [];
  let n = callee;
  for (;;) {
    if (ts.isCallExpression(n)) { n = n.expression; continue; }
    if (ts.isPropertyAccessExpression(n)) { mods.unshift(n.name.text); n = n.expression; continue; }
    break;
  }
  return { base: ts.isIdentifier(n) ? n.text : null, mods };
}

function analyzeFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const moduleConsts = new Map();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) moduleConsts.set(d.name.text, d.initializer);
    }
  }
  // الاستيرادُ المسمّى: الاسمُ المحلّيُّ ⇒ { from, imported } (CLM-0689 · E-20:store-eligible).
  const imports = {};
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const nb = st.importClause && st.importClause.namedBindings;
    if (st.importClause && st.importClause.isTypeOnly) continue;
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) {
      if (el.isTypeOnly) continue;
      imports[el.name.text] = { from: st.moduleSpecifier.text, imported: (el.propertyName || el.name).text };
    }
  }
  const cases = [];
  const visit = (n, ancestors) => {
    if (ts.isCallExpression(n)) {
      const { base, mods } = chainOf(n.expression);
      const a0 = n.arguments[0];
      const fn = n.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
      if ((base === "it" || base === "test") && a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) {
        const all = [...mods, ...ancestors.flat()];
        cases.push(caseFacts(a0.text, mods, all, fn, moduleConsts, sf));
      }
      if (base === "describe" && fn) {
        visit_children(n, [...ancestors, mods]);
        return;
      }
    }
    visit_children(n, ancestors);
  };
  const visit_children = (n, anc) => ts.forEachChild(n, (c) => visit(c, anc));
  visit(sf, []);
  for (const c of cases) c.imports = imports;
  return { cases, imports };
}

// ── دلالات التنفيذ (CLM-0523 · تدعيم) ────────────────────────────────────────
// تحليل محافظ: عملية الدليل (طلب، expect، ضبط المستقبل) «مضمونة التنفيذ» فقط إن كان
// الطريق إليها من جسم الحالة خطيًا: لا if/?:/&&/||/??/?. ولا switch/catch ولا دالة
// متداخلة (callback) ولا حلقة — إلا for…of على مصفوفة حرفية غير فارغة محلولة كلها
// (يُسجَّل «loop_ok» منفصلًا، ويقبله E-20:params وحده). و`if (true)` وحده يُثبَت.
// وأي `return`/`break`/`continue`/`.skip()` يسبق العملية في كتلة محيطة يُسقط الضمان.

function caseFacts(title, ownMods, allMods, fn, moduleConsts, sf) {
  const dead = allMods.some((m) => m === "skip" || m === "todo");
  const conditional = allMods.some((m) => m === "skipIf" || m === "runIf" || m === "each");
  const facts = { title, live: !!fn && !dead && !conditional, dead, conditional, mods: allMods,
                  has_body: !!fn, mode_off: false, mode_sets: [], requests: [], expects: [], seeds: [] };
  if (!fn) return facts;
  const body = fn.body;
  const local = new Map();
  collectConsts(body, local);
  const resolve = (n, depth = 0) => {
    n = unwrap(n);
    if (n && ts.isIdentifier(n) && depth < 8) {
      const init = local.get(n.text) ?? moduleConsts.get(n.text);
      if (init) return resolve(init, depth + 1);
    }
    return n;
  };
  const idsLits = (n, out = { ids: new Set(), lits: new Set() }, depth = 0) => {
    if (!n || depth > 8) return out;
    n = unwrap(n);
    if (ts.isIdentifier(n)) {
      out.ids.add(n.text);
      const init = local.get(n.text) ?? moduleConsts.get(n.text);
      if (init) idsLits(init, out, depth + 1);
      return out;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { out.lits.add(n.text); return out; }
    ts.forEachChild(n, (c) => idsLits(c, out, depth));
    return out;
  };
  const pack = (n) => { const r = idsLits(n); return { ids: [...r.ids], lits: [...r.lits], text: n.getText(sf) }; };

  const isFnLike = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);

  const constArray = (expr) => {
    const arr = resolve(expr);
    if (!arr || !ts.isArrayLiteralExpression(arr) || arr.elements.length === 0) return null;
    const vals = arr.elements.map((e) => {
      const r = resolve(e);
      return r && (ts.isStringLiteral(r) || ts.isNoSubstitutionTemplateLiteral(r)) ? r.text :
             r && ts.isNumericLiteral(r) ? Number(r.text) : undefined;
    });
    return vals.every((v) => v !== undefined) ? vals : null;
  };

  // يحوي `return`/`break`/`continue`/`*.skip()` خارج الدوال المتداخلة؟
  const hasEarlyExit = (n) => {
    let found = false;
    const v = (x) => {
      if (found || isFnLike(x)) return;
      if (ts.isReturnStatement(x) || ts.isBreakStatement(x) || ts.isContinueStatement(x)) { found = true; return; }
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "skip") { found = true; return; }
      ts.forEachChild(x, v);
    };
    v(n);
    return found;
  };

  // { strict, loop_ok, why[] } — هل تُنفَّذ العقدة حتمًا متى نُفِّذت الحالة؟
  const execInfo = (n) => {
    const why = [];
    let loopOnly = true;
    let child = n, p = n.parent;
    while (p && child !== body) {
      if (ts.isIfStatement(p) && child !== p.expression) {
        const c = unwrap(p.expression);
        if (!(c && c.kind === ts.SyntaxKind.TrueKeyword && child === p.thenStatement)) why.push("if");
      } else if (ts.isConditionalExpression(p) && child !== p.condition) {
        why.push("?:");
      } else if (ts.isBinaryExpression(p) && child === p.right &&
                 [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
                  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]
                   .includes(p.operatorToken.kind)) {
        why.push("&&/||/??");
      } else if ((ts.isCallExpression(p) || ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.questionDotToken) {
        why.push("?.");
      } else if (ts.isCaseClause(p) || ts.isDefaultClause(p)) {
        why.push("switch");
      } else if (ts.isCatchClause(p)) {
        why.push("catch");
      } else if (ts.isForOfStatement(p) && child === p.statement) {
        if (constArray(p.expression)) loopOnly = loopOnly && true; else why.push("حلقة على قيم غير ثابتة أو فارغة");
        why.push("@loop");
      } else if ((ts.isForStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) && child !== p.expression) {
        why.push("حلقة");
      } else if (isFnLike(p)) {
        why.push("دالة متداخلة (callback)");
      }
      if (ts.isBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
        const stmts = p.statements;
        const i = stmts.indexOf(child);
        for (let k = 0; k < i; k++) if (hasEarlyExit(stmts[k])) { why.push("return/break/continue/skip يسبقها"); break; }
      }
      child = p; p = p.parent;
    }
    const real = why.filter((w) => w !== "@loop");
    return { strict: why.length === 0, loop_ok: real.length === 0, why: real.length ? real : why.includes("@loop") ? ["حلقة ثابتة"] : [] };
  };

  // مسار الجملة من جسم الحالة (للترتيب): فهارس الجمل المتداخلة.
  const stmtPath = (n) => {
    const path = [];
    let cur = n;
    while (cur && cur !== body && cur.parent) {
      const p = cur.parent;
      if ((ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) && p.statements.indexOf(cur) >= 0) {
        path.unshift(p.statements.indexOf(cur));
      }
      cur = p;
    }
    return path;
  };

  const flatten = (n, depth = 0) => {
    const r = resolve(n);
    if (!r || depth > 8) return [{ hole: pack(n) }];
    if (ts.isStringLiteral(r) || ts.isNoSubstitutionTemplateLiteral(r)) return [{ lit: r.text }];
    if (ts.isTemplateExpression(r)) {
      const out = [{ lit: r.head.text }];
      for (const sp of r.templateSpans) {
        const inner = resolve(sp.expression);
        if (inner && (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isTemplateExpression(inner))) {
          out.push(...flatten(sp.expression, depth + 1));
        } else {
          out.push({ hole: pack(sp.expression) });
        }
        out.push({ lit: sp.literal.text });
      }
      return out;
    }
    if (ts.isBinaryExpression(r) && r.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return [...flatten(r.left, depth + 1), ...flatten(r.right, depth + 1)];
    }
    return [{ hole: pack(n) }];
  };

  const objProps = (n) => {
    const r = resolve(n);
    return r && ts.isObjectLiteralExpression(r) ? r.properties : null;
  };
  const identityProps = (n, out = [], depth = 0) => {
    if (!n || depth > 6) return out;
    const r = resolve(n);
    if (!r) return out;
    if (ts.isObjectLiteralExpression(r)) {
      for (const p of r.properties) {
        const k = propName(p);
        if (ts.isPropertyAssignment(p) && k && IDENTITY_KEY.test(k)) out.push({ key: k, ...pack(p.initializer) });
        else if (ts.isShorthandPropertyAssignment(p) && IDENTITY_KEY.test(p.name.text)) out.push({ key: p.name.text, ...pack(p.name) });
        else if (ts.isPropertyAssignment(p)) identityProps(p.initializer, out, depth + 1);
      }
    } else if (ts.isCallExpression(r)) {
      for (const a of r.arguments) identityProps(a, out, depth + 1);
    }
    return out;
  };
  const payloadFields = (n, out = [], depth = 0) => {
    if (!n || depth > 4) return out;
    const r = resolve(n);
    if (!r) return out;
    if (ts.isObjectLiteralExpression(r)) {
      for (const p of r.properties) {
        const k = propName(p);
        if (ts.isPropertyAssignment(p) && k) { out.push({ key: k, ...pack(p.initializer) }); payloadFields(p.initializer, out, depth + 1); }
        else if (ts.isShorthandPropertyAssignment(p)) out.push({ key: p.name.text, ...pack(p.name) });
      }
    } else if (ts.isCallExpression(r)) {
      for (const a of r.arguments) payloadFields(a, out, depth + 1);
    }
    return out;
  };
  const loopValues = (node) => {
    const vals = {};
    for (let p = node.parent; p && p !== body.parent; p = p.parent) {
      if (ts.isForOfStatement(p) && ts.isVariableDeclarationList(p.initializer)) {
        const d = p.initializer.declarations[0];
        const arr = constArray(p.expression);
        if (d && ts.isIdentifier(d.name) && arr) vals[d.name.text] = arr.filter((x) => typeof x === "string");
      }
    }
    return vals;
  };
  const resVarOf = (call) => {
    let p = call.parent;
    while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p))) p = p.parent;
    return p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) ? p.name.text : null;
  };

  // ── دلالة «المنشور والمرئي» على مسنَد العناصر (CLM-0523 · ب) ────────────
  const PUB_PROPS = new Set(["state", "status"]);
  const VIS_PROPS = new Set(["visible", "is_visible", "isVisible"]);
  const lam = (f) => {
    f = unwrap(f);
    if (!f || !(ts.isArrowFunction(f) || ts.isFunctionExpression(f)) || f.parameters.length < 1) return null;
    const prm = f.parameters[0].name;
    const names = { item: null, fields: new Map() };
    if (ts.isIdentifier(prm)) names.item = prm.text;
    else if (ts.isObjectBindingPattern(prm)) {
      for (const el of prm.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
        names.fields.set(el.name.text, key);
      }
    } else return null;
    let b = f.body;
    if (ts.isBlock(b)) {
      if (b.statements.length !== 1 || !ts.isReturnStatement(b.statements[0]) || !b.statements[0].expression) return null;
      b = b.statements[0].expression;
    }
    return { names, expr: b };
  };
  const fieldOf = (e, names) => {   // p.state  أو  state المفكوكة ⇒ اسم الحقل
    e = unwrap(e);
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === names.item) return e.name.text;
    if (ts.isIdentifier(e) && names.fields.has(e.text)) return names.fields.get(e.text);
    return null;
  };
  const isStr = (e, v) => { e = unwrap(e); return e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && e.text === v; };
  const isTrue = (e) => { e = unwrap(e); return e && e.kind === ts.SyntaxKind.TrueKeyword; };
  // ذرّة: PUB · VIS · NOTPUB · NOTVIS · null
  const atom = (e, names) => {
    e = unwrap(e);
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
      const a = atom(e.operand, names);
      return a === "PUB" ? "NOTPUB" : a === "VIS" ? "NOTVIS" : null;
    }
    const f = fieldOf(e, names);
    if (f && VIS_PROPS.has(f)) return "VIS";
    if (ts.isBinaryExpression(e)) {
      const k = e.operatorToken.kind;
      const eq = k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken;
      const ne = k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken;
      if (!eq && !ne) return null;
      for (const [x, y] of [[e.left, e.right], [e.right, e.left]]) {
        const fx = fieldOf(x, names);
        if (fx && PUB_PROPS.has(fx) && isStr(y, "published")) return eq ? "PUB" : "NOTPUB";
        if (fx && VIS_PROPS.has(fx) && isTrue(y)) return eq ? "VIS" : "NOTVIS";
      }
    }
    return null;
  };
  const flat = (e, op) => {
    e = unwrap(e);
    return ts.isBinaryExpression(e) && e.operatorToken.kind === op ? [...flat(e.left, op), ...flat(e.right, op)] : [e];
  };
  const impliesBoth = (e, names) => {     // المسنَد ⇒ منشور ∧ مرئي
    const cs = flat(e, ts.SyntaxKind.AmpersandAmpersandToken).map((x) => atom(x, names));
    return cs.includes("PUB") && cs.includes("VIS");
  };
  const coversViolation = (e, names) => { // المسنَد ⊇ ¬منشور ∨ ¬مرئي
    const u = unwrap(e);
    if (ts.isPrefixUnaryExpression(u) && u.operator === ts.SyntaxKind.ExclamationToken && impliesBoth(u.operand, names)) return true;
    const ds = flat(e, ts.SyntaxKind.BarBarToken).map((x) => atom(x, names));
    return ds.includes("NOTPUB") && ds.includes("NOTVIS");
  };
  const publishedProof = (arg, matcher, negated, exp, nargs) => {
    const a = unwrap(arg);
    const isFalse = (x) => { x = x && unwrap(x); return x && x.kind === ts.SyntaxKind.FalseKeyword; };
    const isZero = (x) => { x = x && unwrap(x); return x && ts.isNumericLiteral(x) && Number(x.text) === 0; };
    const isEmptyArr = (x) => { x = x && unwrap(x); return x && ts.isArrayLiteralExpression(x) && x.elements.length === 0; };
    const EQ = ["toBe", "toEqual", "toStrictEqual"];
    const call = (x, m) => ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === m && x.arguments[0] ? x : null;
    if (negated) return null;
    let c, L, kind;
    if ((c = call(a, "every")) && ((EQ.includes(matcher) && isTrue(exp)) || (matcher === "toBeTruthy" && nargs === 0))) {
      L = lam(c.arguments[0]); kind = "every";
      return { kind, items: c.expression.expression.getText(sf), ok: !!L && impliesBoth(L.expr, L.names) };
    }
    if ((c = call(a, "some")) && ((EQ.includes(matcher) && isFalse(exp)) || (matcher === "toBeFalsy" && nargs === 0))) {
      L = lam(c.arguments[0]); kind = "none-some";
      return { kind, items: c.expression.expression.getText(sf), ok: !!L && coversViolation(L.expr, L.names) };
    }
    if ((c = call(a, "filter")) && ((matcher === "toHaveLength" && isZero(exp)) || (EQ.includes(matcher) && isEmptyArr(exp)))) {
      L = lam(c.arguments[0]); kind = "none-filter";
      return { kind, items: c.expression.expression.getText(sf), ok: !!L && coversViolation(L.expr, L.names) };
    }
    if (ts.isPropertyAccessExpression(a) && a.name.text === "length" && (c = call(unwrap(a.expression), "filter")) && EQ.includes(matcher) && isZero(exp)) {
      L = lam(c.arguments[0]); kind = "none-filter";
      return { kind, items: c.expression.expression.getText(sf), ok: !!L && coversViolation(L.expr, L.names) };
    }
    return null;
  };
  const nonEmptyOf = (arg, matcher, negated, exp) => {   // يُثبت أن القائمة غير فارغة
    const a = unwrap(arg);
    const num = exp && unwrap(exp) && ts.isNumericLiteral(unwrap(exp)) ? Number(unwrap(exp).text) : null;
    if (ts.isPropertyAccessExpression(a) && a.name.text === "length") {
      const t = a.expression.getText(sf);
      if (!negated && matcher === "toBeGreaterThan" && num !== null && num >= 0) return t;
      if (!negated && matcher === "toBeGreaterThanOrEqual" && num !== null && num >= 1) return t;
      if (negated && ["toBe", "toEqual"].includes(matcher) && num === 0) return t;
      if (!negated && ["toBe", "toEqual"].includes(matcher) && num !== null && num > 0) return t;
    }
    if (matcher === "toHaveLength") {
      if (!negated && num !== null && num > 0) return a.getText(sf);
      if (negated && num === 0) return a.getText(sf);
    }
    return null;
  };

  // ── بذرةُ الأهليّةِ وشكلُ المساواةِ (CLM-0689 · E-20:store-eligible) ─────
  // صفوفُ البذرةِ: مصفوفةٌ حرفيّةٌ من كائناتٍ حرفيّةٍ؛ كلُّ قيمةٍ نصٌّ حرفيٌّ أو null (ثقبٌ).
  const literalRows = (n) => {
    const arr = resolve(n);
    if (!arr || !ts.isArrayLiteralExpression(arr)) return null;
    const rows = [];
    for (const el of arr.elements) {
      const o = resolve(el);
      if (!o || !ts.isObjectLiteralExpression(o)) return null;
      const row = {};
      for (const p of o.properties) {
        const k = propName(p);
        if (!k) return null;
        if (!ts.isPropertyAssignment(p)) { row[k] = null; continue; }
        const v = resolve(p.initializer);
        row[k] = v && (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) ? v.text : null;
      }
      rows.push(row);
    }
    return rows;
  };
  const strArray = (x) => {
    x = x && resolve(x);
    if (!x || !ts.isArrayLiteralExpression(x)) return null;
    const v = x.elements.map((e) => { const r = resolve(e); return r && (ts.isStringLiteral(r) || ts.isNoSubstitutionTemplateLiteral(r)) ? r.text : undefined; });
    return v.every((y) => y !== undefined) ? v : null;
  };
  // سلسلةُ وصولٍ خالصةٌ (a.b.c) بلا نداءٍ ولا فهرسٍ ولا ?.
  const plainChain = (x) => {
    x = unwrap(x);
    while (x && ts.isPropertyAccessExpression(x) && !x.questionDotToken) x = unwrap(x.expression);
    return !!x && ts.isIdentifier(x);
  };
  // expect(X.map((i) => i.F))  ⇒ { items: "X", field: "F" } — X سلسلةٌ خالصةٌ (لا filter قبلَه).
  const mapField = (arg) => {
    const a = unwrap(arg);
    if (!ts.isCallExpression(a) || !ts.isPropertyAccessExpression(a.expression) || a.expression.name.text !== "map" || a.arguments.length !== 1) return null;
    const L = lam(a.arguments[0]);
    if (!L) return null;
    const f = fieldOf(L.expr, L.names);
    return { items: a.expression.expression.getText(sf), plain: plainChain(a.expression.expression), field: f };
  };
  // expect(Object.keys(X)) أو expect(Object.keys(X).sort())  ⇒ { of: "X" }
  const keysOf = (arg) => {
    let a = unwrap(arg);
    if (ts.isCallExpression(a) && ts.isPropertyAccessExpression(a.expression) && a.expression.name.text === "sort" && a.arguments.length === 0) a = unwrap(a.expression.expression);
    if (ts.isCallExpression(a) && ts.isPropertyAccessExpression(a.expression) && a.expression.name.text === "keys" &&
        ts.isIdentifier(a.expression.expression) && a.expression.expression.text === "Object" && a.arguments.length === 1) {
      return { of: a.arguments[0].getText(sf) };
    }
    return null;
  };

  const MODE_KEYS = new Set(["WASLA_USER_ASSERTION_MODE", "[USER_ASSERTION_MODE_ENV]"]);
  const walk = (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = n.left, r = resolve(n.right);
      const lname = ts.isPropertyAccessExpression(l) ? l.name.text :
        ts.isElementAccessExpression(l) && ts.isStringLiteral(l.argumentExpression) ? l.argumentExpression.text :
        ts.isElementAccessExpression(l) && ts.isIdentifier(l.argumentExpression) ? `[${l.argumentExpression.text}]` : null;
      if (lname && MODE_KEYS.has(lname)) {
        facts.mode_sets.push({ value: r && ts.isStringLiteral(r) ? r.text : null, path: stmtPath(n), exec: execInfo(n) });
      }
    }
    if (ts.isPropertyAssignment(n)) {
      const k = propName(n), r = resolve(n.initializer);
      if (k && MODE_KEYS.has(k)) {
        facts.mode_sets.push({ value: r && ts.isStringLiteral(r) ? r.text : null, path: stmtPath(n), exec: execInfo(n) });
      }
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      for (const [i, a] of n.arguments.entries()) {
        const rows = literalRows(a);
        if (rows) {
          facts.seeds.push({ callee: n.expression.text, arg_index: i, rows, res: resVarOf(n),
                             path: stmtPath(n), exec: execInfo(n), pos: n.getStart(sf) });
          break;
        }
      }
    }
    if (ts.isCallExpression(n)) {
      const props = n.arguments[0] ? objProps(n.arguments[0]) : null;
      const urlP = props && props.find((p) => ts.isPropertyAssignment(p) && propName(p) === "url");
      if (urlP) {
        const get = (k) => props.find((p) => ts.isPropertyAssignment(p) && propName(p) === k);
        const m = get("method") && resolve(get("method").initializer);
        const headers = get("headers");
        const payload = get("payload") || get("body");
        const query = get("query");
        facts.requests.push({
          method: m && ts.isStringLiteral(m) ? m.text.toUpperCase() : (get("method") ? null : "GET"),
          url: flatten(urlP.initializer),
          loop: loopValues(n),
          identity: headers ? identityProps(headers.initializer) : [],
          payload: payload ? payloadFields(payload.initializer) : [],
          query_keys: query && objProps(query.initializer) ? objProps(query.initializer).map(propName).filter(Boolean) : [],
          res: resVarOf(n),
          path: stmtPath(n),
          exec: execInfo(n),
          pos: n.getStart(sf),
        });
      }
      if (ts.isPropertyAccessExpression(n.expression)) {
        const matcher = n.expression.name.text;
        let e = n.expression.expression, negated = false;
        if (ts.isPropertyAccessExpression(e) && e.name.text === "not") { negated = true; e = e.expression; }
        if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "expect" && e.arguments[0]) {
          const arg = e.arguments[0];
          const raw = { ids: new Set(), strs: new Set(), props: new Set() };
          const scan = (x) => {
            if (ts.isIdentifier(x)) raw.ids.add(x.text);
            if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) raw.strs.add(x.text);
            if (ts.isPropertyAccessExpression(x)) raw.props.add(x.name.text);
            ts.forEachChild(x, scan);
          };
          scan(arg);
          const a = unwrap(arg);
          const exp = n.arguments[0];
          const expR = exp ? resolve(exp) : null;
          facts.expects.push({
            matcher, negated,
            status_of: ts.isPropertyAccessExpression(a) && STATUS_PROPS.has(a.name.text) && ts.isIdentifier(a.expression) ? a.expression.text : null,
            expected_num: expR && ts.isNumericLiteral(expR) ? Number(expR.text) : null,
            expected: exp ? pack(exp) : null,
            arg_ids: [...raw.ids], arg_strs: [...raw.strs], arg_props: [...raw.props],
            published: publishedProof(arg, matcher, negated, expR, n.arguments.length),
            nonempty_of: nonEmptyOf(arg, matcher, negated, expR),
            map_field: mapField(arg),
            keys_of: keysOf(arg),
            expected_strs: exp ? strArray(exp) : null,
            path: stmtPath(n),
            exec: execInfo(n),
            pos: n.getStart(sf),
          });
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(body);

  const before = (a, b) => {   // الجملة a تسبق b (لا احتواء)
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  for (const r of facts.requests) {
    // ضبط المستقبل: آخر ضبط يسبق الطلب يجب أن يكون "off" مضمون التنفيذ، ولا ضبط مشروط بعده.
    const prior = facts.mode_sets.filter((m) => before(m.path, r.path));
    const last = prior[prior.length - 1];
    r.mode_off_before = !!last && last.value === "off" && last.exec.strict;
    r.mode_why = !prior.length ? (facts.mode_sets.length ? "ضبط المستقبل يأتي بعد الطلب أو في جملته نفسها" : "لا ضبط للمستقبل في الحالة")
      : !last.exec.strict ? `آخر ضبط للمستقبل قبل الطلب مشروط (${last.exec.why.join("، ")})`
      : last.value !== "off" ? `آخر ضبط للمستقبل قبل الطلب = ${JSON.stringify(last.value)}` : null;
    r.statuses = [];        // تحقق مضمون بعد الطلب على نتيجته
    r.statuses_loop = [];   // يقبل حلقة ثابتة (E-20:params)
    if (!r.res) continue;
    for (const x of facts.expects) {
      if (x.status_of !== r.res || !["toBe", "toEqual", "toStrictEqual"].includes(x.matcher) || x.negated || x.expected_num === null) continue;
      if (!before(r.path, x.path)) continue;
      if (x.exec.strict) r.statuses.push(x.expected_num);
      if (x.exec.loop_ok) r.statuses_loop.push(x.expected_num);
    }
  }
  facts.mode_off = facts.requests.some((r) => r.mode_off_before);

  const derived = new Set(facts.requests.map((r) => r.res).filter(Boolean));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [k, init] of local) {
      if (derived.has(k)) continue;
      const direct = new Set();
      const sc = (x) => { if (ts.isIdentifier(x)) direct.add(x.text); ts.forEachChild(x, sc); };
      sc(init);
      if ([...direct].some((i) => derived.has(i))) { derived.add(k); grew = true; }
    }
  }
  facts.derived = [...derived];
  for (const x of facts.expects) x.on_result = x.arg_ids.some((i) => derived.has(i));
  return facts;
}

const out = { ok: true, files: {} };
for (const f of process.argv.slice(2)) {
  try {
    out.files[f] = analyzeFile(f);
  } catch (e) {
    out.files[f] = { error: String(e && e.message || e), cases: [] };
  }
}
process.stdout.write(JSON.stringify(out));
