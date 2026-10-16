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
archive = dist / f'zenimport-chrome-{version}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for path in sorted(source.rglob('*')):
        if path.is_file():
            entry = zipfile.ZipInfo(path.relative_to(source).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            output.writestr(entry, path.read_bytes(), compresslevel=9)
print(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}')
