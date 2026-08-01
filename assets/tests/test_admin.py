"""
Tests for the assets admin.
"""
from django.contrib.admin.sites import AdminSite
from django.test import TestCase

from assets.admin import AssetAdmin, AssetCommandAckAdmin, AssetCommandAdmin
from assets.models import Asset, AssetCommand, AssetCommandAck


class AssetAdminTest(TestCase):
    """Assets leave service through retirement, not admin deletion."""

    def test_delete_paths_are_disabled(self):
        """Neither object nor bulk deletion is available for assets."""
        asset_admin = AssetAdmin(Asset, AdminSite())

        self.assertFalse(asset_admin.has_delete_permission(None))
        self.assertIsNone(asset_admin.actions)


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


class AssetCommandAckAdminTest(TestCase):
    """Acknowledgement history is append-only outside retention cleanup."""

    def test_modifications_denied(self):
        """The admin exposes acknowledgement rows only for investigation."""
        ack_admin = AssetCommandAckAdmin(AssetCommandAck, AdminSite())

        self.assertFalse(ack_admin.has_add_permission(None))
        self.assertFalse(ack_admin.has_change_permission(None))
        self.assertFalse(ack_admin.has_delete_permission(None))
        self.assertIsNone(ack_admin.actions)
