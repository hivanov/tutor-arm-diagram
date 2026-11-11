"""Integration Test and Preview Server for ARM Diagram XBlock."""

import http.server
import json
import os
import threading
from typing import Any, Dict

from arm_diagram_xblock.engine import evaluate_arm_graph
from arm_diagram_xblock.models import ARMEvaluationResult, ARMGraph, ARMLabScenario
from arm_diagram_xblock.xblock import DEFAULT_SCENARIO

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "arm_diagram_xblock", "static")


class ARMServerState:
    """In-memory state for preview and integration tests."""

    def __init__(self) -> None:
        self.scenario = ARMLabScenario.model_validate(DEFAULT_SCENARIO)
        self.weight = 10.0
        self.display_name = "Kaufland InStore Navigation Lab"
        self.student_graph: Dict[str, Any] = {"applications": [], "dependencies": []}
        self.attempts_used = 0
        self.score = 0.0
        self.max_score = 1.0
        self.has_submitted = False
        self.current_hint_index = 0
        self.last_feedbacks = []


STATE = ARMServerState()


class ARMHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler serving student and studio views and AJAX endpoints."""

    def do_GET(self) -> None:
        if self.path == "/" or self.path == "/student":
            self._serve_student_view()
        elif self.path == "/studio":
            self._serve_studio_view()
        elif self.path.startswith("/static/"):
            rel = self.path.replace("/static/", "")
            full = os.path.join(STATIC_DIR, rel)
            if os.path.exists(full):
                self.send_response(200)
                if rel.endswith(".css"):
                    self.send_header("Content-Type", "text/css")
                elif rel.endswith(".js"):
                    self.send_header("Content-Type", "application/javascript")
                self.end_headers()
                with open(full, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        if self.path == "/handler/submit_solution":
            graph = ARMGraph.model_validate(data.get("graph", {}))
            STATE.attempts_used += 1
            STATE.student_graph = graph.model_dump()
            res = evaluate_arm_graph(
                graph=graph,
                scenario=STATE.scenario,
                attempts_used=STATE.attempts_used,
                current_hint_index=STATE.current_hint_index,
            )
            STATE.score = res.score
            STATE.max_score = res.max_score
            STATE.has_submitted = True
            STATE.last_feedbacks = [f.model_dump() for f in res.feedbacks]
            self._send_json({"success": True, "evaluation": res.model_dump()})

        elif self.path == "/handler/get_hint":
            if not STATE.scenario.hints:
                self._send_json({"success": False, "message": "No hints."})
                return
            h_idx = min(STATE.current_hint_index, len(STATE.scenario.hints) - 1)
            hint = STATE.scenario.hints[h_idx]
            if STATE.current_hint_index < len(STATE.scenario.hints) - 1:
                STATE.current_hint_index += 1
            self._send_json({
                "success": True,
                "tier": hint.tier.value,
                "hint_text": hint.text,
                "tier_index": h_idx + 1,
                "total_tiers": len(STATE.scenario.hints),
            })

        elif self.path == "/handler/reset_diagram":
            STATE.student_graph = {"applications": [], "dependencies": []}
            self._send_json({"success": True, "graph": STATE.student_graph})

        elif self.path == "/handler/studio_submit":
            if "display_name" in data:
                STATE.display_name = data["display_name"]
            if "weight" in data:
                STATE.weight = float(data["weight"])
            if "scenario_json" in data:
                STATE.scenario = ARMLabScenario.model_validate(json.loads(data["scenario_json"]))
            self._send_json({"success": True})
        else:
            self.send_error(404)

    def _serve_student_view(self) -> None:
        with open(os.path.join(STATIC_DIR, "html", "arm_diagram_student.html")) as f:
            tmpl = f.read()
        with open(os.path.join(STATIC_DIR, "css", "arm_diagram.css")) as f:
            css = f.read()
        with open(os.path.join(STATIC_DIR, "js", "arm_diagram_student.js")) as f:
            js_code = f.read()

        init_data = {
            "title": STATE.scenario.title,
            "description": STATE.scenario.description,
            "max_attempts": STATE.scenario.max_attempts,
            "attempts_used": STATE.attempts_used,
            "attempts_remaining": max(0, STATE.scenario.max_attempts - STATE.attempts_used),
            "passing_score": STATE.scenario.passing_score,
            "score": STATE.score,
            "max_score": STATE.max_score,
            "has_submitted": STATE.has_submitted,
            "graph": STATE.student_graph,
            "feedbacks": STATE.last_feedbacks,
            "hints_available": len(STATE.scenario.hints),
            "current_hint_index": STATE.current_hint_index,
            "current_hint": None,
        }

        html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>ARM Diagram Lab - Open edX</title>
    <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
    <style>
        body {{
            background: #020617;
            padding: 30px;
            margin: 0;
            display: flex;
            justify-content: center;
        }}
        .page-wrapper {{
            max-width: 1100px;
            width: 100%;
        }}
        {css}
    </style>
</head>
<body>
    <div class="page-wrapper">
        {tmpl}
    </div>
    <script>
        {js_code}
        const mockRuntime = {{
            handlerUrl: function(elem, name) {{
                return '/handler/' + name;
            }}
        }};
        $(function() {{
            ARMDiagramStudentView(mockRuntime, $('.arm-diagram-container'), {json.dumps(init_data)});
        }});
    </script>
</body>
</html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def _serve_studio_view(self) -> None:
        with open(os.path.join(STATIC_DIR, "html", "arm_diagram_studio.html")) as f:
            tmpl = f.read()
        with open(os.path.join(STATIC_DIR, "css", "arm_diagram.css")) as f:
            css = f.read()
        with open(os.path.join(STATIC_DIR, "js", "arm_diagram_studio.js")) as f:
            js_code = f.read()

        init_data = {
            "display_name": STATE.display_name,
            "weight": STATE.weight,
            "scenario_json": json.dumps(STATE.scenario.model_dump(), indent=2),
        }

        html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>ARM Diagram Studio View - Open edX</title>
    <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
    <style>
        body {{
            background: #0f172a;
            color: #f8fafc;
            padding: 30px;
            margin: 0;
            font-family: sans-serif;
        }}
        .arm-studio-wrapper {{
            max-width: 800px;
            margin: 0 auto;
            background: #1e293b;
            padding: 24px;
            border-radius: 8px;
            border: 1px solid #334155;
        }}
        .arm-studio-field {{
            margin-bottom: 18px;
        }}
        .arm-studio-field label {{
            display: block;
            margin-bottom: 6px;
            font-weight: 600;
            color: #38bdf8;
        }}
        .arm-input, .arm-textarea {{
            width: 100%;
            background: #0f172a;
            color: #f8fafc;
            border: 1px solid #475569;
            border-radius: 6px;
            padding: 10px;
            font-family: monospace;
            box-sizing: border-box;
        }}
        {css}
    </style>
</head>
<body>
    {tmpl}
    <script>
        {js_code}
        const mockRuntime = {{
            handlerUrl: function(elem, name) {{
                return '/handler/' + name;
            }},
            notify: function(event, payload) {{
                console.log('Runtime notify:', event, payload);
                if (event === 'save' && payload.state === 'end') {{
                    alert('Settings successfully saved in Studio!');
                }}
            }}
        }};
        $(function() {{
            ARMDiagramStudioView(mockRuntime, $('.arm-studio-wrapper'), {json.dumps(init_data)});
        }});
    </script>
</body>
</html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def _send_json(self, data: Dict[str, Any]) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))


class IntegrationTestServer:

    def __init__(self, port: int = 8999) -> None:
        self.port = port
        self.server = http.server.HTTPServer(("127.0.0.1", port), ARMHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


if __name__ == "__main__":
    import time
    srv = IntegrationTestServer(port=8999)
    srv.start()
    print("ARM Server running at http://127.0.0.1:8999/")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        srv.stop()
