#!/usr/bin/env python3
"""Build the version manager: frozen snapshots + versions.json.

  python3 tools/build-versions.py            # export missing snapshots, regenerate versions.json
  python3 tools/build-versions.py --check    # only regenerate versions.json (no exports)

Source of truth: tools/milestones.json (projects, curated versions with descriptions).
Snapshots are IMMUTABLE: a folder <project>/<slug>/ that already exists is never touched again
(delete it by hand if you really must re-export). Each snapshot is `git archive <commit>` of the
project repo minus dev-only folders, plus a tiny shim in index.html (see SHIM).
"""
import json, os, subprocess, sys, tarfile, io, shutil, datetime
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIE = ZoneInfo('Europe/Vienna')
EXCLUDE_TOP = {'shots', 'tools', 'node_modules', '.github'}  # dev-only: screenshots, test scripts
SITE = 'https://leck-games.github.io/versions/'

# Injected first thing in <head> of every snapshot:
#  - localStorage is namespaced per snapshot (all builds share one origin; old builds must not read newer saves)
#  - service workers cannot be registered (a frozen copy must never take over a scope / cache other builds)
SHIM = ('<script>/* versions: frozen snapshot shim (%s) */(function(){var P=%s,S=Storage.prototype,g=S.getItem,s=S.setItem,r=S.removeItem;'
        'function L(t){try{return t===window.localStorage}catch(e){return false}}'
        'S.getItem=function(k){return g.call(this,L(this)?P+k:k)};S.setItem=function(k,v){return s.call(this,L(this)?P+k:k,v)};'
        'S.removeItem=function(k){return r.call(this,L(this)?P+k:k)};'
        'try{if(navigator.serviceWorker)navigator.serviceWorker.register=function(){return Promise.reject(new Error("service workers are disabled in frozen snapshots"))}}catch(e){}})();</script>')


def git(d, *a):
    return subprocess.run(['git', '-C', d, *a], check=True, capture_output=True).stdout


def find_repo(proj, commit):
    for r in proj['repos']:
        if subprocess.run(['git', '-C', r['dir'], 'cat-file', '-e', commit + '^{commit}'], capture_output=True).returncode == 0:
            return r
    raise SystemExit('commit %s not found in %s' % (commit, [r['dir'] for r in proj['repos']]))


def export(repo_dir, commit, dest, key):
    data = git(repo_dir, 'archive', '--format=tar', commit)
    tmp = dest + '.tmp'; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    with tarfile.open(fileobj=io.BytesIO(data)) as t:
        for m in t.getmembers():
            top = m.name.split('/')[0]
            if top in EXCLUDE_TOP or m.name.endswith('.patch'): continue
            t.extract(m, tmp, filter='data')
    ix = os.path.join(tmp, 'index.html'); h = open(ix, encoding='utf-8').read()
    i = h.lower().find('<head>'); assert i >= 0, 'no <head> in ' + ix
    h = h[:i + 6] + SHIM % (key, json.dumps('vm:' + key + ':')) + h[i + 6:]
    open(ix, 'w', encoding='utf-8').write(h)
    os.rename(tmp, dest)


def commit_info(d, c):
    sha, ts, subj = git(d, 'log', '-1', '--format=%H%x00%at%x00%s', c).decode().split('\x00')
    t = datetime.datetime.fromtimestamp(int(ts), VIE)
    return sha, t


def main():
    check = '--check' in sys.argv
    cfg = json.load(open(os.path.join(ROOT, 'tools', 'milestones.json'), encoding='utf-8'))
    smoke = {}
    sp = os.path.join(ROOT, 'tools', 'smoke.json')
    if os.path.exists(sp): smoke = json.load(open(sp))
    out = {'generated': datetime.datetime.now(VIE).isoformat(timespec='minutes'), 'site': SITE, 'projects': []}
    for p in cfg['projects']:
        vs = []
        for n, v in enumerate(p['versions']):
            r = find_repo(p, v['commit']); sha, t = commit_info(r['dir'], v['commit'])
            path = '%s/%s/' % (p['id'], v['slug']); dest = os.path.join(ROOT, path)
            if not os.path.isdir(dest):
                if check: print('MISSING snapshot', path)
                else: export(r['dir'], sha, dest.rstrip('/'), p['id'] + '/' + v['slug']); print('exported', path, sha[:7])
            badges = list(v.get('badges', []))
            if n == len(p['versions']) - 1: badges.insert(0, 'latest')
            thumb = 'thumbs/%s-%s.jpg' % (p['id'], v['slug'])
            key = p['id'] + '/' + v['slug']
            vs.append(dict(slug=v['slug'], label=v['label'], name=p['name'] + ' ' + v['label'], title=v['title'], desc=v['desc'],
                           repo=r['gh'], commit=sha[:7], sha=sha, url_commit='https://github.com/%s/commit/%s' % (r['gh'], sha),
                           date=t.isoformat(), date_vie=t.strftime('%d %b %Y, %H:%M'), path=path, badges=badges,
                           release=v.get('release'), thumb=thumb if os.path.exists(os.path.join(ROOT, thumb)) else None,
                           smoke=smoke.get(key)))
        log = []
        mil = {v['sha']: v['label'] for v in vs}
        for r in p['repos']:
            for line in git(r['dir'], 'log', '--format=%H%x00%at%x00%s%x00%b%x1e', *([r['since'] + '..HEAD'] if r.get('since') else [])).decode().split('\x1e'):
                line = line.strip('\n')
                if not line: continue
                sha, ts, subj, body = line.split('\x00')
                t = datetime.datetime.fromtimestamp(int(ts), VIE)
                log.append(dict(sha=sha, commit=sha[:7], repo=r['gh'], date=t.isoformat(), date_vie=t.strftime('%d %b %Y, %H:%M'),
                                msg=subj, body=body.strip(), url='https://github.com/%s/commit/%s' % (r['gh'], sha), version=mil.get(sha)))
        # dedupe (sinerally-ui shares no history with sinerally, but be safe), newest first
        seen = set(); log = [c for c in sorted(log, key=lambda c: c['date'], reverse=True) if not (c['sha'] in seen or seen.add(c['sha']))]
        out['projects'].append(dict(id=p['id'], name=p['name'], tagline=p['tagline'], color=p['color'], live=p.get('live'),
                                    repos=[r['gh'] for r in p['repos']], versions=vs, changelog=log))
    json.dump(out, open(os.path.join(ROOT, 'versions.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('versions.json:', sum(len(p['versions']) for p in out['projects']), 'versions,', sum(len(p['changelog']) for p in out['projects']), 'commits')


if __name__ == '__main__':
    main()
