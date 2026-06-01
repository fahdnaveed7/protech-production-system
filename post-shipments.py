import openpyxl, datetime, json, urllib.request

SRC = '/Users/fahdnaveed/Downloads/MAY SHIPMENT  PROJECTIONS.xlsm'
BASE = 'https://ymoewukjsrbggchqzfbc.supabase.co/rest/v1/'
KEY = 'sb_publishable_ziyCxVbFtRqjUaGmBocFOA_FkmxYmIz'

def n(v):
    return round(float(v), 4) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
def t(v):
    if v is None: return None
    if isinstance(v, datetime.datetime): return v.isoformat()
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    s = str(v).strip()
    return s or None
def iv(v):  # integer or None
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
def country_of(dest):
    if not dest: return None
    parts = [p.strip() for p in str(dest).replace('\n', ' ').split(',') if p.strip()]
    return parts[-1] if parts else None

wb = openpyxl.load_workbook(SRC, data_only=True, read_only=True)

# column maps per shape -------------------------------------------------
# readiness sheets: header fields + cartons/ready/short per grade line
READINESS = {  # sheet -> dict of col indices (account for the +1 shift on SHIPPED)
    'MAY PROJECTIONS': dict(sl=0, pi=1, po=2, proc=3, agent=4, buyer=5, dest=6, ship=None,
        desc=7, pack=8, grade=9, cartons=10, ready=11, short=12, req=13, alloc=14,
        rem=15, sell=16, status='projected'),
    'SHIPPED': dict(sl=0, pi=1, po=2, proc=3, agent=4, buyer=5, dest=6, ship=7,
        desc=8, pack=9, grade=10, cartons=11, ready=12, short=13, req=14, alloc=15,
        rem=16, sell=17, status='shipped'),
}
# order-book sheets: identical layout, RATE + AMOUNT USD
ORDERBOOK = {
    'RECENT PENDING ORDERS': 'pending',
    'SHIPPED DTLS': 'shipped',
}
OB = dict(sl=0, pi=1, po=2, proc=3, ship=4, agent=5, buyer=6, dest=7,
          desc=8, pack=9, grade=10, cases=11, rate=12, amt=13, sell=14, rem=15)

shipments, lines = [], []   # lines carry _key = index into shipments

def add_ship(d):
    shipments.append(d); return len(shipments) - 1

def rows_of(sheet):
    return list(wb[sheet].iter_rows(values_only=True))

def looks_year(v):
    s = (t(v) or '')
    return ('FULL' in s.upper()) or (len(s) >= 7 and s[:4].isdigit() and '-' in s[:8])

# ---- parse readiness sheets ----
for sheet, c in READINESS.items():
    fy = None; cur = None; cur_desc = None; cur_pack = None; ln = 0
    for r, row in enumerate(rows_of(sheet)):
        if r == 0: continue
        g = lambda i: row[i] if (i is not None and i < len(row)) else None
        sl = g(c['sl'])
        if isinstance(sl, str) and looks_year(sl):
            fy = t(sl); continue
        if iv(sl) is not None:  # new header
            cur = add_ship(dict(
                sl_no=iv(sl), pi_no=t(g(c['pi'])), po_no=t(g(c['po'])), processed_by=t(g(c['proc'])),
                agent=t(g(c['agent'])), buyer=t(g(c['buyer'])), destination=t(g(c['dest'])),
                country=country_of(g(c['dest'])), ship_date_text=t(g(c['ship'])),
                status=c['status'], fiscal_year=fy, amount_usd=None,
                source_sheet=sheet, source_row=r + 1))
            cur_desc = t(g(c['desc'])); cur_pack = t(g(c['pack'])); ln = 0
        if cur is None: continue
        d = t(g(c['desc']));  cur_desc = d or cur_desc
        p = t(g(c['pack']));  cur_pack = p or cur_pack
        grade = t(g(c['grade']))
        cartons = n(g(c['cartons'])); ready = n(g(c['ready'])); short = n(g(c['short']))
        if not grade and cartons is None and ready is None: continue  # nothing on this line
        ln += 1
        lines.append(dict(_key=cur, line_no=ln, description=cur_desc, packing=cur_pack,
            grade_size=grade, cartons_required=cartons, ready_cases=ready, short=short,
            req_qty=n(g(c['req'])), order_allocation=t(g(c['alloc'])), num_cases=None,
            rate=None, line_amount_usd=None, selling_rate=t(g(c['sell'])),
            remarks=t(g(c['rem'])), source_row=r + 1))

# ---- parse order-book sheets ----
for sheet, status in ORDERBOOK.items():
    fy = None; cur = None; cur_desc = None; cur_pack = None; ln = 0
    for r, row in enumerate(rows_of(sheet)):
        if r == 0: continue
        g = lambda i: row[i] if i < len(row) else None
        sl = g(OB['sl'])
        if isinstance(sl, str) and looks_year(sl):
            fy = t(sl); continue
        if iv(sl) is not None:
            cur = add_ship(dict(
                sl_no=iv(sl), pi_no=t(g(OB['pi'])), po_no=t(g(OB['po'])), processed_by=t(g(OB['proc'])),
                agent=t(g(OB['agent'])), buyer=t(g(OB['buyer'])), destination=t(g(OB['dest'])),
                country=country_of(g(OB['dest'])), ship_date_text=t(g(OB['ship'])),
                status=status, fiscal_year=fy, amount_usd=n(g(OB['amt'])),
                source_sheet=sheet, source_row=r + 1))
            cur_desc = t(g(OB['desc'])); cur_pack = t(g(OB['pack'])); ln = 0
        if cur is None: continue
        d = t(g(OB['desc'])); cur_desc = d or cur_desc
        p = t(g(OB['pack'])); cur_pack = p or cur_pack
        grade = t(g(OB['grade'])); cases = n(g(OB['cases'])); rate = n(g(OB['rate']))
        if not grade and cases is None and rate is None: continue
        ln += 1
        lines.append(dict(_key=cur, line_no=ln, description=cur_desc, packing=cur_pack,
            grade_size=grade, cartons_required=None, ready_cases=None, short=None,
            req_qty=None, order_allocation=None, num_cases=cases, rate=rate,
            line_amount_usd=n(g(OB['amt'])), selling_rate=t(g(OB['sell'])),
            remarks=None, source_row=r + 1))

# ---- REST helpers ----
def req(table, method, body=None, prefer='return=minimal', q=''):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': prefer}
    data = json.dumps(body).encode() if body is not None else None
    rq = urllib.request.Request(BASE + table + q, data=data, headers=h, method=method)
    with urllib.request.urlopen(rq) as resp:
        return resp.status, resp.read().decode()

# wipe (lines cascade on shipments delete)
print('delete lines:', req('shipment_lines', 'DELETE', q='?source_row=gte.0')[0])
print('delete shipments:', req('shipments', 'DELETE', q='?source_row=gte.0')[0])

# insert shipments WITH return=representation to get ids back, batched
ids = [None] * len(shipments)
B = 100
for i in range(0, len(shipments), B):
    batch = shipments[i:i+B]
    st, body = req('shipments', 'POST', batch, prefer='return=representation')
    got = json.loads(body)
    # PostgREST returns rows in insertion order
    for j, rowj in enumerate(got):
        ids[i + j] = rowj['id']
    print(f'  shipments batch {i//B+1}: {len(batch)} -> {st}')

# attach shipment_id to lines, then insert
out = []
for l in lines:
    sid = ids[l.pop('_key')]
    l['shipment_id'] = sid
    out.append(l)
for i in range(0, len(out), 200):
    batch = out[i:i+200]
    st, _ = req('shipment_lines', 'POST', batch)
    print(f'  lines batch {i//200+1}: {len(batch)} -> {st}')

from collections import Counter
sc = Counter(s['status'] for s in shipments)
print('shipments', len(shipments), dict(sc), '| lines', len(out))
print('pending USD', round(sum(s['amount_usd'] or 0 for s in shipments if s['status'] == 'pending')))
print('shipped USD', round(sum(s['amount_usd'] or 0 for s in shipments if s['status'] == 'shipped')))
print('buyers', len(set(s['buyer'] for s in shipments if s['buyer'])))
