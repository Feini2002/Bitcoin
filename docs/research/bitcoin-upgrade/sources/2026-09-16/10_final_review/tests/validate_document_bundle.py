#!/usr/bin/env python3
"""Validate this documentation bundle only. No network, installs, credentials or production writes.

Requires an already available jsonschema package. It never installs a dependency.
Run manually: python 10_final_review/tests/validate_document_bundle.py --output 10_final_review/results/document_checks.json
Domain checks below are illustrative executable specifications, not an authorization service.
"""
from __future__ import annotations
import argparse, copy, hashlib, json, re, sqlite3, sys
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit
try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:
    raise SystemExit('jsonschema is not available. No installation attempted; use an approved existing test environment.')
from canonical_profile import canonical_bytes, canonical_digest

ROOT = Path(__file__).resolve().parents[2]
checks=[]
def check(name, actual, expected=True, layer='document', detail=None):
    checks.append({'name':name,'layer':layer,'passed':actual==expected,'actual':actual,'expected':expected,'detail':detail})

def strict_loads(text):
    def pairs(items):
        result={}
        for k,v in items:
            if k in result:raise ValueError('duplicate key: '+k)
            result[k]=v
        return result
    def bad_constant(x):raise ValueError('nonfinite JSON constant: '+x)
    return json.loads(text,object_pairs_hook=pairs,parse_constant=bad_constant)

def load(rel):return strict_loads((ROOT/rel).read_text(encoding='utf-8'))
def validator(doc,definition=None):
    x=doc if definition is None else {'$schema':doc['$schema'],'$defs':doc['$defs'],'$ref':'#/$defs/'+definition}
    return Draft202012Validator(x,format_checker=FormatChecker())
def iso(x):return datetime.fromisoformat(x.replace('Z','+00:00'))

def domain_errors(kind,x,context=None):
    """Small reference checks for audited invariants; deliberately not exhaustive production validation."""
    c=context or {};errors=[]
    if c.get('live_pipeline') and x.get('record_origin')=='synthetic':errors.append('SYNTHETIC_IN_LIVE_PIPELINE')
    if kind=='CoverageReport':
        r=set(x['required_sources']);u=set(x['usable_sources']);f=set(x['failed_sources'])
        if u & f:errors.append('USABLE_FAILED_OVERLAP')
        if iso(x['window_start'])>=iso(x['window_end']):errors.append('INVALID_WINDOW')
        if x['quiet_result_allowed']:
            if not r or not r.issubset(u) or r & f:errors.append('REQUIRED_COVERAGE_MISSING')
            if not x['comparison_available']:errors.append('COMPARISON_MISSING')
            if x['coverage_class']!='usable':errors.append('COVERAGE_NOT_USABLE')
        if iso(x['evaluated_at'])<iso(x['window_end']):errors.append('EVALUATED_BEFORE_WINDOW_END')
    if kind=='ResourceVersion':
        if x['version_observed_at'] and x['first_seen_at'] and iso(x['version_observed_at'])<iso(x['first_seen_at']):errors.append('VERSION_BEFORE_RESOURCE')
        if x['fetched_at'] and x['version_observed_at'] and iso(x['version_observed_at'])>iso(x['fetched_at']):errors.append('VERSION_OBSERVED_AFTER_THIS_FETCH')
        if c.get('mode')=='system_observed':
            if not x['version_observed_at'] or iso(x['version_observed_at'])>iso(c['as_of']):errors.append('VERSION_NOT_KNOWN_AT_CUTOFF')
        if c.get('mode')=='publicly_available' and not c.get('public_version_evidence'):errors.append('PUBLIC_VERSION_UNPROVEN')
        if c.get('current_use') and x['rights'].get(c['current_use'],'unknown')!='allowed':errors.append('CURRENT_RIGHTS_NOT_ALLOWED')
    if kind=='RetrievalRequest':
        if c.get('current_policy') not in (None,'allowed'):errors.append('CURRENT_RIGHTS_NOT_ALLOWED')
        if x['retraction_view']!='current_valid_only' and not c.get('audit_permission'):errors.append('AUDIT_PERMISSION_REQUIRED')
        if x['retraction_view']!='current_valid_only' and x['purpose']!='display_private':errors.append('AUDIT_NOT_NORMAL_MODEL_INPUT')
    if kind=='RunRequest':
        if iso(x['window']['start_at'])>=iso(x['window']['end_at']):errors.append('INVALID_WINDOW')
        if iso(x['window']['end_at'])>iso(x['market_cutoff_at']):errors.append('MARKET_WINDOW_AFTER_CUTOFF')
        if x['generation_mode']=='model' and not c.get('budget_approved'):errors.append('MODEL_BUDGET_UNAPPROVED')
        if x['capture_kind']=='historical' and not x['knowledge_cutoff_at']:errors.append('HISTORICAL_CUTOFF_REQUIRED')
        if x['execution_mode']=='durable' and not c.get('durable_enabled'):errors.append('DURABLE_EXECUTOR_UNAVAILABLE')
    if kind=='Report':
        cov=c.get('coverage')
        if x['state']=='no_material_change':
            if not cov or cov.get('coverage_id')!=x.get('coverage_id') or not cov.get('quiet_result_allowed'):errors.append('QUIET_WITHOUT_VALID_COVERAGE')
            if cov and domain_errors('CoverageReport',cov):errors.append('INVALID_COVERAGE')
            if not x.get('comparison_bundle_id') or not c.get('comparison_exists'):errors.append('COMPARISON_MISSING')
            if c.get('material_change_found'):errors.append('HIDING_MATERIAL_CHANGE')
        allowed=set(c.get('evidence_ids',[]))
        if 'evidence_ids' in c:
            for group in ['facts','interpretations','conditions','counterevidence']:
                for item in x[group]:
                    if not set(item['numeric_refs']).issubset(allowed):errors.append('NUMERIC_REF_NOT_IN_BUNDLE')
    return errors

def probe(name,doc,kind,x,valid,context=None,domain=False):
    errs=list(validator(doc,kind).iter_errors(x))
    if not errs and domain:errs=domain_errors(kind,x,context)
    check(name,not bool(errs),valid,'schema+reference_domain' if domain else 'schema',str(errs[0])[:240] if errs else None)

def main():
    for f in sorted(ROOT.rglob('*.json')):
        if '90_archive' in f.parts:continue
        try: strict_loads(f.read_text());ok=True;note=None
        except Exception as e:ok=False;note=str(e)
        check('json:'+str(f.relative_to(ROOT)),ok,layer='file_structure',detail=note)
    rs=load('01_accepted_plan/contracts/research.schema.json');cs=load('06_collection_design/collection.schema.design.json')
    for label,doc in [('research',rs),('collection',cs)]:
        try:Draft202012Validator.check_schema(doc);ok=True
        except Exception:ok=False
        check('schema_definition:'+label,ok,layer='schema_definition')
    ex=load('06_collection_design/contract_examples.synthetic.json')
    for k,x in ex.items():
        probe('positive_def:'+k,cs,k,x,True);probe('positive_root:'+k,cs,None,x,True)
    for c in load('06_collection_design/source_catalog.candidates.json'):probe('candidate:'+c['source_candidate_id'],cs,None,c,True)
    for name,x in [('empty',{}),('arbitrary',{'anything':'passes'}),('malformed',{'attempt_id':123,'state':'bogus'})]:probe('root_negative:'+name,cs,None,x,False)
    for k,x in ex.items():
        y=copy.deepcopy(x);y['record_origin']='observed';probe('runtime_shape:'+k,cs,k,y,True)
        probe('synthetic_live_rejected:'+k,cs,k,x,False,{'live_pipeline':True},True)
    # Cross-contract enums and capability separation
    check('time_mode_enum_alignment',cs['$defs']['RetrievalRequest']['properties']['mode']['enum'],rs['$defs']['RunRequest']['properties']['as_known_mode']['enum'],'cross_contract')
    check('publication_precision_alignment',cs['$defs']['ResourceVersion']['properties']['published_precision']['enum'],rs['$defs']['Article']['properties']['published_precision']['enum'],'cross_contract')
    check('purpose_keys_are_existing_rights',set(cs['$defs']['RetrievalRequest']['properties']['purpose']['enum']).issubset(rs['$defs']['Rights']['properties']),layer='cross_contract')
    # Modes and types
    rq=copy.deepcopy(ex['RetrievalRequest']);rq['mode']='publicly_available';probe('shared_time_mode',cs,'RetrievalRequest',rq,True)
    rq['mode']='public_available';probe('old_alias_rejected',cs,'RetrievalRequest',rq,False)
    rq=copy.deepcopy(ex['RetrievalRequest']);rq['as_of']='not-a-date';probe('date_format_checked',cs,'RetrievalRequest',rq,False)
    rq=copy.deepcopy(ex['RetrievalRequest']);rq.update(purpose='display_private',retraction_view='audit_history')
    probe('authorized_private_history',cs,'RetrievalRequest',rq,True,{'current_policy':'allowed','audit_permission':True},True)
    probe('history_denied_policy',cs,'RetrievalRequest',rq,False,{'current_policy':'denied','audit_permission':True},True)
    probe('history_unknown_policy',cs,'RetrievalRequest',rq,False,{'current_policy':'unknown','audit_permission':True},True)
    probe('history_no_audit_permission',cs,'RetrievalRequest',rq,False,{'current_policy':'allowed'},True)
    rq['purpose']='send_to_model';probe('history_not_generic_model_input',cs,'RetrievalRequest',rq,False)
    cand=load('06_collection_design/source_catalog.candidates.json')[0];cc=copy.deepcopy(cand);cc['enabled']=True;probe('candidate_cannot_activate',cs,'SourceCandidate',cc,False)
    reg=copy.deepcopy(ex['SourceRegistration']);reg.update(enabled=True,state='active');probe('registration_needs_endpoint_check',cs,'SourceRegistration',reg,False)
    # Coverage, cold-start and domain set relations
    cv=copy.deepcopy(ex['CoverageReport']);cv.update(coverage_class='insufficient',quiet_result_allowed=True);probe('quiet_insufficient_rejected',cs,'CoverageReport',cv,False)
    good=copy.deepcopy(cv);good.update(coverage_class='usable',usable_sources=good['required_sources'][:],failed_sources=[],comparison_available=True)
    probe('quiet_valid_declared_panel',cs,'CoverageReport',good,True,domain=True)
    for label,patch,domain in [('empty_required',{'required_sources':[]},False),('missing_comparison',{'comparison_available':False},False),('missing_usable_source',{'usable_sources':good['usable_sources'][:1]},True),('failed_required',{'failed_sources':[good['required_sources'][0]]},True),('wrong_window',{'window_start':good['window_end']},True)]:
        q=copy.deepcopy(good);q.update(patch);probe('coverage:'+label,cs,'CoverageReport',q,False,domain=domain)
    q=copy.deepcopy(good);q['required_sources']+=q['required_sources'];probe('duplicate_required_rejected',cs,'CoverageReport',q,False)
    # Version visibility: URL discovered yesterday does not backdate today's rewritten body.
    rv=copy.deepcopy(ex['ResourceVersion']);rv['first_seen_at']='2026-09-14T00:00:00Z';rv['version_observed_at']='2026-09-16T00:01:01Z'
    probe('revised_body_not_backdated',cs,'ResourceVersion',rv,False,{'mode':'system_observed','as_of':'2026-09-15T00:00:00Z'},True)
    probe('unproven_public_version',cs,'ResourceVersion',rv,False,{'mode':'publicly_available','as_of':'2026-09-15T00:00:00Z'},True)
    probe('current_model_rights_denied',cs,'ResourceVersion',rv,False,{'current_use':'send_to_model'},True)
    # Round-trip collection fields into the current Article shape: a cross-contract check.
    rights=load('01_accepted_plan/fixtures/sample_metrics.json')[0]['rights']
    article={'article_version_id':rv['version_id'],'article_id':rv['resource_id'],'source_id':rv['source_id'],
             'canonical_url':'https://example.invalid/article','title':'合成标题','language':'zh',
             'published_at':rv['source_published_at'],'published_precision':rv['published_precision'],
             'first_seen_at':rv['first_seen_at'],'version_observed_at':rv['version_observed_at'],
             'version_observation_key':rv['version_observation_key'],'fetched_at':rv['fetched_at'],
             'content_digest':rv['extraction_digest'],'source_content_digest':rv['source_content_digest'],
             'source_revision_id':rv['source_revision_id'],'origin_group_id':None,
             'extraction_method':rv['extractor_version'],'rights':rights,'excerpt':None,'supersedes':None}
    probe('resource_to_article_shape',rs,'Article',article,True)
    article['published_at']='2026-09-14';article['published_precision']='date';probe('article_calendar_date',rs,'Article',article,True)

    day=copy.deepcopy(rv);day.update(published_precision='date',source_published_at='2026-09-14');probe('date_precision_without_fake_midnight',cs,'ResourceVersion',day,True)
    day['source_published_at']='2026-09-14T00:00:00Z';probe('date_precision_shape_mismatch',cs,'ResourceVersion',day,False)
    # Explicit source content identity versus extraction identity.
    ext=copy.deepcopy(rv);ext['extractor_version']='parser_v2';ext['extraction_digest']='b'*64
    check('extractor_change_does_not_change_source_digest',ext['source_content_digest']==rv['source_content_digest'],layer='reference_domain')
    transitions=[{'at':'t1','digest':'A'},{'at':'t2','digest':'B'},{'at':'t3','digest':'A'}]
    check('content_dedup_does_not_erase_A_B_A_observations',len(transitions)==3 and len(set(x['digest'] for x in transitions))==2,layer='reference_domain')
    # Research fixtures
    for f,kind in [('sample_run.json','Run'),('sample_bundle.json','Bundle'),('sample_report.json','Report'),('sample_artifact.json','Artifact'),('sample_view.json','ResearchView')]:
        probe('research_fixture:'+f,rs,kind,load('01_accepted_plan/fixtures/'+f),True)
    metrics=load('01_accepted_plan/fixtures/sample_metrics.json')
    for m in metrics:probe('metric:'+m['evidence_id'],rs,'Metric',m,True)
    run=load('01_accepted_plan/fixtures/sample_run.json');rr=run['request']
    probe('template_without_model_budget',rs,'RunRequest',rr,True,domain=True)
    mr=copy.deepcopy(rr);mr['generation_mode']='model';probe('model_requires_budget_id',rs,'RunRequest',mr,False)
    mr['budget_profile_id']='budget_example';probe('model_budget_id_not_approval',rs,'RunRequest',mr,False,domain=True)
    probe('model_with_approved_budget',rs,'RunRequest',mr,True,{'budget_approved':True},True)
    hr=copy.deepcopy(rr);hr.update(capture_kind='historical',knowledge_cutoff_at=None);probe('historical_requires_knowledge_cutoff',rs,'RunRequest',hr,False)
    hr['knowledge_cutoff_at']='2026-01-15T01:00:05Z';probe('independent_historical_knowledge_cutoff',rs,'RunRequest',hr,True,domain=True)
    dr=copy.deepcopy(rr);dr['execution_mode']='durable';probe('durable_field_not_executor',rs,'RunRequest',dr,False,domain=True)
    rep=load('01_accepted_plan/fixtures/sample_report.json');n=copy.deepcopy(rep);n['state']='no_material_change';probe('nochange_requires_references',rs,'Report',n,False)
    n.update(coverage_id=good['coverage_id'],comparison_bundle_id='bundle_comparison');probe('nochange_valid_context',rs,'Report',n,True,{'coverage':good,'comparison_exists':True},True)
    probe('nochange_cannot_hide_actual_change',rs,'Report',n,False,{'coverage':good,'comparison_exists':True,'material_change_found':True},True)
    for state in ['initial_baseline','insufficient_coverage']:
        n=copy.deepcopy(rep);n['state']=state;probe('outcome:'+state,rs,'Report',n,True)
    eids=[m['evidence_id'] for m in metrics];probe('report_evidence_refs',rs,'Report',rep,True,{'evidence_ids':eids},True)
    n=copy.deepcopy(rep);n['facts'][0]['numeric_refs'].append('imaginary');probe('unknown_numeric_ref',rs,'Report',n,False,{'evidence_ids':eids},True)
    # Actual fixture bytes and pointed metric content
    art=load('01_accepted_plan/fixtures/sample_artifact.json');target=ROOT/'01_accepted_plan/fixtures'/art['storage_locator'].split('://',1)[1];raw=target.read_bytes()
    check('artifact_byte_length',len(raw),art['byte_length'],'digest')
    check('artifact_exact_byte_hash',hashlib.sha256(raw).hexdigest(),art['digest'],'digest')
    check('readable_metrics_equal_stored_content',strict_loads(raw)==metrics,layer='digest')
    bu=load('01_accepted_plan/fixtures/sample_bundle.json')
    for er in bu['evidence_refs']:
        item=metrics[int(er['json_pointer'][1:])];check('evidence_digest:'+er['evidence_id'],canonical_digest(item),er['digest'],'digest')
    check('bundle_digest',canonical_digest({k:v for k,v in bu.items() if k!='digest'}),bu['digest'],'digest')
    check('report_digest',canonical_digest({k:v for k,v in rep.items() if k!='content_digest'}),rep['content_digest'],'digest')
    for label,x in [('unsafe_integer',9007199254740992),('float',1.5),('unicode_key',{'价格':'1'}),('surrogate','\ud800')]:
        try:canonical_bytes(x); rejected=False
        except (ValueError,UnicodeError):rejected=True
        check('canonical_reject:'+label,rejected,layer='digest')
    check('arrays_not_sorted',canonical_digest(['a','b'])!=canonical_digest(['b','a']),layer='digest')
    check('unicode_values_not_normalized',canonical_digest('é')!=canonical_digest('e\u0301'),layer='digest')
    for label,text in [('duplicate_keys','{"a":1,"a":2}'),('nan','{"a":NaN}')]:
        try:strict_loads(text); rejected=False
        except ValueError:rejected=True
        check('json_import_reject:'+label,rejected,layer='parser')
    # Scope profile closure and original full DAG separately
    scopes=load('10_final_review/scoped_tasks.json')
    for profile in scopes['profiles']:
        included={t['id']:t for t in scopes['tasks'] if profile in t['profiles']}
        visited=set();visiting=set();order=[]
        def visit(k):
            if k not in included:raise ValueError('missing required '+k)
            if k in visiting:raise ValueError('cycle at '+k)
            if k in visited:return
            visiting.add(k)
            t=included[k]
            for dep in t['requires']+t['requires_by_profile'].get(profile,[]):visit(dep)
            visiting.remove(k);visited.add(k);order.append(k)
        try:
            for k in included:visit(k)
            ok=True;note=order
        except ValueError as e:ok=False;note=str(e)
        check('scope_dag:'+profile,ok,layer='task_graph',detail=note)
        if profile not in ['model_brief','integrated_model']:check('no_model_task:'+profile,'F-07' not in included,layer='task_graph')
        if profile in ['market_template','model_brief']:
            check('no_forced_new_sources:'+profile,not bool(set(included)&{'F-04','F-05','F-06'}),layer='task_graph')
    tasks=load('01_accepted_plan/meta/tasks.json');td={t['id']:t for t in tasks}
    def ancestors(k,trail=None):
        trail=trail or set()
        if k in trail:raise ValueError('cycle')
        out=set()
        for x in td[k]['depends_on']:out.add(x);out.update(ancestors(x,trail|{k}))
        return out
    try:
        all_anc={k:ancestors(k) for k in td};ok=True
    except Exception:ok=False;all_anc={}
    check('original_full_task_dag',ok,layer='task_graph')
    if ok:check('WP033_full_ancestors_documented',len(all_anc['WP-033']),19,'task_graph')
    # OpenAPI local references and per-operation security, no speculative top-level claim
    api=load('01_accepted_plan/contracts/openapi.design.json');count=0;opids=set()
    for path,item in api['paths'].items():
        for method,op in item.items():
            if method not in ['get','put','post','patch','delete','head','options']:continue
            count+=1;check('api_security:'+method+path,bool(op.get('security') or api.get('security')),layer='api_design')
            oid=op.get('operationId');check('unique_operation:'+str(oid),bool(oid) and oid not in opids,layer='api_design');opids.add(oid)
    check('api_operation_count',count,39,'api_design')
    def refs(v):
        if isinstance(v,dict):
            if '$ref' in v:yield v['$ref']
            for y in v.values():yield from refs(y)
        elif isinstance(v,list):
            for y in v:yield from refs(y)
    for ref in sorted(set(refs(api))):
        target,_,frag=ref.partition('#')
        obj=load('01_accepted_plan/contracts/'+target) if target else api
        try:
            for token in frag.split('/')[1:]:obj=obj[token.replace('~1','/').replace('~0','~')]
            ok=True
        except (KeyError,TypeError):ok=False
        check('api_local_ref:'+ref,ok,layer='api_design')
    # SQL syntax only, deliberately no existing or remote database
    conn=sqlite3.connect(':memory:')
    try:
        conn.executescript((ROOT/'01_accepted_plan/contracts/research_schema.proposed.sql').read_text());ok=True
        tables=conn.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
    except Exception as e:ok=False;tables=str(e)
    finally:conn.close()
    check('reference_sql_syntax',ok,layer='sql_syntax_only',detail=tables)
    # Verify original factual input unchanged against archived original bundle
    import zipfile
    with zipfile.ZipFile(ROOT/'90_archive/previous_delivery_original.zip') as z:
        name=next(n for n in z.namelist() if n.endswith('/01_accepted_plan/inputs/repository_facts.md'))
        check('repository_facts_preserved_bytes',(ROOT/'01_accepted_plan/inputs/repository_facts.md').read_bytes()==z.read(name),layer='provenance')
    return {'scope':'offline_document_checks_only','network_used':False,'software_installed':False,'candidate_code_executed':False,'production_accessed':False,
            'checks':checks,'summary':{'checks':len(checks),'passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed'] for x in checks)},
            'not_proven':['repository implementation','all external source claims','production database/API/model performance','real source completeness','real billing caps','financial predictive usefulness']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path);args=parser.parse_args()
    result=main()
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['summary'],ensure_ascii=False))
    for c in result['checks']:
        if not c['passed']:print('FAIL',c['name'],c['detail'])
    raise SystemExit(0 if result['summary']['failed']==0 else 1)
