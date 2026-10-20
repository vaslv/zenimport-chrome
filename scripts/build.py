"""Reproducible bundled extension artifact. Never includes local settings/probes."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'extension'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--compiled', type=Path, help='Prebuilt bundle directory from the pinned Node Docker stage')
args = parser.parse_args()
if args.compiled is None:
    subprocess.run(['node', 'scripts/bundle.mjs'], cwd=root, check=True)
compiled = args.compiled or root / '.local/bundle'
entries = ('background.js', 'popup.js', 'discrepancies.js')
for name in entries:
    if not (compiled / name).is_file():
        raise SystemExit('Missing bundled entry: ' + name)
version = json.loads((source / 'manifest.json').read_text())['version']
dist = root / 'dist'
dist.mkdir(exist_ok=True)
unpacked = dist / 'extension'
if unpacked.exists():
    shutil.rmtree(unpacked)
shutil.copytree(source, unpacked)
for name in entries:
    shutil.copyfile(compiled / name, unpacked / name)
extra = [(root / name, name) for name in ('LICENSE', 'PRIVACY.md') if (root / name).is_file()]
for path, name in extra:
    shutil.copyfile(path, unpacked / name)
archive = dist / f'zenimport-chrome-{version}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    files = [(path, path.relative_to(unpacked).as_posix()) for path in unpacked.rglob('*') if path.is_file()]
    for path, name in sorted(files, key=lambda item: item[1]):
        if path.is_file():
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            output.writestr(entry, path.read_bytes(), compresslevel=9)
checksum = f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n'
(dist / 'SHA256SUMS').write_text(checksum)
print(checksum, end='')
