import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).with_name('1905-driver-boundary.py')
spec = importlib.util.spec_from_file_location('driver_boundary', MODULE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class TransportTests(unittest.TestCase):
    def test_unique_anchor_is_fail_closed(self):
        self.assertEqual(m.once('before OLD after', 'OLD', 'NEW'), 'before NEW after')
        for source in ('missing', 'OLD OLD'):
            with self.assertRaises(ValueError):
                m.once(source, 'OLD', 'NEW')

    def test_report_never_reflects_arbitrary_log_text(self):
        report = m.summarize('PUBLIC_WINDOWS_JOB_LAST_STAGE=EARLY_CHILD_SENT\nPRIVATE_SECRET\nError timeout', 1, 0.125)
        self.assertEqual(report['last_stage'], 'EARLY_CHILD_SENT')
        self.assertNotIn('PRIVATE_SECRET', str(report))
        self.assertEqual(m.summarize('PUBLIC_WINDOWS_JOB_LAST_STAGE=PRIVATE_SECRET', 1, 0)['last_stage'], 'UNKNOWN')

    def test_candidate_changes_only_owned_writer_or_receiver(self):
        source = 'A $writer.Flush();if($Group -eq 2) B $line=[Console]::In.ReadLine(); C'
        closed = m.candidate(source, 'early-eof')
        self.assertEqual(closed, 'A $writer.Flush();if($Group -eq 2){$writer.Close()};if($Group -eq 2) B $line=[Console]::In.ReadLine(); C')
        with self.assertRaises(ValueError):
            m.candidate(source, 'unknown')
        self.assertEqual(m.candidate(source, 'baseline'), source)


if __name__ == '__main__':
    unittest.main()
