"""
Database models for configuration
"""
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from assets.models import Asset


def http_address(address, port, https):
    """
    Convert a server name + port into an http or https url
    """
    if https:
        proto = 'https'
        default_port = 443
    else:
        proto = 'http'
        default_port = 80
    address = f"{proto}://{address}"
    if port != default_port:
        address = f"{address}:{port}"
    return address


class ServerConfig(models.Model):
    """
    Knowledge about another server
    """
    name = models.CharField(max_length=25)
    address = models.CharField(max_length=255)
    active = models.BooleanField(default=True)
    client_port = models.IntegerField(default=20202,
                                      validators=[MaxValueValidator(65535),
                                                  MinValueValidator(1)])
    config_port = models.IntegerField(default=8090,
                                      validators=[MaxValueValidator(65535),
                                                  MinValueValidator(1)])
    https = models.BooleanField(default=False)

    def http_address(self):
        """
        Get the management url of this server
        """
        return http_address(self.address, self.config_port, self.https)

    def __str__(self):
        return f"FSS Server: {self.name} @ {self.address}"

    class Meta:
        indexes = [
            models.Index(fields=['name'], ),
            models.Index(fields=['active'], ),
        ]


class SMMConfig(models.Model):
    """
    Knowledge about a Search Management Map instance
    """
    name = models.CharField(max_length=20)
    address = models.CharField(max_length=255)
    port = models.IntegerField(default=443,
                               validators=[MaxValueValidator(65535),
                                           MinValueValidator(1)])
    https = models.BooleanField(default=True)

    def http_address(self):
        """
        Get the main url of this search management map
        """
        return http_address(self.address, self.port, self.https)

    def __str__(self):
        return f"Search Management Map {self.name} @ {self.address}"


class AssetConfig(models.Model):
    """
    Configuration for an asset
    """
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE)
    smm = models.ForeignKey(SMMConfig, on_delete=models.PROTECT)
    smm_login = models.CharField(max_length=50)
    smm_password = models.CharField(max_length=255)

    def __str__(self):
        return f"Config for {self.asset}, using {self.smm}"

    class Meta:
        indexes = [
            models.Index(fields=['asset', ]),
            models.Index(fields=['smm', ]),
        ]
