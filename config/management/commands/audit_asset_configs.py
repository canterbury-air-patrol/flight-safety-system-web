"""Report conflicting per-asset SMM configuration rows."""

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count

from config.models import AssetConfig


class Command(BaseCommand):
    """Audit the one-optional-config-per-asset invariant."""

    help = 'List asset IDs with multiple AssetConfig rows without exposing credentials.'

    def handle(self, *args, **options):
        duplicates = list(
            AssetConfig.objects
            .values('asset_id')
            .annotate(row_count=Count('pk'))
            .filter(row_count__gt=1)
            .order_by('asset_id')
        )
        if not duplicates:
            self.stdout.write(self.style.SUCCESS('No duplicate AssetConfig rows found.'))
            return

        for duplicate in duplicates:
            self.stdout.write(
                f"asset_id={duplicate['asset_id']} rows={duplicate['row_count']}"
            )
        raise CommandError(
            f"Resolve duplicate AssetConfig rows for {len(duplicates)} asset(s) before migrating."
        )
