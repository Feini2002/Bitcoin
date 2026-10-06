"""Independent SQLite VM measurement. VM steps are NOT D1 billed rows."""
import json, sqlite3, sys, time
manifest=json.load(open(sys.argv[1],encoding='utf-8'))
result={'engine':sqlite3.sqlite_version,'measurement':'SQLite VM steps; not D1 rows_read','cases':[]}
deadline=time.monotonic()+25
for case in manifest['cases']:
    db=sqlite3.connect(':memory:'); db.executescript(manifest['schema'])
    measured=[]
    for bi,batch in enumerate(case['batches']):
        steps=[0]
        def tick():
            steps[0]+=1
            return 1 if time.monotonic()>deadline or steps[0]>30000000 else 0
        if bi: db.set_progress_handler(tick,1)
        db.execute('BEGIN')
        for q in batch: db.execute(q['sql'],q['params']).fetchall()
        db.commit();db.set_progress_handler(None,0)
        measured.append(steps[0])
    result['cases'].append({'H':case['H'],'V':case['V'],'initVmSteps':measured[1:7],'commitVmSteps':sum(measured[7:])})
    db.close()
print(json.dumps(result))
