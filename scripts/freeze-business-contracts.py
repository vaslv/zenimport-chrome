#!/usr/bin/env python3
"""Freeze source-only SQLite/API evidence; never open an application database."""
import argparse
import ast
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'contracts/business/v1'
GROUPS = {
    'accounts': 'connections bank_accounts connection_accounts account_bindings connection_discovery connection_labels',
    'records': 'bank_transactions bank_aliases bank_versions',
    'processing': 'bank_processing processing_receipts processing_targets bank_exclusions zen_exclusions',
    'capture': 'capture_jobs capture_intervals capture_pages coverage job_requests job_context job_accounts reimport_ranges account_capture_locks captured_records capture_errors',
    'mirror': 'zen_sync_runs zen_entities zen_movements zen_tags zen_deletions zen_tombstones zen_mirror_state',
    'matching': 'link_groups link_bank_members link_zen_members',
    'delivery': 'deliveries delivery_attempts delivery_authorizations delivery_schedule',
    'predictions': 'recipient_rules category_choices category_evidence category_payments category_predictions',
    'legacy': 'legacy_imports legacy_objects legacy_rows',
    'migration': 'schema_migrations service_meta',
}
OWNERS = {table: group for group, tables in GROUPS.items() for table in tables.split()}
ACCEPTANCE = {'accounts': 'C03', 'records': 'D02', 'processing': 'B06', 'capture': 'D04',
              'mirror': 'D08', 'matching': 'E05', 'delivery': 'F04', 'predictions': 'E14',
              'legacy': 'G19', 'migration': 'G01'}
DISPOSITIONS = {'schema_migrations': 'audit_only', 'account_capture_locks': 'exclude_executable_lease',
                'service_meta': 'classify_each_key', 'delivery_schedule': 'preserve_deadline_revalidate_context',
                'zen_mirror_state': 'preserve_audit_require_full_refresh',
                'category_predictions': 'preserve_audit_invalidate_derived'}
META = {
    'instance_id': 'preserve_as_dataset_lineage_not_physical_installation',
    'sync_ever_started': 'preserve_irreversible_activity',
    'migration_import_sha256': 'preserve_import_provenance',
    'migration_hold': 'audit_and_recreate_protected_participant_state',
    'zenmoney_refreshed_at': 'invalidate_freshness_preserve_audit',
    'legacy:*': 'reject_until_explicitly_classified_including_secret_screening',
}


def canonical(value):
    return json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + '\n'


def read_source(root, revision, path):
    return subprocess.check_output(['git', '-C', str(root), 'show', f'{revision}:{path}'])


def revision(root):
    return subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()


def tracked(root, revision, prefix):
    return subprocess.check_output(['git', '-C', str(root), 'ls-tree', '-r', '--name-only', revision, prefix], text=True).splitlines()


def checks(sql):
    """Retain balanced CHECK expressions without pretending to interpret SQL."""
    result = []
    for match in re.finditer(r'\bCHECK\s*\(', sql, re.I):
        start, depth, quote, i = match.end(), 1, None, match.end()
        while i < len(sql) and depth:
            char = sql[i]
            if quote:
                if char == quote:
                    if i + 1 < len(sql) and sql[i + 1] == quote:
                        i += 2
                        continue
                    quote = None
            elif char in "'\"":
                quote = char
            elif char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
            i += 1
        if depth:
            raise ValueError('Unbalanced CHECK expression')
        result.append(sql[start:i-1])
    return result


def freeze_schema(sql_files):
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    def reject_record_data(value):
        raise ValueError('Schema freezing cannot validate or import financial records')
    db.create_function('money_valid', 1, reject_record_data)
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('CREATE TABLE service_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for sql in sql_files:
        db.executescript(sql)
    tables = {}
    for row in db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        name, sql = row
        if name not in OWNERS:
            raise ValueError(f'Unclassified table: {name}')
        group = OWNERS[name]
        columns = [dict(c) for c in db.execute(f'PRAGMA table_info("{name}")')]
        for column in columns:
            column['logical_required'] = bool(column['notnull'] or column['pk'])
        indexes = []
        for index in db.execute(f'PRAGMA index_list("{name}")'):
            entry = dict(index)
            entry.pop('seq')
            entry['columns'] = [dict(c) for c in db.execute(f'PRAGMA index_info("{index["name"]}")')]
            entry['sql'] = db.execute('SELECT sql FROM sqlite_master WHERE name=?', (index['name'],)).fetchone()[0]
            indexes.append(entry)
        triggers = [dict(t) for t in db.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name", (name,))]
        tables[name] = dict(columns=columns, sql=sql, checks=checks(sql),
            foreign_keys=[dict(f) for f in db.execute(f'PRAGMA foreign_key_list("{name}")')],
            indexes=sorted(indexes, key=lambda i: i['name']), triggers=triggers,
            repository=f'{group}Repository', disposition=DISPOSITIONS.get(name, 'preserve_exact'),
            acceptance=ACCEPTANCE[group], invariant_case=f'storage.{name}.constraints')
    if set(tables) != set(OWNERS):
        raise ValueError(f'Incomplete table inventory: {set(OWNERS) - set(tables)}')
    db.close()
    return dict(contract_version=1, sqlite_schema_version=7, tables=tables, service_meta=META,
                unknown_metadata='reject', null_policy='preserve SQL null; require all logical keys')


def api_inventory(source):
    result = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                continue
            if decorator.func.attr not in {'get', 'post', 'put', 'delete'} or not decorator.args:
                continue
            path = ast.literal_eval(decorator.args[0])
            result.append(dict(method=decorator.func.attr.upper(), path=path, handler=node.name,
                parameters=[dict(name=a.arg, annotation=ast.unparse(a.annotation) if a.annotation else None)
                            for a in node.args.args],
                response=next((ast.unparse(k.value) for k in decorator.keywords if k.arg == 'response_model'), None)))
    return sorted(result, key=lambda r: (r['path'], r['method']))


def build(backend, chrome_rev, backend_rev, sdk, sdk_rev):
    sql_paths = [f'backend/schema_v{i}.sql' for i in range(2, 8)]
    backend_paths = sorted(set(sql_paths + [p for p in tracked(backend, backend_rev, 'backend') if p.endswith('.py')]
                              + tracked(backend, backend_rev, 'fixtures/sync-v1')))
    chrome_paths = [p for p in tracked(ROOT, chrome_rev, 'extension') if p.endswith(('.js', '.json'))]
    source_hashes = {project: {p: sha256(read_source(root, rev, p)).hexdigest() for p in paths}
                     for project, root, rev, paths in [('backend', backend, backend_rev, backend_paths), ('chrome', ROOT, chrome_rev, chrome_paths)]}
    tests = {project: {p: sha256(read_source(root, rev, p)).hexdigest() for p in tracked(root, rev, 'tests')}
             for project, root, rev in [('backend', backend, backend_rev), ('chrome', ROOT, chrome_rev)]}
    package = json.loads(read_source(sdk, sdk_rev, 'package.json'))
    if (package['name'], package['version']) != ('zenmoney-typescript', '0.1.0'):
        raise ValueError('Review the SDK version and tarball integrity together before changing this pin')
    baseline = dict(contract_version=1, backend_commit=backend_rev, chrome_commit=chrome_rev, sdk_commit=sdk_rev,
        api_version=1, sqlite_schema_version=7, source_sha256=source_hashes, test_sha256=tests,
        sdk=dict(name=package['name'], version=package['version'],
                 tarball_sha256='bd0bf5d61fc4c7d00ea4a828cadb34d5ae77789daf622942a7ba21365cb0215a',
                 integrity='sha512-f7rccHHXrFOZf31RIKlJ+HQP+NLGcRHndZwQzKyQr1HoKwiQIfd3tFHiwDs0MIhkNW6C9UXDa9mz3lsS3d97eA=='),
        reference_only=True)
    schema = freeze_schema([read_source(backend, backend_rev, p).decode() for p in sql_paths])
    routes = []
    for path in ['backend/sync_api.py', 'backend/app.py']:
        for route in api_inventory(read_source(backend, backend_rev, path).decode()):
            route['source'] = path
            if not route['path'].startswith('/'):
                raise ValueError('Invalid HTTP route')
            if path.endswith('sync_api.py'):
                route['path'] = '/api/v1' + route['path']
            routes.append(route)
    routes.sort(key=lambda r: (r['path'], r['method']))
    examples = json.loads(read_source(backend, backend_rev, 'fixtures/sync-v1/examples.json'))
    return {'baseline.json': baseline, 'sqlite-v7.json': schema, 'http-routes-v1.json': dict(routes=routes),
            'wire-examples-v1.json': examples}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', type=Path, default=ROOT.parent / 'ZenImportBackend')
    parser.add_argument('--sdk', type=Path, default=ROOT.parent / 'zenmoney-typescript')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        pinned = json.loads((OUT / 'baseline.json').read_text())
        revisions = pinned['chrome_commit'], pinned['backend_commit'], pinned['sdk_commit']
    else:
        revisions = revision(ROOT), revision(args.backend), revision(args.sdk)
    outputs = build(args.backend, revisions[0], revisions[1], args.sdk, revisions[2])
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in outputs.items():
        encoded = canonical(data)
        path = OUT / name
        if args.check:
            if path.read_text() != encoded:
                raise SystemExit(f'Frozen contract differs: {name}')
        else:
            path.write_text(encoded)
    print(f'PASS: {len(outputs["sqlite-v7.json"]["tables"])} tables and {len(outputs["http-routes-v1.json"]["routes"])} routes; source-only pinned baseline')


if __name__ == '__main__':
    main()
