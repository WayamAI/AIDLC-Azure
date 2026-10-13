from datetime import datetime
from pydantic import BaseModel


class OrganizationOut(BaseModel):
    id: str
    workos_org_id: str
    name: str
    created_at: datetime
    plan: str = "free"
