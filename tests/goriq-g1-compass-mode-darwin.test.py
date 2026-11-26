"""Darwin-only preflight on newly created private fixtures, never owner targets.

Called with the just-compiled read-only metadata library. No candidate path or
authority input is accepted; output is a fixed, non-sensitive PASS marker.
"""
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile


def main():
    if sys.platform!='darwin' or len(sys.argv)!=2 or os.getuid()<=0:
        return 1
    library=Path(sys.argv[1])
    source=Path(__file__).resolve().parents[1]/'scripts/goriq-g1-compass-mode-native.py'
    spec=importlib.util.spec_from_file_location('g1_native_preflight',source)
    native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
    metadata=native.DarwinMetadata(str(library))
    with tempfile.TemporaryDirectory(prefix='darwin-fixture-',dir=library.parent) as directory:
        path=Path(directory)/'inert-file'
        path.write_bytes(b'isolated metadata preflight; never an original')
        os.chmod(path,0o600)
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            observed=metadata.facts(fd,str(path))
            assert observed=={'path':str(path),'acl':0,'alias':False,'flags':0}
            for rule,expected in [('everyone deny write',1),('everyone allow read',2)]:
                child=Path(directory)/('acl-'+str(expected))
                child.write_bytes(b'isolated ACL fixture')
                subprocess.run(['/bin/chmod','+a',rule,str(child)],check=True,timeout=5,
                               stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                other=os.open(child,os.O_RDONLY|os.O_NOFOLLOW)
                try:assert metadata.facts(other,str(child))['acl']==expected
                finally:os.close(other)
            # A harmless flag on this new fixture must be observed, never
            # normalized to zero. UF_NODUMP does not prevent fixture cleanup.
            os.chflags(path,stat.UF_NODUMP)
            assert metadata.facts(fd,str(path))['flags']==stat.UF_NODUMP
            alias=Path(directory)/'finder-alias-fixture'
            alias.write_bytes(b'isolated FinderInfo fixture')
            finder=bytearray(32);finder[8]=0x80
            subprocess.run(['/usr/bin/xattr','-w','-x','com.apple.FinderInfo',finder.hex(),str(alias)],
                           check=True,timeout=5,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            other=os.open(alias,os.O_RDONLY|os.O_NOFOLLOW)
            try:assert metadata.facts(other,str(alias))['alias'] is True
            finally:os.close(other)
        finally:os.close(fd)
    print('DARWIN_METADATA_FIXTURE_PASS')
    return 0


if __name__=='__main__':
    try:sys.exit(main())
    except Exception:sys.exit(1)  # no path, raw OS exception, traceback or fixture bytes
