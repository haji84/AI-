import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('patcher', Path(__file__).with_name('driver_start_pipeline.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PipelineTests(unittest.TestCase):
    def test_original_global_and_line_caps_and_all_assertions_remain(self):
        a = (ROOT / 'tests/owner-code-cutover-peer.fixture.ps1').read_text(encoding='utf-8')
        b = m.patch(a)
        for literal in ('2500-$watch.ElapsedMilliseconds', '14000-$script:peerProgressWatch.ElapsedMilliseconds',
                        'JOB_WINDOWS_EARLY_NO_HELLO', 'JOB_NATIVE_CLOSE_RETURN_CONFIRMED',
                        'JOB_OUTSIDE_ORIGINAL_START', 'JOB_ORIGINAL_MANAGER_STOP', 'JOB_EARLY_DRIVER_STDERR'):
            self.assertEqual(a.count(literal), b.count(literal), literal)
        self.assertIn('finally{[Console]::InputEncoding=$priorDriverInputEncoding}', b)
        self.assertIn('JOB_PREPARED_DRIVER_CLEANUP_UNCONFIRMED', b)

    def test_only_two_fixed_drivers_prepare_and_each_result_is_consumed_once(self):
        a = (ROOT / 'tests/owner-code-cutover-peer.fixture.ps1').read_text(encoding='utf-8')
        b = m.patch(a)
        self.assertIn('foreach($preparedGroup in @(2,1))', b)
        self.assertEqual(b.count('$preparedDrivers[$preparedGroup]=New-PublicPrivateJobDriver'), 1)
        self.assertEqual(b.count('Complete-PublicPrivateJobDriver $earlyDriver'), 1)
        self.assertEqual(b.count('Complete-PublicPrivateJobDriver $driver;'), 1)
        self.assertIn('$Driver.readConsumed=$true;', b)

    def test_unknown_changed_or_already_patched_source_is_refused(self):
        with self.assertRaises(ValueError):
            m.patch('unknown source')
        a = (ROOT / 'tests/owner-code-cutover-peer.fixture.ps1').read_text(encoding='utf-8')
        with self.assertRaises(ValueError):
            m.patch(m.patch(a))


if __name__ == '__main__':
    unittest.main()
