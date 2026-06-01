import datetime, json, urllib.request
from pyxlsb import open_workbook

SRC = '/Users/fahdnaveed/Downloads/Up to 31-05-2026  - NEW - Copy.xlsb'
URL = 'https://ymoewukjsrbggchqzfbc.supabase.co/rest/v1/stock'
KEY = 'sb_publishable_ziyCxVbFtRqjUaGmBocFOA_FkmxYmIz'
EPOCH = datetime.date(1899, 12, 30)

def d(v):
    if not isinstance(v, (int, float)): return None
    try:
        dt = EPOCH + datetime.timedelta(days=int(v))
        if dt.year < 2018 or dt.year > 2030: return None  # guard junk serials
        return dt.isoformat()
    except Exception:
        return None
def n(v):
    return round(float(v), 4) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
def t(v):
    if v is None: return None
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    s = str(v).strip()
    return s or None

rows = []
with open_workbook(SRC) as wb:
    with wb.get_sheet('Source') as ws:
        for r, row in enumerate(ws.rows()):
            if r == 0: continue
            v = [c.v for c in row]
            g = lambda i: v[i] if i < len(v) else None
            item = t(g(2))
            tot = n(g(15)); cases = n(g(11))
            if not item: continue
            if not ((tot and tot > 0) or (cases and cases > 0)): continue  # real stock only
            rows.append(dict(
                pallet_no=t(g(0)), prod_date=d(g(1)), item=item, grade=t(g(3)),
                brand=t(g(4)), b_count=n(g(5)), glaze_grp=t(g(6)), a_glaze=n(g(7)),
                a_count=n(g(8)), packing=t(g(9)), wt_per_case_kg=n(g(10)),
                cases=cases, loose=n(g(12)), location=t(g(13)), rack=t(g(14)),
                total_qty=tot, source_row=r + 1,
            ))

def req(method, body=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json',
         'Prefer': 'return=minimal'}
    data = json.dumps(body).encode() if body is not None else None
    u = URL if method != 'DELETE' else URL + '?source_row=gte.0'
    rq = urllib.request.Request(u, data=data, headers=h, method=method)
    with urllib.request.urlopen(rq) as resp:
        return resp.status

print('delete existing:', req('DELETE'))
for i in range(0, len(rows), 200):
    b = rows[i:i+200]
    print(f'  batch {i//200+1}: {len(b)} -> {req("POST", b)}')
print('migrated', len(rows), 'stock rows;',
      'total kg', round(sum(x['total_qty'] or 0 for x in rows)),
      '; cases', round(sum(x['cases'] or 0 for x in rows)),
      '; items', len(set(x['item'] for x in rows)))
