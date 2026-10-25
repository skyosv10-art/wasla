#!/usr/bin/env python3
"""runtime_reads.py — what a deployed service can read beyond its module closure.

CLM-0628 · CLM-0630 · RISK-0068 · M6-18B.

Policy (CLM-0628): the shared image is `COPY . .`, so image bytes are NOT
compared. The selective planner (render_plan.py) claims *runtime-input*
equivalence: the service process loads (a) its workspace dependency closure,
(b) node_modules (lockfile + every workspace manifest), (c) scripts/container/
and (d) files it reads from disk. (d) is what a module closure cannot see.

CLM-0630 hardening. A name×count fingerprint did not bind a read to its target
(measured: an absolute `/app/...` path, a composed path, or a constant
re-pointed to an absolute path all passed as `runtime-equivalent`). Now every
call of an imported file-system function is located with a string- and
comment-aware scanner, its argument is evaluated by a small conservative
evaluator, and each call is classified:

  repo:<path>       resolved repository path (container root /app = repo root;
                    relative paths resolve against the package dir — the
                    entrypoint's `cd "$DIR"`, verified below)
  prefix:<dir>/     resolved directory + a dynamic file-name segment that the
                    code rejects unless it matches a const regex /^[class]+$/
                    whose class excludes `/`, `\\` and `.` (verified, so the
                    segment cannot climb out of <dir>)
  external:<path>   resolved absolute path outside /app (not a git input)
  write             mkdir/rm/writeFile/... or open(path, "w"/"wx"/"a"/"ax"...)
  unresolved        anything the evaluator cannot decide

The evaluator understands only: string and template literals, `+`, `const`
bindings in the same file or imported by relative path, function parameters
with a default (only when no runtime caller passes that position and the
function is never used as a value), `import.meta.url`, `__dirname`,
`__filename`, `process.cwd()`, `new URL(x, base)`, `.pathname`, and
join/resolve/dirname/fileURLToPath imported from node:path / node:url. Every
other construct is `unresolved` — it never becomes `runtime-equivalent`:

  - an `unresolved` read must be declared in the file's registration
    (`unresolved: [{call, why}]`) or the audit fails; a declared one makes
    every service whose closure contains the file `deploy` (conservative);
  - exception, verified: `delegated: [P]` — the read target is the parameter
    or option P, and EVERY runtime `P:` / `{ P }` value in other files must
    itself resolve (and be covered there).

Registration (`scripts/deploy/runtime-reads.json`, per file):
  calls     ordered fingerprint `name(<argument text>) → <target>`; any change
            in the call, its argument text or its resolved target fails the
            audit until re-reviewed;
  reads     repo paths outside the package that the targets need; every target
            outside the package must be covered, and every listed read must be
            used by some target or path literal (no stale registration);
  external  absolute paths outside /app that are read;
  unresolved / delegated / why as above.

Also failed: an fs binding used other than as a direct call (aliasing), an fs
module named anywhere but a static import (dynamic import, require, re-export),
`process.getBuiltinModule`/`process.binding`, child_process/module/
worker_threads/vm imports, relative imports leaving the package, non-literal
dynamic import/require, path literals leaving the package (`../`, `/app/...`,
cwd-relative repo paths, join/resolve with too many `..`) not covered, and
`start` scripts naming paths outside their package.

Declared limits (not proved): this is a conservative scanner, not a type-aware
data-flow analysis. Values reaching a delegated option through spread or
computed keys, file reads performed inside third-party packages, and Render
configuration outside git are not seen; `full=true` remains the fleet override.
"""
from __future__ import annotations

import json
import os
import posixpath
import re

FS_MODULES = ("fs", "node:fs", "fs/promises", "node:fs/promises")
PATH_MODULES = ("path", "node:path", "path/posix", "node:path/posix")
URL_MODULES = ("url", "node:url")
BANNED_MODULES = ("child_process", "module", "worker_threads", "vm")
REPO_TOPS = ("packages/", "services/", "apps/", "bots/", "infra/", "scripts/", "docs/")
TEST = re.compile(r"(__tests__/|/test/|/tests/|\.test\.|\.spec\.|vitest\.config|vite\.config|/fixtures?/)")
SRC_EXT = (".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx")
SKIP_DIRS = {"node_modules", "dist", "coverage", ".turbo"}
APP = "/app"
WRITE_OPS = {"writeFile", "appendFile", "mkdir", "rm", "rmdir", "unlink", "mkdtemp", "truncate",
             "chmod", "chown", "utimes", "symlink"}
WRITE_FLAGS = {"w", "wx", "a", "ax", "w+", "wx+", "as", "xw"}
CWD_RULE = 'cd "$DIR"'

_IMPORT = re.compile(
    r"""\bimport\s+(?P<type>type\s+)?(?:(?P<default>[A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+(?P<ns>[A-Za-z_$][\w$]*)|\{(?P<named>[^}]*)\})?\s*from\s*["'](?P<mod>[^"']+)["']\s*;?"""
)
_REL_SPEC = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+|\bexport\s+\*\s+from\s*)["'](\.{1,2}/[^"']*)["']""", re.M)
_DYNAMIC = re.compile(r"""\bimport\(\s*(?![\s"'`])|\brequire\(\s*(?![\s"'`])|\brequire\.resolve\(|\bimport\.meta\.resolve\(|\bimport\.meta\.glob\(""")
_STR = re.compile(r"""(?P<q>["'`])(?P<s>(?:\\.|(?!(?P=q)).)*?)(?P=q)""", re.S)
_IDENT = re.compile(r"[A-Za-z_$][\w$]*")


class Unres(Exception):
    """The evaluator cannot decide this value."""


# ---------------------------------------------------------------- scanning --

def strip_comments(src: str) -> str:
    """Remove // and /* */ comments outside string literals (comments cite paths; code reads them)."""
    out, i, n, q = [], 0, len(src), None
    while i < n:
        c = src[i]
        if q:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1]); i += 2; continue
            if c == q:
                q = None
            i += 1
            continue
        if c in "\"'`":
            q = c; out.append(c); i += 1; continue
        if src.startswith("//", i):
            j = src.find("\n", i); i = n if j < 0 else j; continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2); i = n if j < 0 else j + 2; continue
        out.append(c); i += 1
    return "".join(out)


def blank_strings(src: str) -> str:
    """Same length; contents of string literals blanked, template `${...}` code kept."""
    out, i, n = list(src), 0, len(src)
    while i < n:
        c = src[i]
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            for k in range(i + 1, min(j, n)):
                if out[k] != "\n": out[k] = " "
            i = j + 1
            continue
        if c == "`":
            j, depth = i + 1, 0
            while j < n:
                if src[j] == "\\": out[j] = " "; j += 2; continue
                if depth == 0 and src[j] == "`": break
                if depth == 0 and src.startswith("${", j): depth = 1; j += 2; continue
                if depth:
                    depth += {"{": 1, "}": -1}.get(src[j], 0)
                    if depth == 0: j += 1; continue
                elif out[j] != "\n":
                    out[j] = " "
                j += 1
            i = j + 1
            continue
        i += 1
    return "".join(out)


def _match_close(code: str, i: int) -> int:
    """code[i] is an opening bracket in blanked code → index of its partner."""
    pairs = {"(": ")", "[": "]", "{": "}"}
    stack = [pairs[code[i]]]
    j = i + 1
    while j < len(code) and stack:
        ch = code[j]
        if ch in pairs: stack.append(pairs[ch])
        elif ch in ")]}":
            if ch != stack[-1]: return -1
            stack.pop()
        j += 1
    return j - 1 if not stack else -1


def split_top(text: str, sep: str) -> list[str]:
    """Split at top-level `sep` (outside brackets and strings)."""
    code = blank_strings(text)
    parts, depth, last = [], 0, 0
    for k, ch in enumerate(code):
        if ch in "([{": depth += 1
        elif ch in ")]}": depth -= 1
        elif ch == sep and depth == 0:
            parts.append(text[last:k]); last = k + 1
    parts.append(text[last:])
    return [p.strip() for p in parts]


def norm_text(t: str) -> str:
    return re.sub(r"\s+", " ", t).strip()


# ------------------------------------------------------------- workspace ---

def workspace_dirs(root: str) -> list[str]:
    ws = open(os.path.join(root, "pnpm-workspace.yaml"), encoding="utf-8").read()
    out = []
    for g in re.findall(r'^\s*-\s*["\']?([^"\'\s]+)["\']?\s*$', ws, re.M):
        if g.endswith("/*"):
            parent = os.path.join(root, g[:-2])
            if os.path.isdir(parent):
                for n in sorted(os.listdir(parent)):
                    if os.path.isfile(os.path.join(parent, n, "package.json")):
                        out.append(f"{g[:-2]}/{n}")
        elif os.path.isfile(os.path.join(root, g, "package.json")):
            out.append(g)
    return out


def runtime_files(root: str, pkg: str):
    for dirpath, dirs, files in os.walk(os.path.join(root, pkg)):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for fn in sorted(files):
            rel = os.path.relpath(os.path.join(dirpath, fn), root).replace(os.sep, "/")
            if fn.endswith(SRC_EXT) and not TEST.search(rel) and not fn.endswith(".d.ts"):
                yield rel


def _norm(p: str) -> str:
    return os.path.normpath(p).replace(os.sep, "/")


def _inside(path: str, pkg: str) -> bool:
    return path == pkg or path.startswith(pkg + "/")


class Source:
    """One runtime file: comment-stripped text, blanked code, import maps."""

    def __init__(self, root: str, rel: str, pkg: str, project: "Project"):
        self.root, self.rel, self.pkg, self.project = root, rel, pkg, project
        self.text = strip_comments(open(os.path.join(root, rel), encoding="utf-8", errors="replace").read())
        self.code = blank_strings(self.text)
        self.imports: dict[str, tuple[str, str]] = {}   # local → (module, imported name | "*")
        self.import_spans: list[tuple[int, int]] = []
        for m in _IMPORT.finditer(self.text):
            self.import_spans.append(m.span())
            if m.group("type"):
                continue
            mod = m.group("mod")
            if m.group("default"): self.imports[m.group("default")] = (mod, "default")
            if m.group("ns"): self.imports[m.group("ns")] = (mod, "*")
            for part in (m.group("named") or "").split(","):
                part = part.strip()
                if part and not part.startswith("type "):
                    name, _, alias = part.partition(" as ")
                    self.imports[(alias or name).strip()] = (mod, name.strip())

    def in_import(self, pos: int) -> bool:
        return any(a <= pos < b for a, b in self.import_spans)

    @property
    def file_dir_abs(self) -> str:
        return posixpath.join(APP, posixpath.dirname(self.rel))

    @property
    def pkg_abs(self) -> str:
        return posixpath.join(APP, self.pkg)


class Project:
    def __init__(self, root: str):
        self.root = root
        self.pkgs = workspace_dirs(root)
        self.sources: dict[str, Source] = {}
        for pkg in self.pkgs:
            for rel in runtime_files(root, pkg):
                self.sources[rel] = Source(root, rel, pkg, self)
        ep = os.path.join(root, "scripts/container/entrypoint.sh")
        self.cwd_rule = os.path.isfile(ep) and CWD_RULE in open(ep, encoding="utf-8").read()

    def resolve_module(self, src: Source, spec: str) -> Source | None:
        base = _norm(posixpath.join(posixpath.dirname(src.rel), spec))
        stem = re.sub(r"\.(m?js|cjs)$", "", base)
        for cand in (base, stem + ".ts", stem + ".tsx", stem + ".mts", stem + ".js", stem + ".mjs",
                     stem + "/index.ts", stem + "/index.js"):
            if cand in self.sources:
                return self.sources[cand]
        return None


# ------------------------------------------------------------- evaluator ---
# A value is ("str", text) — text may hold guarded dynamic segments \x00name\x00 —
# or ("url", absolute file path). Anything else raises Unres.

def _lit(s: str) -> str:
    return re.sub(r"\\(.)", r"\1", s)


def _const_init(src: Source, name: str) -> str:
    decls = [m for m in re.finditer(rf"(?<![\w$.])(const|let|var)\s+{re.escape(name)}\s*(?::[^=;]+)?=", src.code)]
    if len(decls) != 1 or decls[0].group(1) != "const":
        raise Unres(f"`{name}` is not a single const binding")
    start = decls[0].end()
    k, depth = start, 0
    while k < len(src.code):
        ch = src.code[k]
        if ch in "([{": depth += 1
        elif ch in ")]}":
            if depth == 0: break
            depth -= 1
        elif depth == 0 and (ch == ";" or (ch == "\n" and not re.match(r"\s*[+.?:]", src.code[k:]))):
            break
        k += 1
    return src.text[start:k].strip()


def _guarded(src: Source, name: str, before: int) -> bool:
    """`if (!RE.test(name)) throw` before `before`, RE = const /^[class]+$/ without / \\ ."""
    for m in re.finditer(rf"if\s*\(\s*!\s*([A-Za-z_$][\w$]*)\.test\(\s*{re.escape(name)}\s*\)\s*\)\s*\{{?\s*throw\b", src.code[:before]):
        try:
            init = _const_init(src, m.group(1))
        except Unres:
            continue
        rx = re.fullmatch(r"/\^\[([^\]\\/.]*)\](?:\+|\{\d+(?:,\d*)?\})\$/[a-z]*", init)
        if rx and "\\" not in rx.group(1):
            return True
    return False


def _enclosing_param(src: Source, name: str, pos: int):
    """(function name, index, default text|None) for the nearest enclosing function declaring `name`."""
    best = None
    for m in re.finditer(r"(?:\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\()", src.code[:pos]):
        o = m.end() - 1
        c = _match_close(src.code, o)
        if c < 0 or c > pos:
            continue
        params = split_top(src.text[o + 1:c], ",")
        for idx, p in enumerate(params):
            pm = re.match(rf"(?:readonly\s+)?{re.escape(name)}\??\s*(?::[^=]+)?(?:=\s*(.+))?$", p, re.S)
            if pm:
                best = (m.group(1) or m.group(2), idx, pm.group(1).strip() if pm.group(1) else None)
    return best


def _callers_pass(project: Project, fname: str, idx: int, home: Source) -> str | None:
    """Reason a runtime caller may override parameter `idx` of `fname`, or None."""
    for s in project.sources.values():
        if s is not home and fname not in s.imports and not re.search(rf"\b{re.escape(fname)}\b", s.code):
            continue
        for m in re.finditer(rf"(?<![\w$.]){re.escape(fname)}(?![\w$])", s.code):
            if s.in_import(m.start()):
                continue
            after = s.code[m.end():]
            pre = s.code[:m.start()]
            if re.search(r"(?:function\s+|(?:const|let)\s+)$", pre):
                continue                                   # the declaration itself
            if not re.match(r"\s*\(", after):
                if re.match(r"\s*[,;)\]}]", after) or re.search(r"export\s*\{[^}]*$", pre):
                    if re.search(r"export\s*\{[^}]*$", pre):
                        continue
                return f"{fname} used as a value in {s.rel}"
            o = m.end() + after.index("(")
            c = _match_close(s.code, o)
            args = [a for a in split_top(s.text[o + 1:c], ",") if a]
            if len(args) > idx:
                return f"{s.rel} passes argument {idx + 1} of {fname}"
    return None


def evaluate(src: Source, expr: str, pos: int, depth: int = 0):
    if depth > 12:
        raise Unres("evaluation too deep")
    e = expr.strip()
    e = re.sub(r"\s+as\s+[A-Za-z_$][\w$.<>\[\]| ]*$", "", e).rstrip("!").strip()
    if not e:
        raise Unres("empty")
    parts = split_top(e, "+")
    if len(parts) > 1:
        vals = [evaluate(src, p, pos, depth + 1) for p in parts]
        if any(v[0] != "str" for v in vals):
            raise Unres(f"`+` on a URL: {norm_text(e)}")
        return ("str", "".join(v[1] for v in vals))
    code = blank_strings(e)
    if e[0] == "(" and _match_close(code, 0) == len(e) - 1:
        return evaluate(src, e[1:-1], pos, depth + 1)
    if e[0] in "\"'" and len(e) >= 2 and e[-1] == e[0] and blank_strings(e)[1:-1].strip() == "":
        return ("str", _lit(e[1:-1]))
    if e[0] == "`" and e[-1] == "`":
        body, out, i = e[1:-1], "", 0
        while i < len(body):
            if body.startswith("${", i):
                j = _match_close(blank_strings(body), i + 1)
                inner = body[i + 2:j].strip()
                if _IDENT.fullmatch(inner):
                    try:
                        v = evaluate(src, inner, pos, depth + 1)
                        out += v[1] if v[0] == "str" else v[1]
                    except Unres as why:
                        if not _guarded(src, inner, pos):
                            raise Unres(f"dynamic segment `${{{inner}}}` without a verified guard ({why})")
                        out += f"\x00{inner}\x00"
                else:
                    v = evaluate(src, inner, pos, depth + 1)
                    out += v[1]
                i = j + 1
            else:
                out += body[i]; i += 1
        return ("str", _lit(out))
    if e == "import.meta.url":
        return ("url", posixpath.join(APP, src.rel))
    if e in ("__dirname",):
        return ("str", src.file_dir_abs)
    if e in ("__filename",):
        return ("str", posixpath.join(APP, src.rel))
    if re.fullmatch(r"process\.cwd\(\s*\)", e):
        if not src.project.cwd_rule:
            raise Unres("process.cwd() — entrypoint cwd rule not verified")
        return ("str", src.pkg_abs)
    m = re.fullmatch(r"(.+)\.(pathname|href)", e, re.S)
    if m:
        v = evaluate(src, m.group(1), pos, depth + 1)
        if v[0] != "url":
            raise Unres(f".{m.group(2)} on a non-URL")
        return ("str", v[1]) if m.group(2) == "pathname" else v
    m = re.fullmatch(r"new\s+URL\s*\((.*)\)", e, re.S)
    if m and _match_close(code, code.index("(")) == len(e) - 1:
        args = split_top(m.group(1), ",")
        if len(args) != 2:
            raise Unres("new URL without a file base")
        rel, base = evaluate(src, args[0], pos, depth + 1), evaluate(src, args[1], pos, depth + 1)
        if rel[0] != "str" or base[0] != "url":
            raise Unres("new URL(non-string, non-URL)")
        if rel[1].startswith(("file://", "http:", "https:")):
            raise Unres("absolute URL")
        target = rel[1] if rel[1].startswith("/") else posixpath.join(posixpath.dirname(base[1]), rel[1])
        trail = "/" if rel[1].endswith("/") else ""
        return ("url", posixpath.normpath(target) + trail)
    m = re.fullmatch(r"([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\s*\((.*)\)", e, re.S)
    if m and _match_close(code, code.index("(")) == len(e) - 1:
        head, member, argtext = m.group(1), m.group(2), m.group(3)
        fn = member if member else head
        mod = src.imports.get(head, (None,))[0]
        if member and src.imports.get(head, (None, None))[1] not in ("*", "default"):
            raise Unres(f"call {head}.{member}()")
        if not member and src.imports.get(head, (None, None))[1] != fn:
            raise Unres(f"call {head}() not imported from node:path/node:url")
        args = [a for a in split_top(argtext, ",") if a]
        if mod in URL_MODULES and fn == "fileURLToPath" and len(args) == 1:
            v = evaluate(src, args[0], pos, depth + 1)
            if v[0] == "url": return ("str", v[1])
            if v[1].startswith("file://"): return ("str", v[1][7:])
            raise Unres("fileURLToPath of a non-URL")
        if mod in PATH_MODULES and fn in ("join", "resolve", "dirname"):
            vals = [evaluate(src, a, pos, depth + 1) for a in args]
            if any(v[0] != "str" for v in vals):
                raise Unres(f"{fn}() of a URL")
            segs = [v[1] for v in vals]
            if fn == "dirname" and len(segs) == 1:
                return ("str", posixpath.dirname(segs[0].rstrip("/")))
            if fn == "join" and segs:
                return ("str", posixpath.normpath(posixpath.join(*segs)) + ("/" if segs[-1].endswith("/") else ""))
            if fn == "resolve" and segs:
                if not segs[0].startswith("/"):
                    if not src.project.cwd_rule:
                        raise Unres("resolve() from cwd — entrypoint cwd rule not verified")
                    segs = [src.pkg_abs] + segs
                return ("str", posixpath.normpath(posixpath.join(*segs)))
        raise Unres(f"call {head}{'.' + member if member else ''}()")
    if _IDENT.fullmatch(e):
        if e in src.imports:
            mod, name = src.imports[e]
            if mod.startswith("."):
                other = src.project.resolve_module(src, mod)
                if other is None or name in ("*", "default"):
                    raise Unres(f"`{e}` imported from {mod}")
                if not re.search(rf"export\s+const\s+{re.escape(name)}\b", other.code):
                    raise Unres(f"`{name}` is not an exported const of {other.rel}")
                return evaluate(other, _const_init(other, name), len(other.code), depth + 1)
            raise Unres(f"`{e}` imported from {mod}")
        param = _enclosing_param(src, e, pos)
        if param:
            fname, idx, default = param
            if default is None:
                raise Unres(f"parameter `{e}` of {fname}")
            why = _callers_pass(src.project, fname, idx, src)
            if why:
                raise Unres(f"parameter `{e}` default overridable: {why}")
            return evaluate(src, default, pos, depth + 1)
        return evaluate(src, _const_init(src, e), pos, depth + 1)
    raise Unres(f"unsupported expression `{norm_text(e)[:60]}`")


def classify(src: Source, value) -> str:
    """Absolute value → target string; relative paths resolve against the package dir."""
    p = value[1]
    if p.startswith("file://"):
        p = p[7:]
    if not p.startswith("/"):
        if not src.project.cwd_rule:
            raise Unres("relative path — entrypoint cwd rule not verified")
        p = posixpath.join(src.pkg_abs, p)
    if "\x00" in p:
        head = p.split("\x00", 1)[0]
        d = head if head.endswith("/") else posixpath.dirname(head) + "/"
        d = posixpath.normpath(d) + "/"
        if d == APP + "/" or d.startswith(APP + "/"):
            return "prefix:" + d[len(APP) + 1:]
        return "external:" + d
    trail = "/" if p.endswith("/") else ""
    p = posixpath.normpath(p)
    if p == APP or p.startswith(APP + "/"):
        rel = p[len(APP) + 1:]
        if rel.startswith(".."):
            return "external:" + p
        return "repo:" + rel + trail
    return "external:" + p


# ---------------------------------------------------------------- calls ----

def fs_calls(src: Source) -> tuple[list[dict], list[str]]:
    """Every call of an imported fs function, with its argument text and target."""
    calls, errs = [], []
    locals_ = {loc: (mod, name) for loc, (mod, name) in src.imports.items() if mod in FS_MODULES}
    for loc, (mod, name) in locals_.items():
        for m in re.finditer(rf"(?<![\w$.]){re.escape(loc)}(?![\w$])", src.code):
            if src.in_import(m.start()):
                continue
            rest = src.code[m.end():]
            if name in ("*", "default"):
                mm = re.match(r"((?:\.[A-Za-z_$][\w$]*)+)\s*\(", rest)
                if not mm:
                    errs.append(f"{src.rel}: fs namespace `{loc}` used other than as `{loc}.fn(...)`")
                    continue
                fn = mm.group(1).split(".")[-1]
                o = m.end() + mm.end() - 1
            else:
                mm = re.match(r"\s*\(", rest)
                if not mm:
                    errs.append(f"{src.rel}: fs binding `{loc}` used other than as a direct call (aliasing hides its target)")
                    continue
                fn = name
                o = m.end() + mm.end() - 1
            c = _match_close(src.code, o)
            args = [a for a in split_top(src.text[o + 1:c], ",") if a]
            base = fn[:-4] if fn.endswith("Sync") else fn
            argtext = norm_text(", ".join(args))
            if base in WRITE_OPS or (base == "open" and len(args) > 1 and args[1].strip("'\"") in WRITE_FLAGS):
                target = "write"
            elif not args:
                target = "unresolved"
            else:
                try:
                    target = classify(src, evaluate(src, args[0], m.start()))
                except Unres as e:
                    target = f"unresolved ({e})"
            calls.append({"pos": m.start(), "call": fn, "arg": argtext, "target": target})
    calls.sort(key=lambda x: x["pos"])
    for spec in FS_MODULES:
        for m in re.finditer(rf"""["']{re.escape(spec)}["']""", src.text):
            if not src.in_import(m.start()):
                errs.append(f"{src.rel}: fs module {spec!r} named outside a static import (dynamic import / require / re-export)")
    for m in _IMPORT.finditer(src.text):
        if m.group("mod").removeprefix("node:") in BANNED_MODULES:
            errs.append(f"{src.rel}: imports {m.group('mod')} — I/O the planner cannot see")
    if re.search(r"\bexport\s*(?:\*|\{[^}]*\})\s*from\s*[\"'](?:node:)?fs", src.text):
        errs.append(f"{src.rel}: re-exports an fs module")
    if re.search(r"\bprocess\s*\.\s*(?:getBuiltinModule|binding)\b", src.code):
        errs.append(f"{src.rel}: process.getBuiltinModule/binding — hidden module access")
    return calls, errs


def fingerprint(calls: list[dict]) -> list[str]:
    return [f"{c['call']}({c['arg']}) → {c['target']}" for c in calls]


def _join_escapes(src: str, file_dir: str, pkg: str) -> list[str]:
    out = []
    for m in re.finditer(r"\b(?:join|resolve)\(", src):
        i, depth = m.end(), 1
        while i < len(src) and depth:
            depth += {"(": 1, ")": -1}.get(src[i], 0)
            i += 1
        args = src[m.end(): i - 1]
        ups = len(re.findall(r"""["']\.\.["']""", args))
        if not ups:
            continue
        here = file_dir if "import.meta" in args or "__dirname" in args else pkg
        target = _norm(os.path.join(here, *([".."] * ups)))
        if not _inside(target, pkg):
            out.append(target + "/")
    return out


def out_of_package_paths(src: str, rel: str, pkg: str) -> list[list[str]]:
    """Backstop: escaping path literals anywhere in code → candidate repo paths."""
    file_dir = os.path.dirname(rel)
    found = []
    for m in _STR.finditer(src):
        s = m.group("s").split("${", 1)[0]
        if not s or "\n" in s:
            continue
        if s.startswith(APP + "/"):
            found.append([_norm(s[len(APP) + 1:])])
        elif "../" in s or s == "..":
            rest = s[s.index(".."):]
            cands = [_norm(os.path.join(file_dir, rest)), _norm(os.path.join(pkg, rest))]
            outside = [c for c in cands if not _inside(c, pkg) and not c.startswith("..")]
            if outside and all(not _inside(c, pkg) for c in cands):
                found.append(outside)
        elif s.startswith(REPO_TOPS) and re.fullmatch(r"[\w./@-]+", s) and "/" in s.rstrip("/"):
            found.append([_norm(s)])
    for t in _join_escapes(src, file_dir, pkg):
        found.append([t.rstrip("/")])
    return found


def _covers(read: str, path: str) -> bool:
    r0, p0 = read.rstrip("/"), path.rstrip("/")
    return p0 == r0 or p0.startswith(r0 + "/")


def load_registry(text: str | None) -> dict:
    if text is None:
        raise ValueError("runtime-reads.json missing")
    reg = json.loads(text)
    if not isinstance(reg.get("files"), dict):
        raise ValueError("runtime-reads.json has no `files` object")
    return reg


def _delegate_values(project: Project, home: str, param: str) -> list[tuple[Source, str, int]]:
    out = []
    for rel, s in project.sources.items():
        if rel == home:
            continue
        for m in re.finditer(rf"(?<![\w$.]){re.escape(param)}\s*:(?!:)", s.code):
            k = m.end()
            depth = 0
            while k < len(s.code):
                ch = s.code[k]
                if ch in "([{": depth += 1
                elif ch in ")]}":
                    if depth == 0: break
                    depth -= 1
                elif ch in ",;" and depth == 0: break
                k += 1
            val = s.text[m.end():k].strip()
            if re.fullmatch(r"(?:readonly\s+)?string\b.*|\w+\[\]", val):
                continue                                   # a type annotation, not a value
            out.append((s, val, m.start()))
        for m in re.finditer(rf"[{{,]\s*{re.escape(param)}\s*(?=[,}}])", s.code):
            out.append((s, param, m.start()))
    return out


def analyse(root: str) -> tuple[Project, dict[str, dict]]:
    project = Project(root)
    facts = {}
    for rel, s in project.sources.items():
        calls, errs = fs_calls(s)
        facts[rel] = {"calls": calls, "errs": errs, "paths": out_of_package_paths(s.text, rel, s.pkg)}
    return project, facts


def audit(root: str, registry: dict) -> list[str]:
    errs: list[str] = []
    files = registry["files"]
    project, facts = analyse(root)
    if not project.cwd_rule:
        errs.append(f"scripts/container/entrypoint.sh no longer contains {CWD_RULE!r} — relative runtime paths cannot be resolved")
    uses: dict[str, list[str]] = {}
    for rel, f in facts.items():
        s = project.sources[rel]
        errs += f["errs"]
        for spec in _REL_SPEC.findall(s.text):
            if not _inside(_norm(os.path.join(os.path.dirname(rel), spec)), s.pkg):
                errs.append(f"{rel}: relative import {spec!r} leaves package {s.pkg}")
        if _DYNAMIC.search(s.text):
            errs.append(f"{rel}: non-literal dynamic import/require or resolve/glob — the planner cannot see its target")
        calls, paths, entry = f["calls"], f["paths"], files.get(rel)
        if not calls and not paths:
            if entry is not None:
                errs.append(f"{rel}: registered in runtime-reads.json but no longer uses fs or out-of-package paths — remove the entry")
            continue
        fp = fingerprint(calls)
        if entry is None:
            errs.append(f"{rel}: runtime fs use {fp} / out-of-package paths {[p[0] for p in paths]} not registered in scripts/deploy/runtime-reads.json")
            continue
        if entry.get("calls") != fp:
            errs.append(f"{rel}: fs calls changed (registered {entry.get('calls')} · measured {fp}) — re-review its runtime reads")
        reads = entry.get("reads") or []
        used = uses.setdefault(rel, [])
        declared_unres = {u.get("call") for u in entry.get("unresolved") or []}
        delegated = set(entry.get("delegated") or [])
        for c in calls:
            t = c["target"]
            if t == "write":
                continue
            if t.startswith("unresolved"):
                pm = re.search(r"parameter `([\w$]+)`", t)
                if pm and pm.group(1) in delegated:
                    for caller, val, pos in _delegate_values(project, rel, pm.group(1)):
                        try:
                            ct = classify(caller, evaluate(caller, val, pos))
                        except Unres as e:
                            errs.append(f"{caller.rel}: value of delegated `{pm.group(1)}` ({norm_text(val)[:60]}) unresolved: {e}")
                            continue
                        if ct.startswith(("repo:", "prefix:")):
                            p = ct.split(":", 1)[1]
                            if not _inside(p.rstrip("/"), caller.pkg):
                                creads = (files.get(caller.rel) or {}).get("reads") or []
                                if not any(_covers(r, p) for r in creads):
                                    errs.append(f"{caller.rel}: delegated `{pm.group(1)}` → {ct} outside its package and not in its registered reads")
                                else:
                                    uses.setdefault(caller.rel, []).append(p)
                        elif ct.startswith("external:"):
                            errs.append(f"{caller.rel}: delegated `{pm.group(1)}` → {ct}: register it on the caller")
                    continue
                if c["call"] not in declared_unres:
                    errs.append(f"{rel}: {c['call']}({c['arg']}) target cannot be resolved — {t}; declare it under `unresolved` (its services always deploy) or make it resolvable")
                continue
            kind, p = t.split(":", 1)
            if kind == "external":
                if p not in (entry.get("external") or []):
                    errs.append(f"{rel}: reads {p} outside the repository — not declared under `external`")
                continue
            if _inside(p.rstrip("/"), s.pkg):
                continue
            if not any(_covers(r, p) for r in reads):
                errs.append(f"{rel}: {c['call']}({c['arg']}) → {t} outside {s.pkg} and not covered by registered reads {reads}")
            used.append(p)
        for cands in paths:
            hit = [r for r in reads for cnd in cands if _covers(r, cnd) or _covers(cnd, r)]
            if not hit:
                errs.append(f"{rel}: out-of-package path {cands[0]!r} not covered by registered reads {reads}")
            used.extend(hit)
        if not str(entry.get("why", "")).strip():
            errs.append(f"{rel}: registration has no `why`")
        for u in entry.get("unresolved") or []:
            if not any(c["call"] == u.get("call") and c["target"].startswith("unresolved") for c in calls):
                errs.append(f"{rel}: declared unresolved {u.get('call')} no longer unresolved — remove it")
    for rel, entry in files.items():
        if rel not in project.sources:
            errs.append(f"{rel}: registered file does not exist or is not runtime code")
            continue
        for r in entry.get("reads") or []:
            if not os.path.exists(os.path.join(root, r.rstrip("/"))):
                errs.append(f"{rel}: registered read {r!r} does not exist")
            elif not any(_covers(r, p) or _covers(p, r) for p in uses.get(rel, [])):
                errs.append(f"{rel}: registered read {r!r} is not used by any resolved target or path literal — stale registration")
    for pkg in project.pkgs:
        try:
            start = (json.load(open(os.path.join(root, pkg, "package.json"))).get("scripts") or {}).get("start", "")
        except (OSError, json.JSONDecodeError):
            continue
        if re.search(r"(?:^|[\s=\"'])(?:\.\./|/app/|(?:%s))" % "|".join(re.escape(t) for t in REPO_TOPS), start):
            errs.append(f"{pkg}/package.json: start script names a path outside the package: {start!r}")
    return errs


def extra_inputs(registry: dict, closure_dirs: list[str]) -> list[str]:
    """Declared runtime reads of every registered file inside the closure."""
    out: set[str] = set()
    for rel, entry in registry["files"].items():
        if any(rel.startswith(d if d.endswith("/") else d + "/") for d in closure_dirs):
            out.update(entry.get("reads") or [])
    return sorted(out)


def unresolved_in(registry: dict, closure_dirs: list[str]) -> list[str]:
    """Registered files inside the closure with a declared unresolved read (→ deploy)."""
    return sorted(rel for rel, entry in registry["files"].items()
                  if entry.get("unresolved") and any(rel.startswith(d if d.endswith("/") else d + "/") for d in closure_dirs))
