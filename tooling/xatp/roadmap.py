#!/usr/bin/env python3
"""Reconcile XATP milestones and issues; never close or reassign existing work."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

START = '<!-- xatp:managed:start -->'
END = '<!-- xatp:managed:end -->'
REPOSITORY = 'KRPCT/dsh-XATP'


def managed(existing: str, generated: str) -> str:
    """Replace exactly one managed region while retaining all human-owned text."""
    for line in existing.splitlines():
        if line.startswith('- [x] ') or line.startswith('- [X] '):
            generated = generated.replace('- [ ] ' + line[6:], '- [x] ' + line[6:])
    block = START + '\n' + generated.strip() + '\n' + END
    if START not in existing and END not in existing:
        return existing.rstrip() + ('\n\n' if existing else '') + block
    if existing.count(START) != 1 or existing.count(END) != 1:
        raise ValueError('Ambiguous managed region; manual reconciliation required')
    before, tail = existing.split(START, 1)
    _, after = tail.split(END, 1)
    return before + block + after


class GitHub:
    def __init__(self, token: str):
        self.token = token

    def request(self, method: str, path: str, data: dict | None = None):
        payload = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(
            'https://api.github.com/repos/' + REPOSITORY + path,
            data=payload, method=method,
            headers={'Authorization': 'Bearer ' + self.token,
                     'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2026-03-10',
                     'Content-Type': 'application/json', 'User-Agent': 'xatp-roadmap'})
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            message = exc.read(1200).decode(errors='replace')
            raise RuntimeError(f'{method} {path}: HTTP {exc.code}: {message}') from exc
        # Mutating calls are deliberately not blindly retried after transport loss.

    def all(self, path: str) -> list:
        result = []
        for page in range(1, 51):
            part = self.request('GET', path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
            if not isinstance(part, list):
                raise ValueError('Expected paginated list')
            result.extend(part)
            if len(part) < 100:
                return result
        raise RuntimeError('Pagination bound reached; no incomplete inventory accepted')


def unique(rows: list, marker: str, field: str) -> dict | None:
    found = [x for x in rows if marker in (x.get(field) or '')]
    if len(found) > 1:
        raise ValueError('Duplicate stable marker: ' + marker)
    return found[0] if found else None


def validate(doc: dict) -> None:
    if doc.get('schema_version') != 1 or doc.get('repository') != REPOSITORY:
        raise ValueError('Unexpected roadmap repository or version')
    milestones = {m['key'] for m in doc['milestones']}
    keys = {t['key'] for t in doc['tasks']}
    if len(keys) != len(doc['tasks']) or len(milestones) != len(doc['milestones']):
        raise ValueError('Duplicate task or milestone key')
    for task in doc['tasks']:
        if task['milestone'] not in milestones or not set(task['depends_on']) <= keys:
            raise ValueError('Dangling roadmap dependency')
    visiting, visited = set(), set()
    deps = {t['key']: t['depends_on'] for t in doc['tasks']}
    def visit(key):
        if key in visiting:
            raise ValueError('Cyclic roadmap dependency')
        if key in visited:
            return
        visiting.add(key)
        for dep in deps[key]:
            visit(dep)
        visiting.remove(key)
        visited.add(key)
    for key in keys:
        visit(key)


def reconcile(api: GitHub, doc: dict) -> dict:
    validate(doc)
    milestones = api.all('/milestones?state=all')
    issues = [x for x in api.all('/issues?state=all') if 'pull_request' not in x]
    milestone_ids, task_ids = {}, {}
    receipt = {'repository': REPOSITORY, 'milestones': {}, 'issues': {}, 'subissues': []}
    for item in doc['milestones']:
        marker = '<!-- xatp:milestone=' + item['key'] + ' -->'
        row = unique(milestones, marker, 'description')
        if row is None:
            same_title = [x for x in milestones if x['title'] == item['title']]
            if same_title:
                raise ValueError('Unmanaged milestone uses target title; refusing duplicate')
            row = api.request('POST', '/milestones', {'title': item['title'], 'description': marker + '\n' + managed('', item['description'])})
        else:
            description = managed(row.get('description') or '', item['description'])
            if description != row.get('description'):
                row = api.request('PATCH', f"/milestones/{row['number']}", {'description': description})
        milestone_ids[item['key']] = row['number']
        receipt['milestones'][item['key']] = {'number': row['number'], 'url': row['html_url']}
    for task in doc['tasks']:
        marker = '<!-- xatp:task=' + task['key'] + ' -->'
        row = unique(issues, marker, 'body')
        if row is None:
            row = api.request('POST', '/issues', {'title': task['title'], 'body': marker + '\n\n' + managed('', '工作项已建立；依赖与验收条目在本次协调中补齐。'), 'milestone': milestone_ids[task['milestone']]})
            issues.append(row)
        task_ids[task['key']] = row
    for task in doc['tasks']:
        row = task_ids[task['key']]
        dependencies = ', '.join('#' + str(task_ids[d]['number']) for d in task['depends_on']) or '无前置任务；可以并行推进'
        generated = '\n'.join(['总追踪：#' + str(doc['parent_issue']), '执行通道：' + task['lane'], '依赖：' + dependencies, '', '## 验收', *['- [ ] ' + text for text in task['acceptance']], '', '## 执行规则', '无进展不得靠重复全套测试充数。相关边界检查集中运行，最终真实平台 E2E 不省略。缺少账号、能力或证据标为 blocked，不当作完成。完成后链接产物与验证记录，再由协调者关闭；不自动关闭。'])
        body = managed(row.get('body') or '', generated)
        patch = {}
        if body != row.get('body'):
            patch['body'] = body
        if (row.get('milestone') or {}).get('number') != milestone_ids[task['milestone']]:
            patch['milestone'] = milestone_ids[task['milestone']]
        if patch:
            row = api.request('PATCH', f"/issues/{row['number']}", patch)
        task_ids[task['key']] = row
        receipt['issues'][task['key']] = {'number': row['number'], 'url': row['html_url']}
    parent = api.request('GET', f"/issues/{doc['parent_issue']}")
    existing_children = {r['id'] for r in api.all(f"/issues/{doc['parent_issue']}/sub_issues")}
    for row in task_ids.values():
        if row['id'] not in existing_children:
            api.request('POST', f"/issues/{doc['parent_issue']}/sub_issues", {'sub_issue_id': row['id']})
        receipt['subissues'].append(row['number'])
    links = ['## Roadmap']
    for item in doc['milestones']:
        links.append('\n### [' + item['title'] + '](' + receipt['milestones'][item['key']]['url'] + ')')
        links.extend('- #' + str(task_ids[t['key']]['number']) + ' — ' + t['title'] for t in doc['tasks'] if t['milestone'] == item['key'])
    body = managed(parent.get('body') or '', '\n'.join(links))
    if body != parent.get('body'):
        api.request('PATCH', f"/issues/{doc['parent_issue']}", {'body': body})
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--apply', action='store_true', help='Write native milestones/issues. Default only validates the local plan.')
    args = parser.parse_args()
    doc = json.loads(args.manifest.read_text())
    validate(doc)
    if not args.apply:
        print(json.dumps({'valid': True, 'writes': 0, 'milestones': len(doc['milestones']), 'issues': len(doc['tasks'])}))
        return
    if os.environ.get('GITHUB_REPOSITORY', REPOSITORY) != REPOSITORY:
        raise SystemExit('Repository mismatch')
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if not token:
        raise SystemExit('Missing GitHub authorization; no writes attempted')
    receipt = reconcile(GitHub(token), doc)
    print(json.dumps(receipt, ensure_ascii=False, indent=2))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as out:
            out.write('## XATP roadmap receipt\n\n```json\n' + json.dumps(receipt, ensure_ascii=False, indent=2) + '\n```\n')


if __name__ == '__main__':
    main()
