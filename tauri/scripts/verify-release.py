"""Verify generated release archives, never access account data."""
import hashlib, json, sys, zipfile
from pathlib import Path, PurePosixPath

root = Path(sys.argv[1]).resolve()
reports = []
for name, platform, arch in [
    ('Windows-公测版-1.0.zip', 'windows', 'x64'),
    ('Mac-Apple芯片-公测版-1.0.zip', 'mac', 'arm64'),
    ('Mac-Intel-公测版-1.0.zip', 'mac', 'x64'),
]:
    paths = list(root.rglob(name))
    if not paths:
        continue
    assert len(paths) == 1, 'Ambiguous package: ' + name
    path = paths[0]
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None, 'CRC failure'
        for entry in z.namelist():
            p = PurePosixPath(entry)
            assert not p.is_absolute() and '..' not in p.parts
        if platform == 'windows':
            prefix = 'backend/'
            manifest = json.loads(z.read('build-manifest.json'))
            assert manifest['version'] == '1.0.0' and manifest['defaultMode'] == 'live'
            for f in manifest['files']:
                data = z.read(f['path'])
                assert len(data) == f['bytes'] and hashlib.sha256(data).hexdigest() == f['sha256']
            for binary in ['777Codex.exe', '777-native.exe', '777-codexpp.exe', 'runtime/node.exe']:
                data = z.read(binary)
                assert data[:2] == b'MZ'
                pos = int.from_bytes(data[60:64], 'little')
                assert data[pos:pos+4] == b'PE\0\0' and int.from_bytes(data[pos+4:pos+6], 'little') == 0x8664
        else:
            prefix = '777 Codex.app/Contents/Resources/backend/'
            import plistlib
            info = plistlib.loads(z.read('777 Codex.app/Contents/Info.plist'))
            assert info['CFBundleShortVersionString'] == '1.0.0'
            assert info['CFBundleIdentifier'] == 'codes.777.manager.tauri.candidate'
            cpu = 0x100000C if arch == 'arm64' else 0x1000007
            for binary in ['MacOS/777Codex', 'MacOS/777-native', 'MacOS/777-codexpp', 'Resources/runtime/node']:
                data = z.read('777 Codex.app/Contents/' + binary)
                assert data[:4] == b'\xcf\xfa\xed\xfe' and int.from_bytes(data[4:8], 'little') == cpu
        assert '公测版 1.0' in z.read(prefix + 'index.html').decode()
        assert 'INSUFFICIENT_BALANCE' in z.read(prefix + 'js/model-service.mjs').decode()
        assert 'codexpp/repair' in z.read(prefix + 'features-ui.js').decode()
        assert '__TAURI_INTERNALS__' in z.read(prefix + 'features-ui.js').decode()
        # Git checks out platform-specific line endings; compare executable source text.
        common = {f: hashlib.sha256(z.read(prefix + f).replace(b'\r\n', b'\n')).hexdigest() for f in ['features-ui.js', 'js/codexpp-manager.mjs', 'js/model-service.mjs', 'js/account-manager.mjs', 'scripts/login-recovery.mjs']}
    reports.append(dict(file=name, path=str(path), bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), platform=platform, arch=arch, version='1.0', internalVersion='1.0.0', crc=True, architectureVerified=True, sharedHashes=common))
for item in reports[1:]:
    assert item['sharedHashes'] == reports[0]['sharedHashes'], 'Shared feature drift between platforms'
print(json.dumps(dict(packages=reports, allThreeVerified=len(reports)==3), ensure_ascii=False, indent=2))
