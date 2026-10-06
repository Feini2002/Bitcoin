"""Offline SQL counterexamples. VM/runtime here is not Cloudflare D1 billing."""
import json
import pathlib
import sqlite3
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SQL = json.loads((HERE / 'remote-select-probe.json').read_text(encoding='utf8'))['results']
PARAMS = json.loads((HERE / 'queries.json').read_text(encoding='utf8'))
DEADLINE = time.monotonic() + 20
CANONICAL = {
    'empty': [],
    'receipt_only': [('1791203400000', 'receipt', 'a', 'target')],
    'non_numeric_only': [('no-time', 'unknown', 'a', 'target')],
    'date_key': [('2026-10-04', 'day', 'a', 'target')],
    'seconds_key': [('1791203487', 'second', 'a', 'target')],
    'milliseconds_key': [('1791203400000', 'millisecond', 'a', 'target')],
    'digit_prefix': [('1791203400000suffix', 'unknown', 'a', 'target')],
    'multiple_versions': [('1791203400000', 'millisecond', x, 'target') for x in ['a', 'b', 'c']],
    'later_history': [('1791203400000', 'millisecond', 'a', 'target'), ('1791203700000', 'millisecond', 'a', 'target')],
    'foreign_dataset': [('1791209999999', 'millisecond', 'a', 'foreign')],
}
RAW = {
    'empty': [],
    'one': [('BTCUSDT', '5m', 1791203400000)],
    'later_history': [('BTCUSDT', '5m', 1791203400000), ('BTCUSDT', '5m', 1791203700000)],
    'foreign_interval': [('BTCUSDT', '1h', 1791209999999)],
    'foreign_symbol': [('ETHUSDT', '5m', 1791209999999)],
}


def trial(kind, variant, fixture, state, rollback):
    db = sqlite3.connect(':memory:')
    db.set_progress_handler(lambda: int(time.monotonic() > DEADLINE), 100)
    db.executescript((ROOT / 'cloudflare/finance/dataset-schema.sql').read_text(encoding='utf8'))
    db.execute(PARAMS['ddl'])
    db.execute('CREATE TABLE klines(symbol TEXT,interval TEXT,t INTEGER,PRIMARY KEY(symbol,interval,t))')
    baseline = [('BTCUSDT', '5m', 1700000900000, 7)] if state else []
    db.executemany('INSERT INTO desk_history_state VALUES(?,?,?,?)', baseline)
    if kind == 'canonical':
        for key, precision, receipt, dataset in fixture:
            dataset_id = 'binance-perp-klines-5m' if dataset == 'target' else 'foreign'
            db.execute('INSERT INTO finance_dataset_observations VALUES(?,?,NULL,?,?,?,\'fixture.invalid\',\'cloud-ws\',NULL,\'{}\')', (dataset_id, key, precision, receipt, receipt))
    else:
        db.executemany('INSERT INTO klines VALUES(?,?,?)', fixture)
    db.commit()
    db.execute('BEGIN')
    query = next(q['sql'] for q in SQL if q['key'] == kind and q['variant'] == variant)
    db.execute(query, PARAMS[kind]['params'])
    inside = db.execute('SELECT * FROM desk_history_state').fetchall()
    if rollback:
        try:
            db.execute("INSERT INTO desk_history_state VALUES(NULL,'5m',1,0)")
        except sqlite3.IntegrityError:
            db.rollback()
        else:
            raise AssertionError('expected real NOT NULL constraint failure')
    else:
        db.commit()
    after = db.execute('SELECT * FROM desk_history_state').fetchall()
    if rollback:
        assert after == baseline
    if state:
        assert inside == baseline
    db.close()
    return dict(inside=inside, after=after)


results = []
for kind, fixtures in [('canonical', CANONICAL), ('raw', RAW)]:
    for name, fixture in fixtures.items():
        for state in [False, True]:
            for rollback in [False, True]:
                old = trial(kind, 'original', fixture, state, rollback)
                new = trial(kind, 'candidate-case', fixture, state, rollback)
                assert old == new, (kind, name, state, rollback, old, new)
                results.append(dict(kind=kind, fixture=name, fixtureRows=fixture, stateExists=state, rollback=rollback, result='PASS', **new))

report = dict(sqliteVersion=sqlite3.sqlite_version, cases=len(results), scope='60 synthetic single-connection SQL equivalence/rollback cases. Date/second/prefix tests preserve existing P1 SQL semantics; they do not endorse these as typed Kline inputs. No remote calls, no D1 concurrency or billed row measurement.', results=results)
(HERE / 'adversarial-equivalence-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(dict(result='PASS', cases=len(results), scope=report['scope'])))
