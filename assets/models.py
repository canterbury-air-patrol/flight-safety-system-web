"""
Database models for Assets and associated data
"""

import uuid

from django.conf import settings
from django.contrib.gis.db import models
from django.utils import timezone


class Asset(models.Model):
    """
    An asset
    """
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return f"Asset: {self.name}"


class AssetSearchProgress(models.Model):
    """
    A report of how far thru a search an asset is
    """
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(default=timezone.now)
    search = models.IntegerField()
    search_progress = models.IntegerField()
    search_progress_of = models.IntegerField()

    def __str__(self):
        return f"{self.asset} performing search {self.search} @ {self.search_progress} of {self.search_progress_of}"

    class Meta:
        indexes = [
            models.Index(fields=['asset', '-timestamp', ]),
        ]


class AssetStatus(models.Model):
    """
    Last reported (health) status of an asset
    """
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(default=timezone.now)
    bat_percent = models.IntegerField()
    bat_used_mah = models.IntegerField()
    bat_volt = models.FloatField(null=True, default=0.0)

    def __str__(self):
        return f"{self.asset} with {self.bat_percent}% battery remaining ({self.bat_used_mah}mAh used, {self.bat_volt} volts)"

    class Meta:
        indexes = [
            models.Index(fields=['asset', '-timestamp', ]),
        ]


class AssetPosition(models.Model):
    """
    Last reported position of an asset
    """
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(default=timezone.now)
    position = models.PointField(geography=True)
    altitude = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.asset} @ {self.position} alt={self.altitude} ({self.timestamp})"

    class Meta:
        indexes = [
            models.Index(fields=['asset', '-timestamp', ]),
        ]


class AssetRTT(models.Model):
    """
    Last reported RTT of asset
    """
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(default=timezone.now)
    rtt = models.IntegerField()

    def __str__(self):
        return f"{self.asset} RTT {self.rtt}ms @ {self.timestamp}"

    class Meta:
        indexes = [
            models.Index(fields=['asset', '-timestamp', ]),
        ]


class AssetCommand(models.Model):
    """
    Command for asset
    """
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(default=timezone.now)
    COMMAND_CHOICES = (
        ('RTL', "Return to Launch"),
        ('HOLD', "Hold at Current Position"),
        ('GOTO', "Goto Position"),
        ('RON', "Continue"),  # Resume own navigation
        ('DISARM', "Dis-Arm Aircraft"),
        ('ALT', "Adjust Altitude"),
        ('TERM', "Terminate Flight"),
        ('MAN', "Manual"),
    )
    command = models.CharField(max_length=6, choices=COMMAND_CHOICES)
    DESTRUCTIVE_COMMANDS = ('DISARM', 'TERM')
    REQUIRES_POSITION = ('GOTO', )
    position = models.PointField(geography=True, null=True, blank=True)
    REQUIRES_ALTITUDE = ('ALT', )
    ALTITUDE_MAX_FT = 999
    altitude = models.IntegerField(null=True, blank=True)

    @classmethod
    def allowed_parameter_names(cls, command):
        """Return the complete POST parameter contract for a command."""
        parameter_names = {'command'}
        if command in cls.REQUIRES_POSITION:
            parameter_names.update(('latitude', 'longitude'))
        if command in cls.REQUIRES_ALTITUDE:
            parameter_names.add('altitude')
        if command in cls.DESTRUCTIVE_COMMANDS:
            parameter_names.add('confirmation_token')
        return parameter_names

    # Who dispatched this command, recorded for the audit trail of a
    # safety-critical action (a TERM/DISARM can destroy the aircraft). NULL when
    # the row was not created by an authenticated web user (e.g. rows predating
    # this field) or after that account is deleted: SET_NULL preserves the
    # command record rather than cascading the audit history away with the user.
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='+',
    )

    # Acknowledgement tracking. The FSS server stamps a per-connection
    # monotonic id onto the dispatched command message and writes it back to
    # dispatch_id; the FMU echoes that id in its command-ack, which the server
    # matches to this row and uses to update the ack_* fields below. These are
    # all populated server-side, not by this app, so they stay nullable
    # (a NULL ack_state means dispatched but not yet acknowledged).
    ACK_RECEIVED = 0    # reached the asset, not yet actioned
    ACK_ACTIONED = 1    # state machine transitioned
    ACK_SUPERSEDED = 2  # not actioned: a higher-priority latch is engaged
    ACK_REJECTED = 3    # unknown/malformed/invalid command
    ACK_NOOP = 4        # command resolved to the already-current state; nothing changed
    ACK_STATE_CHOICES = (
        (ACK_RECEIVED, "Received"),
        (ACK_ACTIONED, "Actioned"),
        (ACK_SUPERSEDED, "Superseded"),
        (ACK_REJECTED, "Rejected"),
        (ACK_NOOP, "No change"),
    )
    # Reason a command was superseded (fss_command_ack_reason). Distinct from a
    # command value so e.g. low-battery RTL and comms-loss RTL stay separable.
    # Only set (non-zero) when ack_state == ACK_SUPERSEDED.
    SUPERSEDE_NONE = 0
    SUPERSEDE_LOW_BATTERY = 1
    SUPERSEDE_COMMS_LOSS = 2
    SUPERSEDE_NEWER_COMMAND = 3
    SUPERSEDE_REASON_CHOICES = (
        (SUPERSEDE_NONE, "None"),
        (SUPERSEDE_LOW_BATTERY, "Low Battery"),
        (SUPERSEDE_COMMS_LOSS, "Comms Loss"),
        (SUPERSEDE_NEWER_COMMAND, "Newer Command"),
    )
    dispatch_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    ack_state = models.SmallIntegerField(null=True, blank=True, choices=ACK_STATE_CHOICES)
    ack_timestamp = models.BigIntegerField(null=True, blank=True)  # FMU wall-clock epoch-ms
    ack_superseded_by = models.SmallIntegerField(null=True, blank=True, choices=SUPERSEDE_REASON_CHOICES)

    def __str__(self):
        return f"Command {self.asset} to {self.get_command_display()}"

    class Meta:
        indexes = [
            models.Index(fields=['asset', '-timestamp', ]),
        ]
        constraints = [
            # A concrete supersede reason is only meaningful when the command
            # was actually superseded; NULL / SUPERSEDE_NONE stay unconstrained.
            # Literals (SUPERSEDE_NONE=0, ACK_SUPERSEDED=2) because the nested
            # Meta scope can't see the enclosing class attributes.
            models.CheckConstraint(
                name="ack_superseded_by_requires_superseded_state",
                condition=models.Q(ack_superseded_by__isnull=True) | models.Q(ack_superseded_by=0) | models.Q(ack_state=2),
            ),
        ]


class AssetCommandConfirmation(models.Model):
    """
    Short-lived evidence that a user confirmed a destructive asset command.

    Each token is bound to one user, asset and exact command. The command view
    consumes it atomically when it queues the corresponding command.
    """
    token = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE)
    command = models.CharField(max_length=6, choices=AssetCommand.COMMAND_CHOICES)
    expires_at = models.DateTimeField(db_index=True)

    def __str__(self):
        return f"Confirmation for {self.user} to send {self.command} to {self.asset}"
