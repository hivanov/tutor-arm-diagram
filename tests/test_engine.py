"""Unit tests for ARM Diagram grading and validation engine."""

import pytest

from arm_diagram_xblock.engine import evaluate_arm_graph, name_matches, normalize_name
from arm_diagram_xblock.models import (
    ARMApplication,
    ARMDataObject,
    ARMDependency,
    ARMGraph,
    ARMHint,
    ARMLabScenario,
    ARMService,
    FeedbackSeverity,
    ForbiddenDependencyCriterion,
    HintTier,
    RequiredAppCriterion,
    RequiredDataObjectCriterion,
    RequiredDependencyCriterion,
    RequiredServiceCriterion,
    ServiceType,
    SyncType,
)


@pytest.fixture
def kaufland_lab_scenario():
    """Fixture providing standard Kaufland InStore Navigation scenario."""
    return ARMLabScenario(
        id="kaufland_lab",
        title="Kaufland InStore Navigation Lab",
        description="Model the Kaufland InStore Navigation architecture in ARM.",
        max_attempts=3,
        passing_score=0.75,
        required_apps=[
            RequiredAppCriterion(
                name="Kaufland Card App",
                aliases=["K-App", "Kaufland App"],
                points=1.0,
                required_services=[
                    RequiredServiceCriterion(
                        name="InStore Navigation",
                        aliases=["Navigation"],
                        service_type=ServiceType.UI,
                        points=0.5,
                    )
                ],
                required_data_objects=[
                    RequiredDataObjectCriterion(
                        name="Cart Data",
                        aliases=["Shopping List"],
                        points=0.5,
                    )
                ],
            ),
            RequiredAppCriterion(
                name="CIDAAS",
                aliases=["Identity Provider"],
                points=1.0,
                required_services=[
                    RequiredServiceCriterion(
                        name="OAuth API",
                        aliases=["Auth API"],
                        service_type=ServiceType.REST_API,
                        points=0.5,
                    )
                ],
            ),
        ],
        required_dependencies=[
            RequiredDependencyCriterion(
                source_app="Kaufland Card App",
                target_app="CIDAAS",
                target_service="OAuth API",
                sync_type=SyncType.SYNC,
                points=1.5,
                explanation="Card app authenticates user session via CIDAAS.",
            )
        ],
        forbidden_dependencies=[
            ForbiddenDependencyCriterion(
                source_app="Kaufland Card App",
                target_app="CIDAAS DB",
                penalty=1.0,
                reason="Do not couple directly to internal DB; consume public OAuth API.",
            )
        ],
        hints=[
            ARMHint(tier=HintTier.TIER_1_GUIDING, text="Think about the 2 main applications."),
            ARMHint(tier=HintTier.TIER_2_CONTEXT, text="Declare the external service on CIDAAS."),
            ARMHint(tier=HintTier.TIER_3_DIAGNOSTIC, text="Connect K-App to OAuth API on CIDAAS."),
        ],
    )


def test_name_matching():
    """Test resilient name matching with casing and punctuation."""
    assert normalize_name("K-App") == "kapp"
    assert normalize_name("Kaufland_Card_App!") == "kauflandcardapp"

    assert name_matches("K-App", "K-App")
    assert name_matches("K-App", "Kaufland Card App", aliases=["K-App", "Kaufland App"])
    assert name_matches("oauth api", "OAuth API")
    assert not name_matches("Random Service", "OAuth API")


def test_perfect_arm_diagram_submission(kaufland_lab_scenario):
    """Test 100% correct student submission."""
    app1 = ARMApplication(
        id="app1",
        name="Kaufland Card App",
        services=[ARMService(id="s1", name="InStore Navigation", service_type=ServiceType.UI)],
        data_objects=[ARMDataObject(id="d1", name="Cart Data")],
    )
    app2 = ARMApplication(
        id="app2",
        name="CIDAAS",
        services=[ARMService(id="s2", name="OAuth API", service_type=ServiceType.REST_API)],
    )
    dep1 = ARMDependency(
        id="dep1",
        source_app_id="app1",
        target_app_id="app2",
        target_service_id="s2",
        sync_type=SyncType.SYNC,
    )
    graph = ARMGraph(applications=[app1, app2], dependencies=[dep1])

    result = evaluate_arm_graph(graph=graph, scenario=kaufland_lab_scenario)

    assert result.passed is True
    assert result.score == result.max_score
    assert result.percentage == 1.0
    assert result.attempts_remaining == 2
    assert all(f.severity == FeedbackSeverity.SUCCESS for f in result.feedbacks)


def test_partial_arm_diagram_missing_service(kaufland_lab_scenario):
    """Test submission with missing service interface."""
    app1 = ARMApplication(
        id="app1",
        name="K-App",
        services=[],  # Missing InStore Navigation
        data_objects=[ARMDataObject(id="d1", name="Cart Data")],
    )
    app2 = ARMApplication(
        id="app2",
        name="CIDAAS",
        services=[ARMService(id="s2", name="OAuth API", service_type=ServiceType.REST_API)],
    )
    dep1 = ARMDependency(
        id="dep1",
        source_app_id="app1",
        target_app_id="app2",
        target_service_id="s2",
    )
    graph = ARMGraph(applications=[app1, app2], dependencies=[dep1])

    result = evaluate_arm_graph(graph=graph, scenario=kaufland_lab_scenario)

    assert result.score < result.max_score
    assert result.percentage >= kaufland_lab_scenario.passing_score  # Still passes threshold
    # Verify specific error feedback for missing service
    err = next((f for f in result.feedbacks if f.entity_type == "Service" and f.severity == FeedbackSeverity.ERROR), None)
    assert err is not None
    assert "Missing expected service interface" in err.message


def test_anti_pattern_penalty(kaufland_lab_scenario):
    """Test penalty applied for forbidden dependency."""
    app1 = ARMApplication(id="app1", name="Kaufland Card App")
    app2 = ARMApplication(id="app2", name="CIDAAS DB")
    dep1 = ARMDependency(id="dep1", source_app_id="app1", target_app_id="app2")
    graph = ARMGraph(applications=[app1, app2], dependencies=[dep1])

    result = evaluate_arm_graph(graph=graph, scenario=kaufland_lab_scenario)
    assert result.passed is False
    anti_pat = next((f for f in result.feedbacks if f.entity_type == "Architecture"), None)
    assert anti_pat is not None
    assert "Anti-Pattern Violation" in anti_pat.message


def test_progressive_hints(kaufland_lab_scenario):
    """Test progressive hint index retrieval."""
    graph = ARMGraph(applications=[], dependencies=[])
    res_hint_0 = evaluate_arm_graph(graph=graph, scenario=kaufland_lab_scenario, current_hint_index=0)
    assert res_hint_0.current_hint == "Think about the 2 main applications."

    res_hint_2 = evaluate_arm_graph(graph=graph, scenario=kaufland_lab_scenario, current_hint_index=2)
    assert res_hint_2.current_hint == "Connect K-App to OAuth API on CIDAAS."
