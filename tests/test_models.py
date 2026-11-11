"""Unit tests for ARM Diagram Pydantic v2 data models."""

import pytest
from pydantic import ValidationError

from arm_diagram_xblock.models import (
    ARMApplication,
    ARMDataObject,
    ARMDependency,
    ARMGraph,
    ARMLabScenario,
    ARMService,
    ForbiddenDependencyCriterion,
    HintTier,
    RequiredAppCriterion,
    RequiredDataObjectCriterion,
    RequiredDependencyCriterion,
    RequiredServiceCriterion,
    ServiceType,
    SyncType,
)


def test_arm_data_object_validation():
    """Test valid and invalid data object models."""
    data = ARMDataObject(id="d1", name="Cart Data", classification="Transactional")
    assert data.id == "d1"
    assert data.name == "Cart Data"
    assert data.classification == "Transactional"

    with pytest.raises(ValidationError):
        ARMDataObject(id="d2", name="   ")


def test_arm_service_validation():
    """Test service interface validation."""
    srv = ARMService(id="s1", name="OAuth API", service_type=ServiceType.REST_API)
    assert srv.id == "s1"
    assert srv.name == "OAuth API"
    assert srv.service_type == ServiceType.REST_API

    with pytest.raises(ValidationError):
        ARMService(id="s2", name="")


def test_arm_application_deduplication():
    """Test duplicate child IDs within application raise error."""
    s1 = ARMService(id="s1", name="API 1")
    s2 = ARMService(id="s1", name="API 2")  # Duplicate ID
    with pytest.raises(ValidationError, match="Duplicate service id"):
        ARMApplication(id="app1", name="K-App", services=[s1, s2])

    d1 = ARMDataObject(id="d1", name="Data 1")
    d2 = ARMDataObject(id="d1", name="Data 2")  # Duplicate ID
    with pytest.raises(ValidationError, match="Duplicate data object id"):
        ARMApplication(id="app1", name="K-App", data_objects=[d1, d2])


def test_arm_graph_integrity_validation():
    """Test graph validator checks dangling references."""
    app1 = ARMApplication(
        id="app1",
        name="Kaufland Card App",
        services=[ARMService(id="srv1", name="InStore Nav", service_type=ServiceType.UI)],
    )
    app2 = ARMApplication(
        id="app2",
        name="CIDAAS",
        services=[ARMService(id="srv2", name="OAuth API", service_type=ServiceType.REST_API)],
    )

    # Valid graph
    valid_dep = ARMDependency(
        id="dep1",
        source_app_id="app1",
        target_app_id="app2",
        target_service_id="srv2",
        sync_type=SyncType.SYNC,
    )
    graph = ARMGraph(applications=[app1, app2], dependencies=[valid_dep])
    assert len(graph.applications) == 2
    assert len(graph.dependencies) == 1

    # Dangling source app
    bad_dep_src = ARMDependency(
        id="dep2",
        source_app_id="non_existent",
        target_app_id="app2",
    )
    with pytest.raises(ValidationError, match="non-existent source app"):
        ARMGraph(applications=[app1, app2], dependencies=[bad_dep_src])

    # Dangling target service
    bad_dep_srv = ARMDependency(
        id="dep3",
        source_app_id="app1",
        target_app_id="app2",
        target_service_id="non_existent_srv",
    )
    with pytest.raises(ValidationError, match="non-existent target service"):
        ARMGraph(applications=[app1, app2], dependencies=[bad_dep_srv])


def test_lab_scenario_validation():
    """Test scenario model instantiation."""
    scenario = ARMLabScenario(
        id="scen_1",
        title="Test Lab",
        description="Test Description",
        required_apps=[
            RequiredAppCriterion(
                name="App 1",
                required_services=[RequiredServiceCriterion(name="Service A", service_type=ServiceType.REST_API)],
                required_data_objects=[RequiredDataObjectCriterion(name="Data A")],
            )
        ],
        required_dependencies=[
            RequiredDependencyCriterion(
                source_app="App 1",
                target_app="App 2",
            )
        ],
        forbidden_dependencies=[
            ForbiddenDependencyCriterion(
                source_app="App 1",
                target_app="App 2 DB",
                penalty=1.0,
                reason="Anti-pattern",
            )
        ],
    )
    assert scenario.id == "scen_1"
    assert len(scenario.required_apps) == 1
    assert len(scenario.forbidden_dependencies) == 1
