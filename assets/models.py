"""
Database models for Assets and associated data
"""

from django.contrib.gis.db import models
from django.utils import timezone


class Asset(models.Model):
    """
    An asset
    """
    name = models.CharField(max_length=100)

    def __str__(self):
        return f"Asset: {self.name}"

    class Meta:
        indexes = [
            models.Index(fields=['name', ]),
        ]


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
            models.Index(fields=['asset', 'timestamp', ]),
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
            models.Index(fields=['asset', 'timestamp', ]),
        ]


class AssetPosition(models.Model):
    """
    Last reported position of an asset
    """
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(default=timezone.now)
    position = models.PointField(geography=True)
    altitude = models.IntegerField(default=0)

    class Meta:
        indexes = [
            models.Index(fields=['asset', 'timestamp', ]),
        ]


class AssetRTT(models.Model):
    """
    Last reported RTT of asset
    """
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE)
    timestamp = models.DateTimeField(default=timezone.now)
    rtt = models.IntegerField()

    class Meta:
        indexes = [
            models.Index(fields=['asset', 'timestamp', ]),
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
    REQUIRES_POSITION = ('GOTO', )
    position = models.PointField(geography=True, null=True, blank=True)
    REQUIRES_ALTITUDE = ('ALT', )
    altitude = models.IntegerField(null=True, blank=True)

    def __str__(self):
        return f"Command {self.asset} to {self.get_command_display()}"

    def get_command_display(self):
        """
        Convert the command into the displayable name
        """
        for command_choice in self.COMMAND_CHOICES:
            if command_choice[0] == self.command:
                return command_choice[1]
        return self.command

    class Meta:
        indexes = [
            models.Index(fields=['asset', 'timestamp', ]),
        ]
