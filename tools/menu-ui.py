# Extrae los textos fijos en inglés de la moza (T('es','en','pt') en menu.html) -> api/menu-ui.json
# Correr de nuevo si se agregan textos: python3 tools/menu-ui.py
import re, json, os
R = os.path.join(os.path.dirname(__file__), '..')
s = open(os.path.join(R, 'menu.html'), encoding='utf-8').read()
a, b = s.index('async function mesa()'), s.index('function caja(') if 'function caja(' in s else len(s)
s = s[a:]
def lit(src, i):
    q = src[i]; j = i + 1; out = ''
    while src[j] != q:
        if src[j] == '\\': out += {'n': '\n', 't': '\t'}.get(src[j+1], src[j+1]); j += 2; continue
        if q == '`' and src[j:j+2] == '${': return None, j
        out += src[j]; j += 1
    return out, j + 1
def args(src, i):
    res, depth, cur, j = [], 0, i, i
    while True:
        c = src[j]
        if c in '\'"`':
            q = c; j += 1
            while src[j] != q:
                if src[j] == '\\': j += 1
                elif q == '`' and src[j:j+2] == '${':
                    d = 1; j += 2
                    while d:
                        if src[j] == '{': d += 1
                        elif src[j] == '}': d -= 1
                        j += 1
                    continue
                j += 1
            j += 1; continue
        if c in '([{': depth += 1
        elif c in ')]}':
            if depth == 0: res.append(src[cur:j].strip()); return res
            depth -= 1
        elif c == ',' and depth == 0: res.append(src[cur:j].strip()); cur = j + 1
        j += 1
S = []
def add(x):
    if x and re.search(r'[A-Za-z]', x) and x not in S: S.append(x)
for m in re.finditer(r'(?<![\w.$])T\(', s):
    try: A = args(s, m.end())
    except Exception: continue
    if len(A) < 2: continue
    e = A[1]
    if e and e[0] in '\'"`':
        v, end = lit(e, 0)
        if v is not None and end == len(e): add(v)
    elif e.startswith('['):
        for mm in re.finditer(r"'((?:[^'\\]|\\.)*)'", e): add(mm.group(1).replace("\\'", "'"))
# palabras de los lugares (table, machine…)
for w in ['table', 'machine', 'room', 'umbrella', 'seat']: add(w)
json.dump(S, open(os.path.join(R, 'api', 'menu-ui.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(S))
