from django.db import migrations

CREATE_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION fss_notify_assetcommand() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('fss_command', NEW.asset_id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

CREATE_TRIGGER_SQL = """
CREATE TRIGGER fss_assetcommand_notify
    AFTER INSERT ON assets_assetcommand
    FOR EACH ROW EXECUTE FUNCTION fss_notify_assetcommand();
"""

DROP_TRIGGER_SQL = """
DROP TRIGGER fss_assetcommand_notify ON assets_assetcommand;
"""

DROP_FUNCTION_SQL = """
DROP FUNCTION fss_notify_assetcommand();
"""


def create_assetcommand_notify(_apps, schema_editor):
    """Install the command notification trigger on production PostgreSQL."""
    if schema_editor.connection.vendor != "postgresql":
        return

    schema_editor.execute(CREATE_FUNCTION_SQL)
    schema_editor.execute(CREATE_TRIGGER_SQL)


def drop_assetcommand_notify(_apps, schema_editor):
    """Remove the command notification trigger from PostgreSQL."""
    if schema_editor.connection.vendor != "postgresql":
        return

    schema_editor.execute(DROP_TRIGGER_SQL)
    schema_editor.execute(DROP_FUNCTION_SQL)


class Migration(migrations.Migration):

    dependencies = [
        ("assets", "0011_assetcommandconfirmation"),
    ]

    operations = [
        migrations.RunPython(
            create_assetcommand_notify,
            drop_assetcommand_notify,
        ),
    ]
