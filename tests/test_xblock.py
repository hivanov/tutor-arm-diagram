"""Unit tests for ARMDiagramXBlock runtime, views, and handlers."""

import json
import webob
from xblock.field_data import DictFieldData
from xblock.fields import ScopeIds
from xblock.test.tools import TestRuntime

from arm_diagram_xblock.xblock import ARMDiagramXBlock


def create_arm_xblock():
    """Create test instance of ARMDiagramXBlock."""
    field_data = DictFieldData({})
    scope_ids = ScopeIds(
        user_id="test_student_101",
        block_type="arm_diagram",
        def_id="def_arm",
        usage_id="block-v1:Schwarz+ARM101+type@arm_diagram+block@lab1",
    )
    runtime = TestRuntime(services={"field-data": field_data})
    block = runtime.construct_xblock_from_class(ARMDiagramXBlock, scope_ids=scope_ids)
    block.display_name = "Kaufland InStore Navigation Lab"
    block.weight = 10.0
    return block


def make_post_request(data: dict) -> webob.Request:
    """Helper to create webob JSON POST request."""
    req = webob.Request.blank("/")
    req.method = "POST"
    req.body = json.dumps(data).encode("utf-8")
    return req


def test_student_view_renders():
    """Test student_view fragment generation."""
    block = create_arm_xblock()
    frag = block.student_view()
    assert frag is not None
    assert "arm-diagram-container" in frag.content
    assert "arm-toolbar" in frag.content
    assert "arm-canvas-wrapper" in frag.content


def test_studio_view_renders():
    """Test studio_view fragment generation."""
    block = create_arm_xblock()
    frag = block.studio_view()
    assert frag is not None
    assert "arm-studio-wrapper" in frag.content
    assert "Scenario & Grading Specification" in frag.content


def test_submit_solution_handler_perfect():
    """Test submit_solution handler with a valid graph."""
    block = create_arm_xblock()

    student_graph = {
        "applications": [
            {
                "id": "app1",
                "name": "Kaufland Card App",
                "services": [{"id": "s1", "name": "InStore Navigation", "service_type": "UI"}],
                "data_objects": [{"id": "d1", "name": "Cart Data"}],
            },
            {
                "id": "app2",
                "name": "CIDAAS",
                "services": [{"id": "s2", "name": "OAuth API", "service_type": "REST_API"}],
                "data_objects": [],
            },
        ],
        "dependencies": [
            {
                "id": "dep1",
                "source_app_id": "app1",
                "target_app_id": "app2",
                "target_service_id": "s2",
                "sync_type": "SYNC",
            }
        ],
    }

    req = make_post_request({"graph": student_graph})
    resp = block.submit_solution(req)
    res_data = json.loads(resp.body)

    assert res_data["success"] is True
    assert res_data["evaluation"]["passed"] is True
    assert block.has_submitted is True
    assert block.attempts_used == 1
    assert block.score > 0.0


def test_submit_solution_max_attempts_lockout():
    """Test max attempts lockout."""
    block = create_arm_xblock()
    block.attempts_used = 3  # Max reached

    req = make_post_request({"graph": {"applications": [], "dependencies": []}})
    resp = block.submit_solution(req)
    res_data = json.loads(resp.body)

    assert res_data["success"] is False
    assert "Maximum attempts" in res_data["error"]


def test_get_hint_handler():
    """Test get_hint handler."""
    block = create_arm_xblock()
    req = make_post_request({})

    resp = block.get_hint(req)
    res_data = json.loads(resp.body)

    assert res_data["success"] is True
    assert res_data["tier_index"] == 1
    assert "applications" in res_data["hint_text"].lower()


def test_reset_diagram_handler():
    """Test reset_diagram handler."""
    block = create_arm_xblock()
    block.student_graph_json = json.dumps({"applications": [{"id": "1", "name": "Old App"}], "dependencies": []})

    req = make_post_request({})
    resp = block.reset_diagram(req)
    res_data = json.loads(resp.body)

    assert res_data["success"] is True
    assert res_data["graph"]["applications"] == []
    assert json.loads(block.student_graph_json)["applications"] == []


def test_studio_submit_handler():
    """Test saving settings from studio."""
    block = create_arm_xblock()
    req = make_post_request({
        "display_name": "Updated ARM Lab Title",
        "weight": 15.0,
        "scenario_json": block.scenario_json,
    })

    resp = block.studio_submit(req)
    res_data = json.loads(resp.body)

    assert res_data["success"] is True
    assert block.display_name == "Updated ARM Lab Title"
    assert block.weight == 15.0
