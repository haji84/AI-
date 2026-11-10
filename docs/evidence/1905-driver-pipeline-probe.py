#!/usr/bin/env python3
"""Reuse the original bounded harness; compare only a source-pinned candidate."""
import importlib.util
from pathlib import Path
import sys


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    root = Path(__file__).parent
    harness = load('driver_boundary_harness', root / '1905-driver-boundary.py')
    pipeline = load('driver_pipeline_candidate', root / 'driver_start_pipeline.py')
    original_candidate, original_run_case = harness.candidate, harness.run_case

    def candidate(source, mode):
        return pipeline.patch(source) if mode == 'bomfree-start' else original_candidate(source, mode)

    def run_case(source, mode, folder, instrumented):
        result = original_run_case(source, mode, folder, instrumented)
        if mode == 'bomfree-start':
            result['mode'] = 'prepared-drivers-with-bomfree-start'
            result['same_original_global_and_line_caps'] = True
            result['same_original_assertions'] = True
        return result

    harness.candidate, harness.run_case = candidate, run_case
    return harness.run()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError):
        print('PR1905_DRIVER_PIPELINE_REFUSED', file=sys.stderr)
        raise SystemExit(1)
