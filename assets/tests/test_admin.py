"""
Tests for the assets admin.
"""
from django.contrib.admin.sites import AdminSite
from django.test import TestCase

from assets.admin import AssetCommandAdmin
from assets.models import AssetCommand


class AssetCommandAdminTest(TestCase):
    """
    The command admin is a read-only audit view; modification must be denied so
    the audit trail of who issued what stays immutable.
    """
    def setUp(self):
        self.admin = AssetCommandAdmin(AssetCommand, AdminSite())

    def test_modifications_denied(self):
        """Add, change, and delete are all refused and bulk actions disabled."""
        self.assertFalse(self.admin.has_add_permission(None))
        self.assertFalse(self.admin.has_change_permission(None))
        self.assertFalse(self.admin.has_delete_permission(None))
        self.assertIsNone(self.admin.actions)
