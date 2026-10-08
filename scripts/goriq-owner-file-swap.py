"""Atomically exchange two existing regular owner files; never fall back to overwrite."""
import ctypes
import os
import stat
import sys

def exchange(a, b):
    if not all(os.path.isabs(p) for p in (a, b)):
        raise ValueError()
    for path in (a, b):
        item = os.lstat(path)
        if not stat.S_ISREG(item.st_mode) or item.st_nlink != 1 or item.st_uid != os.getuid():
            raise ValueError()
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        fn = libc.renamex_np
        fn.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        result = fn(os.fsencode(a), os.fsencode(b), 2)  # Apple RENAME_SWAP
    elif sys.platform.startswith('linux'):
        fn = libc.renameat2
        fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        result = fn(-100, os.fsencode(a), -100, os.fsencode(b), 2)  # Linux RENAME_EXCHANGE
    else:
        raise ValueError()
    if result != 0:
        raise OSError()

if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError()
        exchange(sys.argv[1], sys.argv[2])
    except Exception:
        sys.exit(1)  # no private paths, errno text or traceback
