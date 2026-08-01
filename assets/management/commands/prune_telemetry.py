"""
Delete telemetry older than configured table and aligned per-asset windows.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Max
from django.utils import timezone

from assets.management.retention import configured_duration
from assets.models import AssetPosition, AssetRTT, AssetSearchProgress, AssetStatus

TELEMETRY_TABLES = (
    ('position', AssetPosition, 'TELEMETRY_POSITION_RETENTION_DAYS'),
    ('status', AssetStatus, 'TELEMETRY_STATUS_RETENTION_DAYS'),
    ('RTT', AssetRTT, 'TELEMETRY_RTT_RETENTION_DAYS'),
    ('search progress', AssetSearchProgress, 'TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS'),
)
ALIGNED_WINDOW_SETTING = 'TELEMETRY_ALIGNED_WINDOW_HOURS'

class Command(BaseCommand):
    """Prune age-limited telemetry without shortening the shared asset window."""

    help = (
        'Delete telemetry older than its configured table retention while '
        'preserving an aligned recent window for each asset.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--batch-size',
            type=int,
            default=1000,
            help='Maximum rows deleted in each transaction (default: 1000).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report rows eligible for deletion without deleting them.',
        )

    def handle(self, *args, **options):
        if options['batch_size'] <= 0:
            raise CommandError('--batch-size must be greater than zero')

        retention = {
            model: configured_duration(setting_name, 'days', optional=True)
            for _label, model, setting_name in TELEMETRY_TABLES
        }
        aligned_window = configured_duration(ALIGNED_WINDOW_SETTING, 'hours')
        enabled_tables = [
            (label, model)
            for label, model, _setting_name in TELEMETRY_TABLES
            if retention[model] is not None
        ]

        if not enabled_tables:
            self.stdout.write('No telemetry retention limits are configured; nothing to prune.')
            return

        now = timezone.now()
        asset_latest = self._asset_latest_timestamps()
        total = 0
        for label, model in enabled_tables:
            retention_cutoff = now - retention[model]
            eligible = self._eligible_querysets(
                model, asset_latest, retention_cutoff, aligned_window
            )
            if options['dry_run']:
                row_count = sum(queryset.count() for queryset in eligible)
            else:
                row_count = sum(
                    self._delete_in_batches(model, queryset, options['batch_size'])
                    for queryset in eligible
                )
            total += row_count
            action = 'would delete' if options['dry_run'] else 'deleted'
            self.stdout.write(f'{label}: {action} {row_count} row(s)')

        action = 'would delete' if options['dry_run'] else 'deleted'
        self.stdout.write(self.style.SUCCESS(f'Total: {action} {total} telemetry row(s)'))

    @staticmethod
    def _asset_latest_timestamps():
        """
        Find one reference timestamp per asset before any table is modified.
        """
        asset_latest = {}
        for _label, model, _setting_name in TELEMETRY_TABLES:
            latest_rows = model.objects.values('asset_id').annotate(latest=Max('timestamp'))
            for row in latest_rows:
                previous = asset_latest.get(row['asset_id'])
                if previous is None or row['latest'] > previous:
                    asset_latest[row['asset_id']] = row['latest']
        return asset_latest

    @staticmethod
    def _eligible_querysets(model, asset_latest, retention_cutoff, aligned_window):
        for asset_id, latest_timestamp in asset_latest.items():
            effective_cutoff = retention_cutoff
            if aligned_window:
                effective_cutoff = min(
                    retention_cutoff,
                    latest_timestamp - aligned_window,
                )
            yield model.objects.filter(
                asset_id=asset_id,
                timestamp__lt=effective_cutoff,
            )

    @staticmethod
    def _delete_in_batches(model, queryset, batch_size):
        deleted_rows = 0
        while True:
            primary_keys = list(
                queryset.order_by('pk').values_list('pk', flat=True)[:batch_size]
            )
            if not primary_keys:
                return deleted_rows
            _deleted_total, deleted_by_model = model.objects.filter(
                pk__in=primary_keys
            ).delete()
            deleted_rows += deleted_by_model.get(model._meta.label, 0)
