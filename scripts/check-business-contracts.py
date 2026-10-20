"""Verify the canonical contract and the backend's pinned copy without modifying it."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('backend', nargs='?', type=Path, default=root.parent/'ZenImportBackend')
args = parser.parse_args()
source = root/'contracts/business/v1'
target = args.backend/'fixtures/business/v1'
assert (source/'manifest.json').read_bytes() == (target/'manifest.json').read_bytes(), 'Contract revisions differ'
manifest = json.loads((source/'manifest.json').read_text())
for directory in [source, target]:
    files = {str(path.relative_to(directory)) for path in directory.rglob('*') if path.is_file() and path.name != 'manifest.json'}
    assert files == set(manifest['files']), 'Unpinned/missing contract artifact'
    for name, digest in manifest['files'].items():
        assert sha256((directory/name).read_bytes()).hexdigest() == digest, name
pin = json.loads((target.parent/'revision.json').read_text())
assert pin['manifest_sha256'] == sha256((source/'manifest.json').read_bytes()).hexdigest()
declared = subprocess.check_output(['git', '-C', str(root), 'show', pin['source_commit'] + ':contracts/business/v1/manifest.json'])
assert declared == (source/'manifest.json').read_bytes(), 'Pinned source commit does not contain the declared contract'
print('PASS: canonical and backend contract copies agree; all artifacts verified')
