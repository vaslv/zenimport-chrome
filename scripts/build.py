"""Dependency-free reproducible extension artifact. Never includes local settings."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'extension'
version = json.loads((source / 'manifest.json').read_text())['version']
dist = root / 'dist'
dist.mkdir(exist_ok=True)
unpacked = dist / 'extension'
if unpacked.exists():
    shutil.rmtree(unpacked)
shutil.copytree(source, unpacked)
extra = [(root / name, name) for name in ('LICENSE', 'PRIVACY.md') if (root / name).is_file()]
for path, name in extra:
    shutil.copyfile(path, unpacked / name)
archive = dist / f'zenimport-chrome-{version}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    files = [(path, path.relative_to(source).as_posix()) for path in source.rglob('*') if path.is_file()] + extra
    for path, name in sorted(files, key=lambda item: item[1]):
        if path.is_file():
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            output.writestr(entry, path.read_bytes(), compresslevel=9)
print(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}')
