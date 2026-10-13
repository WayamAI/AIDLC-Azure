import pytest
from app.services import organization_service


@pytest.mark.anyio
async def test_create_organization(db):
    org = await organization_service.create_organization(db, workos_org_id="org_abc123", name="Acme Inc")
    assert org.workos_org_id == "org_abc123"
    assert org.name == "Acme Inc"
    assert org.plan == "free"
    assert org.id


@pytest.mark.anyio
async def test_get_by_workos_id_found(db):
    created = await organization_service.create_organization(db, workos_org_id="org_abc123", name="Acme Inc")
    found = await organization_service.get_by_workos_id(db, "org_abc123")
    assert found is not None
    assert found.id == created.id


@pytest.mark.anyio
async def test_get_by_workos_id_not_found(db):
    found = await organization_service.get_by_workos_id(db, "org_does_not_exist")
    assert found is None


@pytest.mark.anyio
async def test_get_by_id(db):
    created = await organization_service.create_organization(db, workos_org_id="org_abc123", name="Acme Inc")
    found = await organization_service.get_by_id(db, created.id)
    assert found is not None
    assert found.workos_org_id == "org_abc123"
