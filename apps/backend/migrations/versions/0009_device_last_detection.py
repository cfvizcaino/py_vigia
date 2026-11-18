"""El último contacto de un nodo también sale de sus detecciones, no solo de los eventos crudos.

0007 tomó `last_event_at` de `ingested_events`, que se borran a los 7 días: un nodo que no
publicó esa semana quedó como «sin conectar» aunque tenga detecciones más viejas.
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = depends_on = None


def upgrade():
    op.execute(
        "UPDATE devices SET last_event_at = (SELECT MAX(created_at) FROM detections "
        "WHERE detections.device_id = devices.id) WHERE last_event_at IS NULL"
    )


def downgrade():
    # Data only: the column stays as 0007 left it.
    pass
