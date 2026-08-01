"""Shared validation for opt-in data-retention settings."""

from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.management.base import CommandError


def configured_duration(setting_name, unit, optional=False):
    """Return a validated non-negative setting as a timedelta."""
    value = getattr(settings, setting_name, None)
    if value is None or (isinstance(value, str) and not value.strip()):
        if optional:
            return None
        raise CommandError(f'{setting_name} must be a non-negative number; it cannot be empty')
    if isinstance(value, bool):
        raise CommandError(f'{setting_name} must be a non-negative number, not {value!r}')

    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise CommandError(f'{setting_name} must be a non-negative number, not {value!r}') from exc
    if not number.is_finite() or number < 0:
        raise CommandError(f'{setting_name} must be a non-negative number, not {value!r}')

    try:
        return timedelta(**{unit: float(number)})
    except OverflowError as exc:
        raise CommandError(f'{setting_name} is too large to use as a retention duration') from exc
