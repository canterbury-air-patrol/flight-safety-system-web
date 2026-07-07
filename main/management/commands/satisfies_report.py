"""
TEST-06: generate a TC-WEB-* traceability report merging @satisfies-tagged
Django tests with `// satisfies: TC-WEB-XXX` comments in the frontend Vitest
suite. The CAP master-plan audit merges this with the Tier-2/Tier-3 collectors
to show which tier the evidence for each TC-WEB-* ID came from.
"""

import json
import re
import unittest
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.test.runner import DiscoverRunner

# Matches "// satisfies: TC-WEB-021" or "// satisfies: TC-WEB-020, TC-WEB-021"
FRONTEND_SATISFIES_RE = re.compile(r'satisfies:\s*([\w,\s-]+)')


def _iter_suite(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from _iter_suite(item)
        else:
            yield item


def collect_django_entries():
    """Discover Django tests and pull out every @satisfies-tagged method."""
    suite = DiscoverRunner().build_suite()
    entries = []
    for test in _iter_suite(suite):
        # pylint: disable=protected-access
        method_name = test._testMethodName
        method = getattr(test, method_name, None)
        tc_ids = getattr(method, 'satisfies_tc_ids', None)
        if not tc_ids:
            continue
        test_id = f'{test.__class__.__module__}.{test.__class__.__qualname__}.{method_name}'
        for tc_id in tc_ids:
            entries.append({'tc_id': tc_id, 'source': 'django', 'test': test_id})
    return entries


def collect_frontend_entries():
    """Scan frontend/*.test.ts(x) for the `// satisfies: TC-WEB-XXX` comment convention."""
    entries = []
    frontend_dir = Path(settings.BASE_DIR) / 'frontend'
    for path in sorted(frontend_dir.glob('*.test.ts*')):
        relative = path.relative_to(settings.BASE_DIR)
        for lineno, line in enumerate(path.read_text(encoding='UTF-8').splitlines(), start=1):
            match = FRONTEND_SATISFIES_RE.search(line)
            if not match:
                continue
            for tc_id in (part.strip() for part in match.group(1).split(',')):
                if tc_id:
                    entries.append({'tc_id': tc_id, 'source': 'jest', 'test': f'{relative}:{lineno}'})
    return entries


class Command(BaseCommand):
    """Generate the TC-WEB-* traceability report (TEST-06) from @satisfies-tagged tests."""

    help = 'Generate the TC-WEB-* traceability report (TEST-06) from @satisfies-tagged tests.'

    def add_arguments(self, parser):
        parser.add_argument('--output', default='satisfies-report.json', help='Path to write the JSON report to.')

    def handle(self, *args, **options):
        entries = collect_django_entries() + collect_frontend_entries()
        entries.sort(key=lambda e: (e['tc_id'], e['source'], e['test']))

        by_tc_id = {}
        for entry in entries:
            by_tc_id.setdefault(entry['tc_id'], []).append(entry)

        report = {
            'generated_by': 'manage.py satisfies_report',
            'tc_ids_covered': sorted(by_tc_id),
            'entries': entries,
        }

        output_path = Path(options['output'])
        output_path.write_text(json.dumps(report, indent=2) + '\n', encoding='UTF-8')

        self.stdout.write(self.style.SUCCESS(f'{len(entries)} satisfies entries across {len(by_tc_id)} TC-WEB-* IDs -> {output_path}'))
