# Tutor ARM Diagram Plugin & Open edX XBlock

An enterprise-grade Tutor plugin and Open edX XBlock for interactive **Architecture Runtime Model (ARM)** diagramming, modeling labs, textual specifications (ARM DSL & YAML), and automated real-time grading.

---

## 🚀 Key Features

### 1. Dual-Engine Architecture: Visual Canvas + Code Editors
* **🎨 Interactive Visual Canvas**:
  * SVG-powered rendering with smooth drag-and-drop node placement.
  * Application containers with encapsulated Business Capabilities, exposed Service interface ports, and owned Data Objects.
  * Direct directed Service-to-Service dependency connection lines with protocol badges and communication modes (`[SYNC]` / `[ASYNC]`).
  * In-canvas high-contrast modal dialogs for element creation, editing, and inspection.
* **📝 ARM DSL Editor**:
  * Custom Domain-Specific Language designed for rapid, human-readable architecture authoring.
  * In-service dependency definition syntax (`service "..." ->`).
  * Live bidirectional synchronization with canvas coordinates (`at (x, y) size (w, h)`).
* **📄 Structured YAML Editor**:
  * Clean YAML representation mapped 1-to-1 to Pydantic v2 domain schemas (`layout: {x, y, width, height}`).
* **📤 File Upload**:
  * Drag-and-drop or file selection supporting `.arm`, `.dsl`, `.yaml`, `.yml`, and `.json` files.

---

### 2. Rich Code Editor Features
* **Syntax Highlighting (Colors)**:
  * High-contrast dark theme tokens for keywords, string literals, coordinates, operators, comments, and enums.
* **Line Numbers Gutter**:
  * Dynamic, tab-formatted line number gutter synchronized with editor scrolling and input.
* **IntelliSense Code Completion (Code Complete)**:
  * Auto-triggered on typing or manually via `Ctrl+Space` / `Cmd+Space`.
  * Suggests application templates, service definitions, data objects, sync/async modes, and auto-discovers declared applications and services for dependency links.
  * Keyboard navigation with `↑` / `↓` Arrow keys, `Enter` / `Tab` to insert, and `Esc` to close.
  * `Tab` key indents 4 spaces; auto-closes bracket pairs (`{}`, `()`, `[]`, `""`).

---

### 3. Enterprise ARM Modeling Invariants
* **Team Maintenance Perspective**:
  * `internal`: Applications maintained by the responsible team authoring the diagram.
  * `external`: Applications maintained by other internal teams or third-party/SaaS vendors.
  * `infrastructure`: Platform middleware, shared message brokers (e.g. Solace, Kafka), and cloud databases.
* **Sourcing Strategy / Delivery Types**:
  * `make`: Built & developed in-house (default for `internal` applications).
  * `buy`: Commercial Off-The-Shelf (COTS) or third-party SaaS.
  * `use`: Standardized platform or shared service.

---

### 4. Automated Grading & Diagnostic Engine
* **Pydantic v2 Strongly Typed Graph Models**:
  * Validates entity names, scopes, service interfaces, data classifications, and topological referential integrity.
* **Graph Evaluation & Scoring**:
  * Partial credit grading with clear itemized feedback cards (`SUCCESS`, `WARNING`, `ERROR`).
  * Anti-pattern detection with configurable penalty weights.
* **3-Tier Progressive Hint Engine**:
  * Tier 1: Guiding Question (points to core concept).
  * Tier 2: Context / Invariants (reminds of architecture rules).
  * Tier 3: Diagnostic Step (actionable calculation or troubleshooting guidance).

---

## 🛠️ ARM DSL Specification Example

```arm
// Architecture Runtime Model Specification

// Internal application maintained by our team (defaults to MAKE)
internal application "Kaufland Card App" at (50, 60) size (270, 200) {
    team: "Mobile Core Team"
    capabilities: "In-Store Navigation", "Loyalty Program"
    data "Cart Data" [Transactional]

    ui service "InStore Navigation UI" ->
        "CIDAAS (Identity Provider)"."OAuth 2.0 API" sync REST
        "Loyalty Core Backend"."Loyalty Profile API" sync gRPC
        "Solace Event Mesh"."Cart Events Topic" async MQP
}

// External SaaS application (BUY)
external buy application "CIDAAS (Identity Provider)" at (450, 60) size (270, 200) {
    team: "Central Auth Team"
    rest service "OAuth 2.0 API"
}

// External application maintained by another internal team (MAKE)
external make application "Loyalty Core Backend" at (850, 60) size (270, 200) {
    team: "Customer Loyalty Team"
    grpc service "Loyalty Profile API"
}

// Infrastructure platform (USE)
infrastructure use application "Solace Event Mesh" at (450, 320) size (270, 200) {
    team: "Integration Platform"
    event service "Cart Events Topic"
}
```

---

## 📦 Installation in Open edX & Tutor

### Install Plugin

```bash
tutor plugins install tutor-arm-diagram
tutor plugins enable arm_diagram
tutor local launch
```

### Enable in Course Studio
1. In Open edX Studio, navigate to **Settings -> Advanced Settings**.
2. Add `"arm_diagram"` to the **Advanced Module List** (`advanced_modules`).
3. Save changes.
4. Add the component under **Add New Component -> Advanced -> ARM Diagram Lab**.

---

## 🧪 Testing

```bash
# Run pytest test suite
pytest tests/
```

---

## 📄 License

MIT License.
