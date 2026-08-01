"""Prune old command-and-ack audit units without deleting commanded state."""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Exists, F, OuterRef, Subquery
from django.utils import timezone

from assets.management.retention import configured_duration
from assets.models import AssetCommand, AssetCommandAck

RETENTION_SETTING = 'COMMAND_AUDIT_RETENTION_DAYS'


class Command(BaseCommand):
    """Apply one opt-in retention policy to commands and their ack history."""

    help = (
        'Delete old command audit units while always preserving every asset\'s '
        'newest commanded state.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--batch-size',
            type=int,
            default=1000,
            help='Maximum command audit units deleted in each transaction (default: 1000).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report eligible commands and acknowledgements without deleting them.',
        )

    def handle(self, *args, **options):
        if options['batch_size'] <= 0:
            raise CommandError('--batch-size must be greater than zero')
        retention = configured_duration(RETENTION_SETTING, 'days', optional=True)
        if retention is None:
            self.stdout.write('Command audit retention is not configured; nothing to prune.')
            return

        cutoff = timezone.now() - retention
        eligible = self._eligible_commands(cutoff)
        if options['dry_run']:
            command_count = eligible.count()
            ack_count = AssetCommandAck.objects.filter(command__in=eligible).count()
        else:
            command_count, ack_count = self._delete_in_batches(
                cutoff,
                options['batch_size'],
            )

        action = 'would delete' if options['dry_run'] else 'deleted'
        self.stdout.write(f'commands: {action} {command_count} row(s)')
        self.stdout.write(f'acknowledgements: {action} {ack_count} row(s)')
        self.stdout.write(self.style.SUCCESS(
            f'Total: {action} {command_count} command audit unit(s) '
            f'and {ack_count} acknowledgement row(s)'
        ))

    @staticmethod
    def _eligible_commands(cutoff):
        """Select old units except every asset's newest command timestamp."""
        latest_command_timestamp = (
            AssetCommand.objects
            .filter(asset_id=OuterRef('asset_id'))
            .order_by('-timestamp')
            .values('timestamp')[:1]
        )
        recent_ack = AssetCommandAck.objects.filter(
            command_id=OuterRef('pk'),
            received_at__gte=cutoff,
        )
        return (
            AssetCommand.objects
            .annotate(asset_latest_timestamp=Subquery(latest_command_timestamp))
            .filter(timestamp__lt=cutoff)
            .filter(timestamp__lt=F('asset_latest_timestamp'))
            .annotate(has_recent_ack=Exists(recent_ack))
            .filter(has_recent_ack=False)
        )

    @classmethod
    def _delete_in_batches(cls, cutoff, batch_size):
        """Lock and recheck each batch before cascading acknowledgement rows."""
        command_count = 0
        ack_count = 0
        while True:
            candidate_ids = list(
                cls._eligible_commands(cutoff)
                .order_by('pk')
                .values_list('pk', flat=True)[:batch_size]
            )
            if not candidate_ids:
                return command_count, ack_count

            with transaction.atomic():
                locked_ids = list(
                    AssetCommand.objects
                    .select_for_update()
                    .filter(pk__in=candidate_ids)
                    .values_list('pk', flat=True)
                )
                eligible_ids = list(
                    cls._eligible_commands(cutoff)
                    .filter(pk__in=locked_ids)
                    .values_list('pk', flat=True)
                )
                if not eligible_ids:
                    continue
                batch_ack_count = AssetCommandAck.objects.filter(
                    command_id__in=eligible_ids
                ).count()
                _deleted_total, deleted_by_model = AssetCommand.objects.filter(
                    pk__in=eligible_ids
                ).delete()
                command_count += deleted_by_model.get(AssetCommand._meta.label, 0)
                ack_count += batch_ack_count
