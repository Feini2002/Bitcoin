"""Offline Markdown local-file and fragment audit; does not request external URLs."""
import argparse,collections,json,re
from pathlib import Path
from urllib.parse import unquote,urlsplit
try:
    from markdown_it import MarkdownIt
except ImportError:
    raise SystemExit('markdown_it unavailable; no installation attempted.')
ROOT=Path(__file__).resolve().parents[2]
md=MarkdownIt('commonmark');cache={}
def anchors(path):
    if path in cache:return cache[path]
    text=path.read_text(encoding='utf-8');out=set(re.findall(r'<a\s+[^>]*(?:id|name)=["\']([^"\']+)["\']',text));counts=collections.Counter();tokens=md.parse(text)
    for idx,t in enumerate(tokens):
        if t.type=='heading_open' and idx+1<len(tokens):
            s=tokens[idx+1].content.lower();s=re.sub(r'<[^>]*>','',s);s=re.sub(r'[^\w\- ]','',s);s=s.replace(' ','-')
            n=counts[s];counts[s]+=1;out.add(s+('-'+str(n) if n else ''))
    cache[path]=out;return out
records=[]
for f in sorted(ROOT.rglob('*.md')):
    if any(x in f.parts for x in ['90_archive','09_prior_research']) or 'inputs' in f.parts:continue
    for t in md.parse(f.read_text()):
        if not t.children:continue
        for c in t.children:
            if c.type not in ['link_open','image']:continue
            href=c.attrGet('href') or c.attrGet('src')
            if not href:continue
            parsed=urlsplit(href)
            if parsed.scheme or parsed.netloc:continue
            target=(f.parent/unquote(parsed.path)).resolve() if parsed.path else f.resolve()
            kind='file';ok=target.exists();detail=None
            if ok and parsed.fragment and target.suffix=='.md':
                frag=unquote(parsed.fragment);ok=frag in anchors(target);kind='fragment';detail=frag
            records.append({'source':str(f.relative_to(ROOT)),'href':href,'kind':kind,'passed':ok,'detail':detail})
res={'scope':'active_markdown_local_links_only','not_tested':['remote_URL_availability','historical_archive_links','runtime_browser_rendering'],
     'summary':{'checked':len(records),'passed':sum(x['passed'] for x in records),'failed':sum(not x['passed'] for x in records)},'checks':records}
a=argparse.ArgumentParser();a.add_argument('--output',type=Path);args=a.parse_args()
if args.output:args.output.write_text(json.dumps(res,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(res['summary']))
for x in records:
    if not x['passed']:print(x['source'],x['href'])
raise SystemExit(bool(res['summary']['failed']))
