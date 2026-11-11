"""Open edX Architecture Runtime Model (ARM) Diagram XBlock."""

import importlib.resources
import json
import logging
import os
from typing import Any, Dict

from pydantic import ValidationError as PydanticValidationError
from xblock.core import XBlock
from xblock.fields import Boolean, Dict as XBlockDict, Float, Integer, List as XBlockList, Scope, String

try:
    from web_fragments.fragment import Fragment
except ImportError:
    from xblock.fragment import Fragment  # type: ignore[no-redef]

from arm_diagram_xblock.engine import evaluate_arm_graph
from arm_diagram_xblock.models import (
    ARMEvaluationResult,
    ARMGraph,
    ARMHint,
    ARMLabScenario,
    HintTier,
    RequiredAppCriterion,
    RequiredDataObjectCriterion,
    RequiredDependencyCriterion,
    RequiredServiceCriterion,
    ServiceType,
    SyncType,
)

log = logging.getLogger(__name__)


def resource_string(path: str) -> str:
    """Helper to load a static resource file as a unicode string."""
    try:
        parts = path.split("/")
        package = "arm_diagram_xblock"
        if len(parts) > 1:
            rel_path = "/".join(parts)
            ref = importlib.resources.files(package).joinpath(rel_path)
            return ref.read_text(encoding="utf-8")
        else:
            return importlib.resources.files(package).joinpath(path).read_text(encoding="utf-8")
    except Exception as e:
        log.warning(f"Failed to load resource {path} via importlib: {e}")
        base_dir = os.path.dirname(__file__)
        full_path = os.path.join(base_dir, path)
        with open(full_path, encoding="utf-8") as f:
            return f.read()


DEFAULT_SCENARIO = {
    "id": "kaufland_instore_nav_lab",
    "title": "Kaufland InStore Navigation - Macro Architecture Lab",
    "description": (
        "Model the Big Picture Macro Architecture for the Kaufland InStore Navigation feature in the Kaufland Card App. "
        "Create the Kaufland Card App application containing the 'InStore Navigation' service and 'Cart Data' data object. "
        "Create CIDAAS (Identity Provider) providing the 'OAuth API' service, and establish the dependency from the Kaufland Card App to CIDAAS."
    ),
    "max_attempts": 3,
    "passing_score": 0.75,
    "required_apps": [
        {
            "name": "Kaufland Card App",
            "aliases": ["K-App", "Kaufland App", "KauflandCardApp"],
            "points": 1.0,
            "required_services": [
                {
                    "name": "InStore Navigation",
                    "aliases": ["Navigation", "Indoor Navigation", "Navigation UI"],
                    "service_type": "UI",
                    "points": 0.5,
                }
            ],
            "required_data_objects": [
                {
                    "name": "Cart Data",
                    "aliases": ["Cart", "Shopping List", "Articles"],
                    "points": 0.5,
                }
            ],
        },
        {
            "name": "CIDAAS",
            "aliases": ["Identity Provider", "Auth Server", "CIDAAS IDP"],
            "points": 1.0,
            "required_services": [
                {
                    "name": "OAuth API",
                    "aliases": ["Auth API", "Token Service", "Login API"],
                    "service_type": "REST_API",
                    "points": 0.5,
                }
            ],
            "required_data_objects": [],
        },
    ],
    "required_dependencies": [
        {
            "source_app": "Kaufland Card App",
            "target_app": "CIDAAS",
            "target_service": "OAuth API",
            "sync_type": "SYNC",
            "points": 1.5,
            "explanation": "Kaufland Card App requires CIDAAS OAuth API for authenticating loyalty club members.",
        }
    ],
    "forbidden_dependencies": [
        {
            "source_app": "Kaufland Card App",
            "target_app": "CIDAAS DB",
            "penalty": 1.0,
            "reason": "Direct database coupling violates microservice boundary principles; access CIDAAS via its published OAuth API.",
        }
    ],
    "hints": [
        {
            "tier": "TIER_1_GUIDING",
            "text": "Identify the two main applications involved: the front-facing customer app and the central identity provider.",
        },
        {
            "tier": "TIER_2_CONTEXT",
            "text": "Remember the 4 core ARM entities: Application (black box), Service (external interface), Data Object (asset), and Dependency (arrow pointing to consumed service).",
        },
        {
            "tier": "TIER_3_DIAGNOSTIC",
            "text": "Draw an arrow from Kaufland Card App pointing directly into the 'OAuth API' REST service on CIDAAS.",
        },
    ],
}


class ARMDiagramXBlock(XBlock):
    """XBlock for interactive Architecture Runtime Model (ARM) diagramming and grading."""

    has_score = True

    # Settings Scope
    display_name = String(
        display_name="Display Name",
        default="ARM Diagram Lab",
        scope=Scope.settings,
    )

    weight = Float(
        display_name="Problem Weight",
        default=1.0,
        values={"min": 0.1, "step": 0.1},
        scope=Scope.settings,
    )

    scenario_json = String(
        display_name="Scenario Specification (JSON)",
        default=json.dumps(DEFAULT_SCENARIO, indent=2),
        scope=Scope.settings,
    )

    # User State Scope
    student_graph_json = String(
        display_name="Student Diagram Graph (JSON)",
        default=json.dumps({"applications": [], "dependencies": []}),
        scope=Scope.user_state,
    )

    score = Float(
        display_name="Current Score",
        default=0.0,
        scope=Scope.user_state,
    )

    rubric_max_score = Float(
        display_name="Rubric Max Score",
        default=1.0,
        scope=Scope.user_state,
    )

    def max_score(self) -> float:
        """Return the maximum score possible for this block (Open edX grading interface)."""
        return float(self.weight)

    has_submitted = Boolean(
        display_name="Has Submitted",
        default=False,
        scope=Scope.user_state,
    )

    attempts_used = Integer(
        display_name="Attempts Used",
        default=0,
        scope=Scope.user_state,
    )

    current_hint_index = Integer(
        display_name="Current Hint Tier Index",
        default=0,
        scope=Scope.user_state,
    )

    last_feedback_json = String(
        display_name="Last Feedback Items (JSON)",
        default="[]",
        scope=Scope.user_state,
    )

    # -----------------------------------------------------------------
    # Helper properties
    # -----------------------------------------------------------------
    def get_scenario(self) -> ARMLabScenario:
        """Parse and return validated ARMLabScenario."""
        try:
            data = json.loads(self.scenario_json)
            return ARMLabScenario.model_validate(data)
        except Exception as e:
            log.warning(f"Error parsing scenario JSON: {e}, falling back to default")
            return ARMLabScenario.model_validate(DEFAULT_SCENARIO)

    def get_student_graph(self) -> ARMGraph:
        """Parse and return student graph AST."""
        try:
            data = json.loads(self.student_graph_json)
            return ARMGraph.model_validate(data)
        except Exception:
            return ARMGraph(applications=[], dependencies=[])

    # -----------------------------------------------------------------
    # Views
    # -----------------------------------------------------------------
    def student_view(self, context=None) -> Fragment:
        """Render the interactive ARM diagramming canvas in LMS."""
        scenario = self.get_scenario()
        student_graph = self.get_student_graph()

        try:
            feedbacks = json.loads(self.last_feedback_json)
        except Exception:
            feedbacks = []

        html_template = resource_string("static/html/arm_diagram_student.html")
        frag = Fragment(html_template)
        frag.add_css(resource_string("static/css/arm_diagram.css"))
        frag.add_javascript(resource_string("static/js/arm_diagram_student.js"))

        init_data = {
            "title": scenario.title,
            "description": scenario.description,
            "max_attempts": scenario.max_attempts,
            "attempts_used": self.attempts_used,
            "attempts_remaining": max(0, scenario.max_attempts - self.attempts_used),
            "passing_score": scenario.passing_score,
            "score": self.score,
            "max_score": self.rubric_max_score,
            "has_submitted": self.has_submitted,
            "graph": student_graph.model_dump(),
            "feedbacks": feedbacks,
            "hints_available": len(scenario.hints),
            "current_hint_index": self.current_hint_index,
            "current_hint": scenario.hints[self.current_hint_index].text if self.current_hint_index < len(scenario.hints) and self.current_hint_index > 0 else None,
        }

        frag.initialize_js("ARMDiagramStudentView", init_data)
        return frag

    def studio_view(self, context=None) -> Fragment:
        """Render Studio authoring settings."""
        html_template = resource_string("static/html/arm_diagram_studio.html")
        frag = Fragment(html_template)
        frag.add_css(resource_string("static/css/arm_diagram.css"))
        frag.add_javascript(resource_string("static/js/arm_diagram_studio.js"))

        init_data = {
            "display_name": self.display_name,
            "weight": self.weight,
            "scenario_json": self.scenario_json,
        }

        frag.initialize_js("ARMDiagramStudioView", init_data)
        return frag

    # -----------------------------------------------------------------
    # AJAX Handlers
    # -----------------------------------------------------------------
    @XBlock.json_handler
    def submit_solution(self, data: Dict[str, Any], suffix="") -> Dict[str, Any]:
        """Grade the student's submitted ARM diagram graph."""
        scenario = self.get_scenario()

        if self.attempts_used >= scenario.max_attempts:
            return {
                "success": False,
                "error": f"Maximum attempts ({scenario.max_attempts}) reached.",
            }

        try:
            graph_payload = data.get("graph", {})
            graph = ARMGraph.model_validate(graph_payload)
        except PydanticValidationError as e:
            return {
                "success": False,
                "error": f"Invalid diagram graph structure: {e.errors()[0]['msg']}",
            }
        except Exception as e:
            return {"success": False, "error": f"Malformed submission payload: {str(e)}"}

        self.attempts_used += 1
        self.student_graph_json = json.dumps(graph.model_dump())

        # Evaluate graph
        result: ARMEvaluationResult = evaluate_arm_graph(
            graph=graph,
            scenario=scenario,
            attempts_used=self.attempts_used,
            current_hint_index=self.current_hint_index,
        )

        self.score = result.score
        self.rubric_max_score = result.max_score
        self.has_submitted = True
        self.last_feedback_json = json.dumps([f.model_dump() for f in result.feedbacks])

        # Publish grade event to LMS runtime
        try:
            scaled_score = (self.score / self.rubric_max_score) * self.weight if self.rubric_max_score > 0 else 0.0
            self.runtime.publish(
                self,
                "grade",
                {"value": scaled_score, "max_value": self.weight},
            )
        except Exception as e:
            log.warning(f"Could not publish grade event to runtime: {e}")

        return {
            "success": True,
            "evaluation": result.model_dump(),
        }

    @XBlock.json_handler
    def get_hint(self, data: Dict[str, Any], suffix="") -> Dict[str, Any]:
        """Request progressive hint tier."""
        scenario = self.get_scenario()

        if not scenario.hints:
            return {"success": False, "message": "No hints configured for this lab."}

        # Return next available hint tier
        hint_idx = min(self.current_hint_index, len(scenario.hints) - 1)
        hint = scenario.hints[hint_idx]

        if self.current_hint_index < len(scenario.hints) - 1:
            self.current_hint_index += 1

        return {
            "success": True,
            "tier": hint.tier.value,
            "hint_text": hint.text,
            "tier_index": hint_idx + 1,
            "total_tiers": len(scenario.hints),
        }

    @XBlock.json_handler
    def reset_diagram(self, data: Dict[str, Any], suffix="") -> Dict[str, Any]:
        """Reset student diagram canvas."""
        self.student_graph_json = json.dumps({"applications": [], "dependencies": []})
        return {"success": True, "graph": {"applications": [], "dependencies": []}}

    @classmethod
    def parse_xml(cls, node: Any, runtime: Any, keys: Any, id_generator: Any = None) -> "ARMDiagramXBlock":
        """Parse XML when importing OLX courses."""
        block: ARMDiagramXBlock = runtime.construct_xblock_from_class(cls, keys)

        # Attribute fields
        for name, value in list(node.items()):
            if name in block.fields and name not in ("url_name", "category"):
                cls._set_field_if_present(block, name, str(value), {})

        # Child elements / inline payload
        for child in node:
            tag = child.tag.lower()
            if tag in ("scenario", "scenario_json") and child.text and child.text.strip():
                try:
                    # Validate JSON
                    parsed = json.loads(child.text.strip())
                    block.scenario_json = json.dumps(parsed, indent=2)
                except Exception as e:
                    log.warning(f"Error parsing inline scenario XML: {e}")

        # Check filestore if tag was empty pointer
        if not node.text and len(node) == 0:
            fs = getattr(runtime, "filestore", None) or getattr(runtime, "resource_fs", None)
            if fs:
                url_name = getattr(keys, "url_name", None) or getattr(block, "url_name", "")
                for subpath in (f"arm_diagram/{url_name}.xml", f"arm_diagram_xblock/{url_name}.xml"):
                    if fs.exists(subpath):
                        try:
                            with fs.open(subpath) as f:
                                import xml.etree.ElementTree as ET
                                def_tree = ET.parse(f)
                                root = def_tree.getroot()
                                for name, value in list(root.items()):
                                    if name in block.fields and name not in ("url_name", "category"):
                                        cls._set_field_if_present(block, name, str(value), {})
                                for child in root:
                                    if child.tag.lower() in ("scenario", "scenario_json") and child.text and child.text.strip():
                                        block.scenario_json = child.text.strip()
                        except Exception as e:
                            log.warning(f"Failed to load definition XML {subpath}: {e}")
                        break

        return block

    @XBlock.json_handler
    def studio_submit(self, data: Dict[str, Any], suffix="") -> Dict[str, Any]:
        """Save settings from Studio authoring modal."""
        display_name = data.get("display_name", "").strip()
        if display_name:
            self.display_name = display_name

        try:
            weight = float(data.get("weight", 1.0))
            if weight > 0:
                self.weight = weight
        except (ValueError, TypeError):
            pass

        raw_scenario = data.get("scenario_json", "")
        if raw_scenario:
            try:
                parsed = json.loads(raw_scenario)
                validated = ARMLabScenario.model_validate(parsed)
                self.scenario_json = json.dumps(validated.model_dump(), indent=2)
            except Exception as e:
                return {"success": False, "error": f"Invalid Scenario JSON: {str(e)}"}

        return {"success": True}
