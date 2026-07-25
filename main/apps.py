"""
App definition for the main pages
"""
from django.apps import AppConfig


class MainConfig(AppConfig):
    """
    Define the Main app
    """
    name = 'main'

    def ready(self):
        """
        Register authentication security signal handlers.
        """
        # pylint: disable=unused-import,import-outside-toplevel
        from fss import security
