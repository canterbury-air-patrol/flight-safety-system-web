"""
Make assets editable in the admin interface
"""

from django.contrib import admin

from .models import Asset, AssetCommand


@admin.register(AssetCommand)
class AssetCommandAdmin(admin.ModelAdmin):
    """
    Read-only audit view of dispatched commands, including who issued each one.
    """
    list_display = ('timestamp', 'asset', 'command', 'issued_by', 'ack_state')
    list_filter = ('command', 'ack_state', 'issued_by')
    date_hierarchy = 'timestamp'


admin.site.register(Asset)
