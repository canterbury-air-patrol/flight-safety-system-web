"""
Make assets editable in the admin interface
"""

from django.contrib import admin

from .models import Asset, AssetCommand


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    """Manage an asset's lifecycle without deleting its identity."""

    list_display = ('name', 'is_active', 'retired_at')
    list_filter = ('retired_at', )
    fields = ('name', 'retired_at')
    actions = None

    @admin.display(boolean=True, description='Active')
    def is_active(self, obj):
        """Return whether the asset remains available to active APIs."""
        return obj.retired_at is None

    def has_delete_permission(self, request, obj=None):
        """Assets are retired, never deleted through the admin."""
        return False


@admin.register(AssetCommand)
class AssetCommandAdmin(admin.ModelAdmin):
    """
    Read-only audit view of dispatched commands, including who issued each one.

    Commands are an audit trail: the admin can browse and filter them but must
    not add, edit, or delete rows, so the permission hooks below all deny
    modification and bulk actions are disabled.
    """
    list_display = ('timestamp', 'asset', 'command', 'issued_by', 'ack_state')
    list_filter = ('command', 'ack_state', 'issued_by')
    date_hierarchy = 'timestamp'
    actions = None

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
