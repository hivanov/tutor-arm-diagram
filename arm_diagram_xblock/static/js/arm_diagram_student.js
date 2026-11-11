/* ARM Diagram Student Interactive Canvas with Dual-Engine (DSL & YAML) Support, Make/Buy/Use Dimensions, Rich Syntax Highlighting, Line Numbers & Autocomplete */

function ARMDiagramStudentView(runtime, element, initData) {
    const $element = $(element);
    let state = {
        graph: initData.graph || { applications: [], dependencies: [] },
        selectedAppId: null,
        connectSourceAppId: null,
        connectSourceServiceId: null,
        pendingTargetAppId: null,
        connectMode: false,
        isDragging: false,
        draggedAppId: null,
        dragOffset: { x: 0, y: 0 },
        editingAppId: null,
        editingServiceId: null,
        editingDataId: null,
        pendingConfirmAction: null,
        currentTab: 'canvas'
    };

    // Update Header and Status
    $element.find('.arm-title-text').text(initData.title || 'ARM Lab');
    $element.find('.arm-description').text(initData.description || '');
    $element.find('.arm-max-attempts').text(initData.max_attempts);
    $element.find('.arm-attempts-used').text(initData.attempts_used);
    $element.find('.arm-current-score').text(initData.score.toFixed(1));
    $element.find('.arm-max-score').text((initData.max_score || 1.0).toFixed(1));
    
    const pct = initData.max_score > 0 ? Math.round((initData.score / initData.max_score) * 100) : 0;
    $element.find('.arm-percentage').text(pct + '%');

    if (initData.has_submitted) {
        updateBadge(initData.score >= (initData.max_score * initData.passing_score));
    }
    if (initData.feedbacks && initData.feedbacks.length > 0) {
        renderFeedback(initData.feedbacks);
    }
    if (initData.current_hint) {
        $element.find('.arm-hint-box').show();
        $element.find('.arm-hint-text').text(initData.current_hint);
    }

    // Render Canvas Initial State
    renderCanvas();

    // -------------------------------------------------------------
    // Rich Code Editor with Syntax Highlighting, Line Numbers & Code Complete
    // -------------------------------------------------------------
    function createRichEditor(containerId, mode) {
        const $container = $element.find('#' + containerId);
        const $gutter = $container.find('.arm-editor-gutter');
        const $highlightCode = $container.find('.arm-editor-highlight code');
        const $textarea = $container.find('.arm-editor-input');
        const $popup = $container.find('.arm-autocomplete-popup');

        let currentCompletions = [];
        let selectedIndex = 0;
        let isPopupOpen = false;

        function setValue(text) {
            $textarea.val(text);
            render();
        }

        function getValue() {
            return $textarea.val();
        }

        function render() {
            const text = $textarea.val();
            // 1. Syntax highlight
            if (mode === 'dsl') {
                $highlightCode.html(highlightARMDSL(text));
            } else {
                $highlightCode.html(highlightARMYAML(text));
            }

            // 2. Line numbers gutter
            const lineCount = (text.match(/\n/g) || []).length + 1;
            let gutterHtml = '';
            for (let i = 1; i <= lineCount; i++) {
                gutterHtml += `<span class="arm-gutter-line">${i}</span>`;
            }
            $gutter.html(gutterHtml);

            // 3. Sync scroll
            syncScroll();
        }

        function syncScroll() {
            const scrollTop = $textarea.scrollTop();
            const scrollLeft = $textarea.scrollLeft();
            $gutter.scrollTop(scrollTop);
            $container.find('.arm-editor-highlight').scrollTop(scrollTop).scrollLeft(scrollLeft);
        }

        // Textarea Events
        $textarea.on('input', function() {
            render();
            triggerAutocomplete();
        });

        $textarea.on('scroll', syncScroll);

        $textarea.on('keydown', function(e) {
            if (isPopupOpen) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedIndex = (selectedIndex + 1) % currentCompletions.length;
                    renderPopupItems();
                    return;
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedIndex = (selectedIndex - 1 + currentCompletions.length) % currentCompletions.length;
                    renderPopupItems();
                    return;
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applySelectedCompletion();
                    return;
                } else if (e.key === 'Escape') {
                    closePopup();
                    return;
                }
            }

            // Tab key support (indent 4 spaces)
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = this.selectionStart;
                const end = this.selectionEnd;
                const val = $textarea.val();
                $textarea.val(val.substring(0, start) + '    ' + val.substring(end));
                this.selectionStart = this.selectionEnd = start + 4;
                render();
                return;
            }

            // Ctrl+Space or Cmd+Space manual trigger
            if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
                e.preventDefault();
                triggerAutocomplete(true);
                return;
            }

            // Auto-close brackets and quotes
            const pairs = { '{': '}', '(': ')', '[': ']', '"': '"' };
            if (pairs[e.key]) {
                const start = this.selectionStart;
                const end = this.selectionEnd;
                const val = $textarea.val();
                if (start === end) {
                    const closeChar = pairs[e.key];
                    $textarea.val(val.substring(0, start) + e.key + closeChar + val.substring(end));
                    this.selectionStart = this.selectionEnd = start + 1;
                    e.preventDefault();
                    render();
                    triggerAutocomplete();
                }
            }
        });

        $textarea.on('click blur', function(e) {
            if (e.type === 'blur') {
                setTimeout(closePopup, 200);
            }
        });

        function triggerAutocomplete(force = false) {
            const cursorPos = $textarea.prop('selectionStart');
            const text = $textarea.val();
            const textBefore = text.substring(0, cursorPos);
            const currentLine = textBefore.split('\n').pop();
            const wordMatch = currentLine.match(/([a-zA-Z0-9_\-\.":]+)$/);
            const prefix = wordMatch ? wordMatch[1] : '';

            if (!force && prefix.length < 1 && !currentLine.trim().endsWith(':') && !currentLine.trim().endsWith('->')) {
                closePopup();
                return;
            }

            const completions = getCompletions(mode, text, textBefore, prefix);
            if (completions.length === 0) {
                closePopup();
                return;
            }

            currentCompletions = completions;
            selectedIndex = 0;
            openPopup();
        }

        function openPopup() {
            renderPopupItems();
            const textBefore = $textarea.val().substring(0, $textarea.prop('selectionStart'));
            const lines = textBefore.split('\n');
            const lineIndex = lines.length - 1;
            const colIndex = lines[lineIndex].length;

            const top = Math.min(400, (lineIndex + 1) * 22 - $textarea.scrollTop() + 15);
            const left = Math.min(600, Math.max(10, colIndex * 8.5 - $textarea.scrollLeft() + 10));

            $popup.css({ top: top + 'px', left: left + 'px' }).show();
            isPopupOpen = true;
        }

        function closePopup() {
            $popup.hide();
            isPopupOpen = false;
        }

        function renderPopupItems() {
            $popup.empty();
            currentCompletions.forEach((c, idx) => {
                const isSelected = idx === selectedIndex;
                const $item = $(`
                    <div class="arm-ac-item ${isSelected ? 'arm-ac-selected' : ''}" data-idx="${idx}">
                        <div class="arm-ac-left">
                            <span class="arm-ac-icon">${c.icon || '✨'}</span>
                            <span class="arm-ac-label">${escapeHtml(c.label)}</span>
                            <span class="arm-ac-desc">${escapeHtml(c.detail || '')}</span>
                        </div>
                        <span class="arm-ac-type">${escapeHtml(c.type || 'KW')}</span>
                    </div>
                `);

                $item.on('mousedown', function(e) {
                    e.preventDefault();
                    selectedIndex = idx;
                    applySelectedCompletion();
                });

                $popup.append($item);
            });

            const $selected = $popup.find('.arm-ac-selected');
            if ($selected.length > 0) {
                const itemTop = $selected.position().top;
                const popupScroll = $popup.scrollTop();
                if (itemTop < 0 || itemTop > 180) {
                    $popup.scrollTop(popupScroll + itemTop);
                }
            }
        }

        function applySelectedCompletion() {
            if (!currentCompletions[selectedIndex]) return;
            const completion = currentCompletions[selectedIndex];
            const cursorPos = $textarea.prop('selectionStart');
            const text = $textarea.val();
            const textBefore = text.substring(0, cursorPos);
            const textAfter = text.substring(cursorPos);

            const wordMatch = textBefore.match(/([a-zA-Z0-9_\-\.":]+)$/);
            const prefixLen = wordMatch ? wordMatch[1].length : 0;
            const insertText = completion.insertText || completion.label;

            const newTextBefore = textBefore.substring(0, textBefore.length - prefixLen) + insertText;
            $textarea.val(newTextBefore + textAfter);

            const newCursor = newTextBefore.length;
            $textarea[0].selectionStart = $textarea[0].selectionEnd = newCursor;

            closePopup();
            render();
            $textarea.focus();
        }

        return {
            setValue,
            getValue,
            render
        };
    }

    // -------------------------------------------------------------
    // Syntax Highlighter Tokenizers (Colors)
    // -------------------------------------------------------------
    function highlightARMDSL(text) {
        if (!text) return '';
        const lines = text.split('\n');
        const highlightedLines = lines.map(line => {
            let escaped = escapeHtml(line);

            // Comments
            if (escaped.trim().startsWith('//') || escaped.trim().startsWith('#')) {
                return `<span class="arm-token-comment">${escaped}</span>`;
            }

            // String literals
            escaped = escaped.replace(/(&quot;.*?&quot;|".*?")/g, '<span class="arm-token-string">$1</span>');

            // Coordinates: at (x, y) size (w, h)
            escaped = escaped.replace(/\b(at|size)\s*\((.*?)\)/g, '<span class="arm-token-keyword">$1</span> <span class="arm-token-coord">($2)</span>');

            // Dependency arrow
            escaped = escaped.replace(/(-&gt;|->)/g, '<span class="arm-token-arrow">-&gt;</span>');

            // Sourcing dimensions & Communication mode
            escaped = escaped.replace(/\b(make|buy|use|MAKE|BUY|USE|sync|async|SYNC|ASYNC)\b/g, '<span class="arm-token-enum">$1</span>');
            escaped = escaped.replace(/\[(SYNC|ASYNC)\]/g, '<span class="arm-token-enum">[$1]</span>');

            // Data Object classifications
            escaped = escaped.replace(/\[(Transactional|Master|Analytical|Reference)\]/g, '<span class="arm-token-type">[$1]</span>');

            // Attributes
            escaped = escaped.replace(/\b(team|capabilities|capability|sourcing)\s*:/g, '<span class="arm-token-tag">$1</span>:');

            // Keywords
            escaped = escaped.replace(/\b(internal|external|infrastructure|application|service|data|rest|ui|event|graphql|grpc|batch)\b/g, '<span class="arm-token-keyword">$1</span>');

            return escaped;
        });

        return highlightedLines.join('\n');
    }

    function highlightARMYAML(text) {
        if (!text) return '';
        const lines = text.split('\n');
        const highlightedLines = lines.map(line => {
            let escaped = escapeHtml(line);

            // Comments
            if (escaped.trim().startsWith('#')) {
                return `<span class="arm-token-comment">${escaped}</span>`;
            }

            // Strings
            escaped = escaped.replace(/(&quot;.*?&quot;|".*?"|'.*?')/g, '<span class="arm-token-string">$1</span>');

            // YAML Keys
            escaped = escaped.replace(/^(\s*-\s+)?([a-zA-Z0-9_\-]+)\s*:/g, function(match, dash, key) {
                const dashPart = dash ? `<span class="arm-token-operator">-</span> ` : '';
                return `${dashPart}<span class="arm-token-key">${key}</span>:`;
            });

            // Enum constants and keywords
            escaped = escaped.replace(/\b(INTERNAL|EXTERNAL|INFRASTRUCTURE|MAKE|BUY|USE|REST_API|UI|EVENT|GRAPHQL|GRPC|BATCH|SYNC|ASYNC|Transactional|Master|Analytical|Reference|true|false|null)\b/g, '<span class="arm-token-enum">$1</span>');

            // Numbers
            escaped = escaped.replace(/(:\s+)(\d+(\.\d+)?)\b/g, '$1<span class="arm-token-number">$2</span>');

            return escaped;
        });

        return highlightedLines.join('\n');
    }

    // -------------------------------------------------------------
    // IntelliSense Autocomplete Engine (DSL & YAML)
    // -------------------------------------------------------------
    function getCompletions(mode, fullText, textBefore, prefix) {
        const p = prefix.toLowerCase();
        const completions = [];

        const declaredApps = [];
        const appMatches = fullText.matchAll(/application\s+"([^"]+)"/gi);
        for (const m of appMatches) {
            declaredApps.push(m[1]);
        }

        const declaredServices = [];
        const srvMatches = fullText.matchAll(/(?:rest|ui|event|graphql|grpc|batch)\s+service\s+"([^"]+)"/gi);
        for (const m of srvMatches) {
            declaredServices.push(m[1]);
        }

        if (mode === 'dsl') {
            const dslDictionary = [
                // Application Snippets with Sourcing Types
                { label: 'internal application (make)', insertText: 'internal make application "App Name" at (60, 60) size (270, 200) {\n    team: "Core Team"\n    capabilities: "Capability 1"\n    ui service "Main UI"\n    data "Main Data" [Transactional]\n}\n', detail: 'Internal Make Application (In-House Developed)', type: 'Snippet', icon: '📦' },
                { label: 'internal buy application', insertText: 'internal buy application "App Name" at (60, 60) size (270, 200) {\n    team: "Core Team"\n    capabilities: "Capability 1"\n    ui service "Main UI"\n}\n', detail: 'Internal Buy Application (Commercial / Maintained by Team)', type: 'Snippet', icon: '🛒' },
                { label: 'internal use application', insertText: 'internal use application "App Name" at (60, 60) size (270, 200) {\n    team: "Core Team"\n    capabilities: "Capability 1"\n    ui service "Main UI"\n}\n', detail: 'Internal Use Application (Platform / Standardized)', type: 'Snippet', icon: '⚡' },
                { label: 'external application (buy/SaaS)', insertText: 'external buy application "SaaS Name" at (450, 60) size (270, 200) {\n    team: "Vendor / 3rd Party"\n    capabilities: "External Service"\n    rest service "API Endpoint"\n}\n', detail: 'External Buy Application (3rd-Party / SaaS)', type: 'Snippet', icon: '☁️' },
                { label: 'external make application', insertText: 'external make application "Other Team App" at (450, 60) size (270, 200) {\n    team: "Other Team"\n    capabilities: "Other Domain"\n    rest service "API Endpoint"\n}\n', detail: 'External Make Application (Maintained by Another Team)', type: 'Snippet', icon: '🏢' },
                { label: 'infrastructure application', insertText: 'infrastructure application "Infra Name" at (850, 60) size (270, 200) {\n    team: "Platform Team"\n    capabilities: "Event Distribution"\n    event service "Event Topic"\n}\n', detail: 'Platform / Infrastructure Service', type: 'Snippet', icon: '⚙️' },
                
                // Member statements
                { label: 'team:', insertText: 'team: "', detail: 'Responsible team name', type: 'Property', icon: '👥' },
                { label: 'capabilities:', insertText: 'capabilities: "', detail: 'Business capabilities list', type: 'Property', icon: '🏷️' },
                { label: 'rest service -> (with connections)', insertText: 'rest service "ServiceName" ->\n        "TargetApp"."TargetService" sync REST\n', detail: 'REST API with outbound dependencies', type: 'Snippet', icon: '🔌' },
                { label: 'ui service -> (with connections)', insertText: 'ui service "ServiceName" ->\n        "TargetApp"."TargetService" sync REST\n', detail: 'UI Service with outbound dependencies', type: 'Snippet', icon: '🔌' },
                { label: 'event service -> (with connections)', insertText: 'event service "ServiceName" ->\n        "TargetApp"."TargetService" async MQP\n', detail: 'Event Service with outbound dependencies', type: 'Snippet', icon: '🔌' },
                { label: 'rest service', insertText: 'rest service "', detail: 'REST API Service Interface', type: 'Service', icon: '🔌' },
                { label: 'ui service', insertText: 'ui service "', detail: 'UI / Frontend Service Interface', type: 'Service', icon: '🔌' },
                { label: 'event service', insertText: 'event service "', detail: 'Message / Event Topic Interface', type: 'Service', icon: '🔌' },
                { label: 'graphql service', insertText: 'graphql service "', detail: 'GraphQL Endpoint Interface', type: 'Service', icon: '🔌' },
                { label: 'grpc service', insertText: 'grpc service "', detail: 'gRPC RPC Interface', type: 'Service', icon: '🔌' },
                { label: 'batch service', insertText: 'batch service "', detail: 'Batch / File Ingestion Interface', type: 'Service', icon: '🔌' },
                
                // Data Objects
                { label: 'data [Transactional]', insertText: 'data "DataObject" [Transactional]', detail: 'Transactional Data Object', type: 'Data', icon: '📊' },
                { label: 'data [Master]', insertText: 'data "DataObject" [Master]', detail: 'Master Data Object', type: 'Data', icon: '📊' },
                { label: 'data [Analytical]', insertText: 'data "DataObject" [Analytical]', detail: 'Analytical Data Object', type: 'Data', icon: '📊' },
                { label: 'data [Reference]', insertText: 'data "DataObject" [Reference]', detail: 'Reference Data Object', type: 'Data', icon: '📊' },

                // Sourcing Keywords
                { label: 'make', insertText: 'make', detail: 'In-House Built & Developed', type: 'Enum', icon: '🔨' },
                { label: 'buy', insertText: 'buy', detail: 'Commercial Off-The-Shelf / SaaS', type: 'Enum', icon: '🛒' },
                { label: 'use', insertText: 'use', detail: 'Standardized Platform / Shared Component', type: 'Enum', icon: '⚡' },

                // Sync / Async Tags
                { label: 'sync REST', insertText: 'sync REST', detail: 'Synchronous REST Dependency', type: 'Enum', icon: '➡️' },
                { label: 'async MQP', insertText: 'async MQP', detail: 'Asynchronous Message Queue Dependency', type: 'Enum', icon: '🔀' },
                { label: 'tcp', insertText: 'tcp', detail: 'TCP Connection', type: 'Enum', icon: '⚡' },
                { label: '->', insertText: '->\n        "', detail: 'Outbound Service Dependencies Header', type: 'Operator', icon: '➡️' }
            ];

            declaredApps.forEach(appName => {
                dslDictionary.push({
                    label: `"${appName}"`,
                    insertText: `"${appName}"`,
                    detail: 'Declared Application reference',
                    type: 'App',
                    icon: '📦'
                });
            });

            declaredServices.forEach(srvName => {
                dslDictionary.push({
                    label: `."${srvName}"`,
                    insertText: `."${srvName}"`,
                    detail: 'Declared Service Interface reference',
                    type: 'Service',
                    icon: '🔌'
                });
            });

            dslDictionary.forEach(item => {
                if (!p || item.label.toLowerCase().includes(p) || (item.detail && item.detail.toLowerCase().includes(p))) {
                    completions.push(item);
                }
            });
        } else {
            const yamlDictionary = [
                { label: 'applications:', insertText: 'applications:\n  - id: "app_1"\n    name: "Application Name"\n    scope: "INTERNAL"\n    sourcing: "MAKE"\n    team: "Core Team"\n    business_capabilities:\n      - "Capability 1"\n    services:\n      - id: "srv_1"\n        name: "Service Name"\n        service_type: "REST_API"\n    data_objects:\n      - id: "data_1"\n        name: "Data Object"\n        classification: "Transactional"\n    layout:\n      x: 60\n      y: 60\n      width: 270\n      height: 200\n', detail: 'Application list declaration', type: 'Section', icon: '📦' },
                { label: 'dependencies:', insertText: 'dependencies:\n  - id: "dep_1"\n    source_app_id: "app_1"\n    source_service_id: "srv_1"\n    target_app_id: "app_2"\n    target_service_id: "srv_2"\n    sync_type: "SYNC"\n    protocol: "HTTPS / REST"\n', detail: 'Dependencies list declaration', type: 'Section', icon: '➡️' },
                { label: 'scope: INTERNAL', insertText: 'scope: "INTERNAL"', detail: 'Internal Owned Application Scope', type: 'Enum', icon: '📦' },
                { label: 'scope: EXTERNAL', insertText: 'scope: "EXTERNAL"', detail: 'External SaaS / Vendor Scope', type: 'Enum', icon: '☁️' },
                { label: 'scope: INFRASTRUCTURE', insertText: 'scope: "INFRASTRUCTURE"', detail: 'Infrastructure Platform Scope', type: 'Enum', icon: '⚙️' },
                { label: 'sourcing: MAKE', insertText: 'sourcing: "MAKE"', detail: 'In-House Developed (Default for Internal)', type: 'Enum', icon: '🔨' },
                { label: 'sourcing: BUY', insertText: 'sourcing: "BUY"', detail: 'Commercial SaaS / COTS / Vendor', type: 'Enum', icon: '🛒' },
                { label: 'sourcing: USE', insertText: 'sourcing: "USE"', detail: 'Standardized Platform / Shared Service', type: 'Enum', icon: '⚡' },
                { label: 'service_type: REST_API', insertText: 'service_type: "REST_API"', detail: 'REST API Interface', type: 'Enum', icon: '🔌' },
                { label: 'service_type: UI', insertText: 'service_type: "UI"', detail: 'User Interface Service', type: 'Enum', icon: '🔌' },
                { label: 'service_type: EVENT', insertText: 'service_type: "EVENT"', detail: 'Event / Topic Service', type: 'Enum', icon: '🔌' },
                { label: 'service_type: GRAPHQL', insertText: 'service_type: "GRAPHQL"', detail: 'GraphQL API', type: 'Enum', icon: '🔌' },
                { label: 'service_type: GRPC', insertText: 'service_type: "GRPC"', detail: 'gRPC Interface', type: 'Enum', icon: '🔌' },
                { label: 'service_type: BATCH', insertText: 'service_type: "BATCH"', detail: 'Batch Ingestion', type: 'Enum', icon: '🔌' },
                { label: 'sync_type: SYNC', insertText: 'sync_type: "SYNC"', detail: 'Synchronous Request/Response', type: 'Enum', icon: '➡️' },
                { label: 'sync_type: ASYNC', insertText: 'sync_type: "ASYNC"', detail: 'Asynchronous Event Message', type: 'Enum', icon: '🔀' },
                { label: 'classification: Transactional', insertText: 'classification: "Transactional"', detail: 'Transactional Data Classification', type: 'Enum', icon: '📊' },
                { label: 'classification: Master', insertText: 'classification: "Master"', detail: 'Master Data Classification', type: 'Enum', icon: '📊' },
                { label: 'classification: Analytical', insertText: 'classification: "Analytical"', detail: 'Analytical Data Classification', type: 'Enum', icon: '📊' },
                { label: 'layout:', insertText: 'layout:\n      x: 60\n      y: 60\n      width: 270\n      height: 200', detail: 'UI Placement coordinates & dimensions', type: 'Property', icon: '📐' }
            ];

            yamlDictionary.forEach(item => {
                if (!p || item.label.toLowerCase().includes(p) || (item.detail && item.detail.toLowerCase().includes(p))) {
                    completions.push(item);
                }
            });
        }

        return completions;
    }

    // Instantiate Rich Editors for DSL and YAML
    const dslEditor = createRichEditor('arm-dsl-editor-container', 'dsl');
    const yamlEditor = createRichEditor('arm-yaml-editor-container', 'yaml');

    // -------------------------------------------------------------
    // Tab Management & Bidirectional Synchronization
    // -------------------------------------------------------------
    $element.find('.arm-tab-btn').on('click', function() {
        const tabName = $(this).data('tab');
        switchTab(tabName);
    });

    function switchTab(tabName) {
        state.currentTab = tabName;
        $element.find('.arm-tab-btn').removeClass('arm-tab-active');
        $element.find(`.arm-tab-btn[data-tab="${tabName}"]`).addClass('arm-tab-active');
        $element.find('.arm-tab-content').hide();
        $element.find(`.arm-tab-content[data-tab-content="${tabName}"]`).show();

        if (tabName === 'dsl') {
            const dslText = serializeARMDSL(state.graph);
            dslEditor.setValue(dslText);
            $element.find('.arm-dsl-diagnostics').hide();
        } else if (tabName === 'yaml') {
            const yamlText = serializeARMYAML(state.graph);
            yamlEditor.setValue(yamlText);
            $element.find('.arm-yaml-diagnostics').hide();
        } else if (tabName === 'canvas') {
            renderCanvas();
        }
    }

    // Apply DSL Button
    $element.find('.arm-apply-dsl-btn').on('click', function() {
        const text = dslEditor.getValue();
        try {
            const parsedGraph = parseARMDSL(text);
            state.graph = parsedGraph;
            $element.find('.arm-dsl-diagnostics').hide();
            showToast('ARM DSL compiled and applied to visual canvas successfully!', 'success');
            switchTab('canvas');
        } catch (err) {
            $element.find('.arm-dsl-diagnostics').show().html(`<strong>DSL Parse Error:</strong> ${escapeHtml(err.message)}`);
            showToast('DSL Syntax Error: ' + err.message, 'error');
        }
    });

    // Copy DSL Button
    $element.find('.arm-export-dsl-btn').on('click', function() {
        const text = dslEditor.getValue();
        navigator.clipboard.writeText(text).then(() => {
            showToast('ARM DSL copied to clipboard!', 'info');
        }).catch(() => {
            showToast('Failed to copy to clipboard.', 'warning');
        });
    });

    // Apply YAML Button
    $element.find('.arm-apply-yaml-btn').on('click', function() {
        const text = yamlEditor.getValue();
        try {
            const parsedGraph = parseARMYAML(text);
            state.graph = parsedGraph;
            $element.find('.arm-yaml-diagnostics').hide();
            showToast('YAML specification parsed and loaded to canvas successfully!', 'success');
            switchTab('canvas');
        } catch (err) {
            $element.find('.arm-yaml-diagnostics').show().html(`<strong>YAML Parse Error:</strong> ${escapeHtml(err.message)}`);
            showToast('YAML Validation Error: ' + err.message, 'error');
        }
    });

    // Copy YAML Button
    $element.find('.arm-export-yaml-btn').on('click', function() {
        const text = yamlEditor.getValue();
        navigator.clipboard.writeText(text).then(() => {
            showToast('YAML copied to clipboard!', 'info');
        }).catch(() => {
            showToast('Failed to copy to clipboard.', 'warning');
        });
    });

    // -------------------------------------------------------------
    // Drag & Drop / File Upload Handler (.arm / .yaml / .json)
    // -------------------------------------------------------------
    const $dropzone = $element.find('.arm-upload-dropzone');
    const $fileInput = $element.find('#arm-file-input');

    $element.find('.arm-choose-file-btn').on('click', function(e) {
        e.stopPropagation();
        $fileInput.click();
    });

    $dropzone.on('click', function() {
        $fileInput.click();
    });

    $dropzone.on('dragover dragenter', function(e) {
        e.preventDefault();
        e.stopPropagation();
        $dropzone.addClass('arm-dragover');
    });

    $dropzone.on('dragleave dragend drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        $dropzone.removeClass('arm-dragover');
    });

    $dropzone.on('drop', function(e) {
        const files = e.originalEvent.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });

    $fileInput.on('change', function(e) {
        if (this.files && this.files.length > 0) {
            handleFileUpload(this.files[0]);
        }
    });

    function handleFileUpload(file) {
        const reader = new FileReader();
        const fname = file.name;
        $element.find('.arm-upload-filename').text(`Loading ${fname}...`).show();

        reader.onload = function(evt) {
            const content = evt.target.result;
            try {
                let parsedGraph = null;
                if (fname.endsWith('.arm') || fname.endsWith('.dsl')) {
                    parsedGraph = parseARMDSL(content);
                } else if (fname.endsWith('.yaml') || fname.endsWith('.yml')) {
                    parsedGraph = parseARMYAML(content);
                } else if (fname.endsWith('.json')) {
                    parsedGraph = JSON.parse(content);
                } else {
                    try {
                        parsedGraph = parseARMDSL(content);
                    } catch (_) {
                        parsedGraph = parseARMYAML(content);
                    }
                }

                if (!parsedGraph || !Array.isArray(parsedGraph.applications)) {
                    throw new Error('File does not contain valid ARM applications specification.');
                }

                state.graph = parsedGraph;
                $element.find('.arm-upload-filename').text(`✓ Successfully imported ${fname}`).show();
                showToast(`Diagram '${fname}' imported successfully!`, 'success');
                setTimeout(() => { switchTab('canvas'); }, 600);
            } catch (err) {
                $element.find('.arm-upload-filename').text(`✗ Error importing ${fname}: ${err.message}`).css('color', '#f87171').show();
                showToast(`Failed to parse ${fname}: ${err.message}`, 'error');
            }
        };
        reader.readAsText(file);
    }

    // -------------------------------------------------------------
    // ARM DSL Parser & Serializer Engine (with Make/Buy/Use Dimensions)
    // -------------------------------------------------------------
    function serializeARMDSL(graph) {
        const lines = [];
        lines.push('// Architecture Runtime Model (ARM) Specification');
        lines.push('');

        (graph.applications || []).forEach(app => {
            const scope = (app.scope || 'INTERNAL').toLowerCase();
            const sourcing = app.sourcing ? app.sourcing.toLowerCase() : null;
            const x = Math.round(app.x || 60);
            const y = Math.round(app.y || 60);
            const w = Math.round(app.width || 260);
            const h = Math.round(app.height || 190);

            // Construct Header: [scope] [sourcing] application "Name" at (x, y) size (w, h) {
            let headerPrefix = scope;
            if (scope === 'internal') {
                if (sourcing && sourcing !== 'make') {
                    headerPrefix = `internal ${sourcing}`;
                }
            } else if (scope === 'external') {
                if (sourcing) {
                    headerPrefix = `external ${sourcing}`;
                }
            } else if (scope === 'infrastructure') {
                if (sourcing) {
                    headerPrefix = `infrastructure ${sourcing}`;
                }
            }

            lines.push(`${headerPrefix} application "${app.name}" at (${x}, ${y}) size (${w}, ${h}) {`);
            if (app.team) {
                lines.push(`    team: "${app.team}"`);
            }
            if (app.business_capabilities && app.business_capabilities.length > 0) {
                const caps = app.business_capabilities.map(c => `"${c}"`).join(', ');
                lines.push(`    capabilities: ${caps}`);
            }
            (app.data_objects || []).forEach(data => {
                const cls = data.classification ? ` [${data.classification}]` : '';
                lines.push(`    data "${data.name}"${cls}`);
            });

            if (app.services && app.services.length > 0) {
                lines.push('');
                app.services.forEach(srv => {
                    const sType = mapServiceTypeToKeyword(srv.service_type);
                    const srvDeps = (graph.dependencies || []).filter(d => 
                        d.source_app_id === app.id && d.source_service_id === srv.id
                    );

                    if (srvDeps.length === 0) {
                        lines.push(`    ${sType} service "${srv.name}"`);
                    } else {
                        lines.push(`    ${sType} service "${srv.name}" ->`);
                        srvDeps.forEach(dep => {
                            const tgtApp = (graph.applications || []).find(a => a.id === dep.target_app_id);
                            if (!tgtApp) return;
                            const tgtSrv = (tgtApp.services || []).find(s => s.id === dep.target_service_id);
                            const tgtRef = tgtSrv ? `"${tgtApp.name}"."${tgtSrv.name}"` : `"${tgtApp.name}"`;
                            const sync = (dep.sync_type || 'SYNC').toLowerCase();
                            const proto = dep.protocol ? ` ${dep.protocol}` : '';
                            lines.push(`        ${tgtRef} ${sync}${proto}`);
                        });
                    }
                });
            }
            lines.push('}');
            lines.push('');
        });

        // Application-level dependencies (without specific source service)
        const orphanDeps = (graph.dependencies || []).filter(d => !d.source_service_id);
        if (orphanDeps.length > 0) {
            lines.push('// Application-Level Dependencies');
            orphanDeps.forEach(dep => {
                const srcApp = (graph.applications || []).find(a => a.id === dep.source_app_id);
                const tgtApp = (graph.applications || []).find(a => a.id === dep.target_app_id);
                if (!srcApp || !tgtApp) return;
                const tgtSrv = (tgtApp.services || []).find(s => s.id === dep.target_service_id);
                const tgtRef = tgtSrv ? `"${tgtApp.name}"."${tgtSrv.name}"` : `"${tgtApp.name}"`;
                const sync = (dep.sync_type || 'SYNC').toLowerCase();
                const proto = dep.protocol ? ` ${dep.protocol}` : '';
                lines.push(`"${srcApp.name}" -> ${tgtRef} ${sync}${proto}`);
            });
            lines.push('');
        }

        return lines.join('\n');
    }

    function mapServiceTypeToKeyword(st) {
        switch (st) {
            case 'REST_API': return 'rest';
            case 'UI': return 'ui';
            case 'EVENT': return 'event';
            case 'GRAPHQL': return 'graphql';
            case 'GRPC': return 'grpc';
            case 'BATCH': return 'batch';
            default: return 'rest';
        }
    }

    function mapKeywordToServiceType(kw) {
        const k = (kw || '').toLowerCase();
        if (k === 'rest' || k === 'rest_api' || k === 'http') return 'REST_API';
        if (k === 'ui' || k === 'web' || k === 'mobile') return 'UI';
        if (k === 'event' || k === 'kafka' || k === 'topic' || k === 'solace') return 'EVENT';
        if (k === 'graphql') return 'GRAPHQL';
        if (k === 'grpc') return 'GRPC';
        if (k === 'batch') return 'BATCH';
        return 'REST_API';
    }

    function parseARMDSL(text) {
        const lines = text.split('\n');
        const applications = [];
        const dependencies = [];
        const pendingDepStatements = [];

        let currentApp = null;
        let currentConnectingService = null;
        let lineNum = 0;

        for (let rawLine of lines) {
            lineNum++;
            const line = rawLine.trim();

            if (!line || line.startsWith('//') || line.startsWith('#')) {
                continue;
            }

            // Application block start:
            // (internal|external|infrastructure)? (make|buy|use)? application "Name" [at (x,y)] [size (w,h)] {
            const appHeaderMatch = line.match(/^(?:(internal|external|infrastructure)\s+)?(?:(make|buy|use)\s+)?application\s+"([^"]+)"(?:\s*at\s*\(\s*(\d+)\s*,\s*(\d+)\s*\))?(?:\s*size\s*\(\s*(\d+)\s*,\s*(\d+)\s*\))?\s*\{/i);
            if (appHeaderMatch) {
                if (currentApp) {
                    throw new Error(`Line ${lineNum}: Nested applications are not allowed. Missing closing '}' for '${currentApp.name}'.`);
                }
                const scopeRaw = (appHeaderMatch[1] || 'internal').toUpperCase();
                const sourcingRaw = appHeaderMatch[2] ? appHeaderMatch[2].toUpperCase() : (scopeRaw === 'INTERNAL' ? 'MAKE' : null);
                const appName = appHeaderMatch[3];
                const posX = appHeaderMatch[4] ? parseInt(appHeaderMatch[4], 10) : (60 + (applications.length % 3) * 290);
                const posY = appHeaderMatch[5] ? parseInt(appHeaderMatch[5], 10) : (60 + Math.floor(applications.length / 3) * 230);
                const width = appHeaderMatch[6] ? parseInt(appHeaderMatch[6], 10) : 260;
                const height = appHeaderMatch[7] ? parseInt(appHeaderMatch[7], 10) : 190;

                const appId = 'app_' + Math.random().toString(36).substr(2, 9);
                currentApp = {
                    id: appId,
                    name: appName,
                    scope: scopeRaw,
                    sourcing: sourcingRaw,
                    team: null,
                    business_capabilities: [],
                    services: [],
                    data_objects: [],
                    x: posX,
                    y: posY,
                    width: width,
                    height: height
                };
                currentConnectingService = null;
                continue;
            }

            // Application block end
            if (line === '}') {
                if (!currentApp) {
                    throw new Error(`Line ${lineNum}: Unexpected closing '}' without matching application declaration.`);
                }
                applications.push(currentApp);
                currentApp = null;
                currentConnectingService = null;
                continue;
            }

            // Inside Application declarations
            if (currentApp) {
                // Check for Service Declaration: rest service "Name" [-> [targets]]
                const srvMatch = line.match(/^(rest|ui|event|graphql|grpc|batch)\s+service\s+"([^"]+)"(?:\s*->(.*))?$/i);
                if (srvMatch) {
                    const srvType = mapKeywordToServiceType(srvMatch[1]);
                    const srvName = srvMatch[2];
                    const newSrv = {
                        id: 'srv_' + Math.random().toString(36).substr(2, 9),
                        name: srvName,
                        service_type: srvType
                    };
                    currentApp.services.push(newSrv);

                    // Check if service has inline connection or multi-line connection header ->
                    if (srvMatch[0].includes('->')) {
                        currentConnectingService = newSrv;
                        const remainder = (srvMatch[3] || '').trim();
                        if (remainder) {
                            parseTargetLine(remainder, lineNum, currentApp.name, newSrv.name, pendingDepStatements);
                        }
                    } else {
                        currentConnectingService = null;
                    }
                    continue;
                }

                // If currently parsing indented dependency targets under a service:
                if (currentConnectingService) {
                    const targetMatch = line.match(/^"([^"]+)"(?:\."([^"]+)")?(?:\s+(sync|async))?(?:\s+(.+))?$/i);
                    if (targetMatch && !line.startsWith('team:') && !line.startsWith('capabilities:') && !line.startsWith('data ') && !line.startsWith('sourcing:')) {
                        parseTargetLine(line, lineNum, currentApp.name, currentConnectingService.name, pendingDepStatements);
                        continue;
                    } else {
                        currentConnectingService = null;
                    }
                }

                // Team
                const teamMatch = line.match(/^team\s*:\s*"([^"]+)"/i);
                if (teamMatch) {
                    currentApp.team = teamMatch[1];
                    continue;
                }

                // Sourcing property override (e.g. sourcing: "BUY")
                const srcMatch = line.match(/^sourcing\s*:\s*"?(MAKE|BUY|USE)"?/i);
                if (srcMatch) {
                    currentApp.sourcing = srcMatch[1].toUpperCase();
                    continue;
                }

                // Capabilities
                const capMatch = line.match(/^(?:capabilities|capability)\s*:\s*(.+)$/i);
                if (capMatch) {
                    const capList = [];
                    const qRegex = /"([^"]+)"/g;
                    let m;
                    while ((m = qRegex.exec(capMatch[1])) !== null) {
                        capList.push(m[1].trim());
                    }
                    if (capList.length === 0) {
                        capList.push(...capMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean));
                    }
                    currentApp.business_capabilities.push(...capList);
                    continue;
                }

                // Data Object
                const dataMatch = line.match(/^data\s+"([^"]+)"(?:\s*\[([^\]]+)\])?/i);
                if (dataMatch) {
                    const dataName = dataMatch[1];
                    const dataClass = dataMatch[2] ? dataMatch[2].trim() : 'Transactional';
                    currentApp.data_objects.push({
                        id: 'data_' + Math.random().toString(36).substr(2, 9),
                        name: dataName,
                        classification: dataClass
                    });
                    continue;
                }

                throw new Error(`Line ${lineNum}: Unrecognized application member statement: '${line}'`);
            }

            // Top-Level / Standalone Dependency Statement
            const depMatch = line.match(/^"([^"]+)"(?:\."([^"]+)")?\s*->\s*"([^"]+)"(?:\."([^"]+)")?(?:\s*:\s*\[(SYNC|ASYNC)\])?(?:\s+(sync|async))?(?:\s+"?([^"]*)"?)?/i);
            if (depMatch) {
                const syncRaw = (depMatch[5] || depMatch[6] || 'SYNC').toUpperCase();
                pendingDepStatements.push({
                    lineNum: lineNum,
                    sourceAppName: depMatch[1],
                    sourceServiceName: depMatch[2] || null,
                    targetAppName: depMatch[3],
                    targetServiceName: depMatch[4] || null,
                    syncType: syncRaw,
                    protocol: (depMatch[7] || '').trim() || null
                });
                continue;
            }

            throw new Error(`Line ${lineNum}: Syntax error near '${line}'`);
        }

        if (currentApp) {
            throw new Error(`Unclosed application block '${currentApp.name}'. Missing closing '}'.`);
        }

        // Link dependencies by exact name resolution
        pendingDepStatements.forEach(stmt => {
            const srcApp = applications.find(a => a.name.toLowerCase() === stmt.sourceAppName.toLowerCase());
            if (!srcApp) {
                throw new Error(`Line ${stmt.lineNum}: Calling source application '${stmt.sourceAppName}' was not declared.`);
            }

            const tgtApp = applications.find(a => a.name.toLowerCase() === stmt.targetAppName.toLowerCase());
            if (!tgtApp) {
                throw new Error(`Line ${stmt.lineNum}: Target provider application '${stmt.targetAppName}' was not declared.`);
            }

            let srcSrvId = null;
            if (stmt.sourceServiceName) {
                const srcSrv = srcApp.services.find(s => s.name.toLowerCase() === stmt.sourceServiceName.toLowerCase());
                if (!srcSrv) {
                    throw new Error(`Line ${stmt.lineNum}: Calling source service '${stmt.sourceServiceName}' not found in application '${srcApp.name}'.`);
                }
                srcSrvId = srcSrv.id;
            }

            let tgtSrvId = null;
            if (stmt.targetServiceName) {
                const tgtSrv = tgtApp.services.find(s => s.name.toLowerCase() === stmt.targetServiceName.toLowerCase());
                if (!tgtSrv) {
                    throw new Error(`Line ${stmt.lineNum}: Target service interface '${stmt.targetServiceName}' not found in provider application '${tgtApp.name}'.`);
                }
                tgtSrvId = tgtSrv.id;
            } else {
                if (tgtApp.services.length === 0) {
                    throw new Error(`Line ${stmt.lineNum}: Provider application '${tgtApp.name}' has no exposed services to connect to.`);
                }
                tgtSrvId = tgtApp.services[0].id;
            }

            dependencies.push({
                id: 'dep_' + Math.random().toString(36).substr(2, 9),
                source_app_id: srcApp.id,
                source_service_id: srcSrvId,
                target_app_id: tgtApp.id,
                target_service_id: tgtSrvId,
                sync_type: stmt.syncType,
                protocol: stmt.protocol
            });
        });

        return { applications, dependencies };
    }

    function parseTargetLine(lineText, lineNum, srcAppName, srcSrvName, pendingList) {
        const m = lineText.match(/^"([^"]+)"(?:\."([^"]+)")?(?:\s+(sync|async))?(?:\s+(.+))?$/i);
        if (!m) {
            throw new Error(`Line ${lineNum}: Invalid dependency target specification: '${lineText}'`);
        }

        let syncType = 'SYNC';
        let protocol = null;

        if (m[3]) {
            syncType = m[3].toUpperCase();
            protocol = m[4] ? m[4].replace(/^["']|["']$/g, '').trim() : null;
        } else if (m[4]) {
            const rest = m[4].trim();
            if (rest.toLowerCase().startsWith('async')) {
                syncType = 'ASYNC';
                protocol = rest.substring(5).replace(/^["']|["']$/g, '').trim() || null;
            } else if (rest.toLowerCase().startsWith('sync')) {
                syncType = 'SYNC';
                protocol = rest.substring(4).replace(/^["']|["']$/g, '').trim() || null;
            } else {
                protocol = rest.replace(/^["']|["']$/g, '').trim();
            }
        }

        pendingList.push({
            lineNum: lineNum,
            sourceAppName: srcAppName,
            sourceServiceName: srcSrvName,
            targetAppName: m[1],
            targetServiceName: m[2] || null,
            syncType: syncType,
            protocol: protocol
        });
    }

    // -------------------------------------------------------------
    // Structured YAML Parser & Serializer Engine (with Placement Hints & Sourcing)
    // -------------------------------------------------------------
    function serializeARMYAML(graph) {
        const out = [];
        out.push('# Architecture Runtime Model (ARM) Specification');
        out.push('applications:');

        (graph.applications || []).forEach(app => {
            out.push(`  - id: "${app.id}"`);
            out.push(`    name: "${app.name.replace(/"/g, '\\"')}"`);
            out.push(`    scope: "${app.scope || 'INTERNAL'}"`);
            out.push(`    sourcing: ${app.sourcing ? `"${app.sourcing}"` : (app.scope === 'INTERNAL' ? '"MAKE"' : 'null')}`);
            if (app.team) {
                out.push(`    team: "${app.team.replace(/"/g, '\\"')}"`);
            } else {
                out.push(`    team: null`);
            }
            out.push('    business_capabilities:');
            if (app.business_capabilities && app.business_capabilities.length > 0) {
                app.business_capabilities.forEach(c => {
                    out.push(`      - "${c.replace(/"/g, '\\"')}"`);
                });
            } else {
                out.push('      []');
            }
            out.push('    services:');
            if (app.services && app.services.length > 0) {
                app.services.forEach(s => {
                    out.push(`      - id: "${s.id}"`);
                    out.push(`        name: "${s.name.replace(/"/g, '\\"')}"`);
                    out.push(`        service_type: "${s.service_type}"`);
                });
            } else {
                out.push('      []');
            }
            out.push('    data_objects:');
            if (app.data_objects && app.data_objects.length > 0) {
                app.data_objects.forEach(d => {
                    out.push(`      - id: "${d.id}"`);
                    out.push(`        name: "${d.name.replace(/"/g, '\\"')}"`);
                    out.push(`        classification: "${d.classification || 'Transactional'}"`);
                });
            } else {
                out.push('      []');
            }
            out.push('    layout:');
            out.push(`      x: ${Math.round(app.x || 60)}`);
            out.push(`      y: ${Math.round(app.y || 60)}`);
            out.push(`      width: ${Math.round(app.width || 260)}`);
            out.push(`      height: ${Math.round(app.height || 190)}`);
            out.push('');
        });

        out.push('dependencies:');
        if (graph.dependencies && graph.dependencies.length > 0) {
            graph.dependencies.forEach(dep => {
                out.push(`  - id: "${dep.id}"`);
                out.push(`    source_app_id: "${dep.source_app_id}"`);
                out.push(`    source_service_id: ${dep.source_service_id ? `"${dep.source_service_id}"` : 'null'}`);
                out.push(`    target_app_id: "${dep.target_app_id}"`);
                out.push(`    target_service_id: "${dep.target_service_id}"`);
                out.push(`    sync_type: "${dep.sync_type || 'SYNC'}"`);
                out.push(`    protocol: ${dep.protocol ? `"${dep.protocol.replace(/"/g, '\\"')}"` : 'null'}`);
            });
        } else {
            out.push('  []');
        }

        return out.join('\n');
    }

    function parseARMYAML(text) {
        const lines = text.split('\n');
        const applications = [];
        const dependencies = [];

        let currentSection = null;
        let currentApp = null;
        let currentDep = null;
        let subList = null;
        let currentSubObj = null;

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmed = raw.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const indent = raw.search(/\S|$/);

            if (trimmed.startsWith('applications:')) {
                currentSection = 'applications';
                subList = null;
                continue;
            } else if (trimmed.startsWith('dependencies:')) {
                if (currentApp) { applications.push(currentApp); currentApp = null; }
                currentSection = 'dependencies';
                subList = null;
                continue;
            }

            if (currentSection === 'applications') {
                if (trimmed.startsWith('- id:') || (indent === 2 && trimmed.startsWith('-'))) {
                    if (currentApp) { applications.push(currentApp); }
                    currentApp = {
                        id: 'app_' + Math.random().toString(36).substr(2, 9),
                        name: '',
                        scope: 'INTERNAL',
                        sourcing: 'MAKE',
                        team: null,
                        business_capabilities: [],
                        services: [],
                        data_objects: [],
                        x: 60 + (applications.length % 3) * 290,
                        y: 60 + Math.floor(applications.length / 3) * 230,
                        width: 260,
                        height: 190
                    };
                    subList = null;

                    const matchId = trimmed.match(/- id:\s*"?([^"]+)"?/);
                    if (matchId) currentApp.id = matchId[1].trim();
                    continue;
                }

                if (!currentApp) continue;

                if (trimmed.startsWith('name:')) {
                    currentApp.name = cleanYamlVal(trimmed.substring(5));
                } else if (trimmed.startsWith('scope:')) {
                    currentApp.scope = cleanYamlVal(trimmed.substring(6)).toUpperCase();
                    if (currentApp.scope === 'INTERNAL' && !currentApp.sourcing) {
                        currentApp.sourcing = 'MAKE';
                    }
                } else if (trimmed.startsWith('sourcing:')) {
                    const s = cleanYamlVal(trimmed.substring(9));
                    currentApp.sourcing = (s === 'null' || !s) ? (currentApp.scope === 'INTERNAL' ? 'MAKE' : null) : s.toUpperCase();
                } else if (trimmed.startsWith('team:')) {
                    const t = cleanYamlVal(trimmed.substring(5));
                    currentApp.team = (t === 'null' || !t) ? null : t;
                } else if (trimmed.startsWith('business_capabilities:')) {
                    subList = 'business_capabilities';
                } else if (trimmed.startsWith('services:')) {
                    subList = 'services';
                    currentSubObj = null;
                } else if (trimmed.startsWith('data_objects:')) {
                    subList = 'data_objects';
                    currentSubObj = null;
                } else if (trimmed.startsWith('layout:')) {
                    subList = 'layout';
                } else if (subList === 'business_capabilities' && trimmed.startsWith('-')) {
                    currentApp.business_capabilities.push(cleanYamlVal(trimmed.substring(1)));
                } else if (subList === 'services') {
                    if (trimmed.startsWith('-')) {
                        currentSubObj = { id: 'srv_' + Math.random().toString(36).substr(2, 9), name: '', service_type: 'REST_API' };
                        currentApp.services.push(currentSubObj);
                        const m = trimmed.match(/- id:\s*"?([^"]+)"?/);
                        if (m) currentSubObj.id = m[1].trim();
                    } else if (currentSubObj) {
                        if (trimmed.startsWith('name:')) currentSubObj.name = cleanYamlVal(trimmed.substring(5));
                        if (trimmed.startsWith('service_type:')) currentSubObj.service_type = mapKeywordToServiceType(cleanYamlVal(trimmed.substring(13)));
                    }
                } else if (subList === 'data_objects') {
                    if (trimmed.startsWith('-')) {
                        currentSubObj = { id: 'data_' + Math.random().toString(36).substr(2, 9), name: '', classification: 'Transactional' };
                        currentApp.data_objects.push(currentSubObj);
                        const m = trimmed.match(/- id:\s*"?([^"]+)"?/);
                        if (m) currentSubObj.id = m[1].trim();
                    } else if (currentSubObj) {
                        if (trimmed.startsWith('name:')) currentSubObj.name = cleanYamlVal(trimmed.substring(5));
                        if (trimmed.startsWith('classification:')) currentSubObj.classification = cleanYamlVal(trimmed.substring(15));
                    }
                } else if (subList === 'layout') {
                    if (trimmed.startsWith('x:')) currentApp.x = parseFloat(cleanYamlVal(trimmed.substring(2))) || currentApp.x;
                    if (trimmed.startsWith('y:')) currentApp.y = parseFloat(cleanYamlVal(trimmed.substring(2))) || currentApp.y;
                    if (trimmed.startsWith('width:')) currentApp.width = parseFloat(cleanYamlVal(trimmed.substring(6))) || currentApp.width;
                    if (trimmed.startsWith('height:')) currentApp.height = parseFloat(cleanYamlVal(trimmed.substring(7))) || currentApp.height;
                }
            } else if (currentSection === 'dependencies') {
                if (trimmed.startsWith('- id:') || (indent === 2 && trimmed.startsWith('-'))) {
                    if (currentDep) dependencies.push(currentDep);
                    currentDep = {
                        id: 'dep_' + Math.random().toString(36).substr(2, 9),
                        source_app_id: '',
                        source_service_id: null,
                        target_app_id: '',
                        target_service_id: '',
                        sync_type: 'SYNC',
                        protocol: null
                    };
                    const m = trimmed.match(/- id:\s*"?([^"]+)"?/);
                    if (m) currentDep.id = m[1].trim();
                    continue;
                }
                if (!currentDep) continue;
                if (trimmed.startsWith('source_app_id:')) currentDep.source_app_id = cleanYamlVal(trimmed.substring(14));
                if (trimmed.startsWith('source_service_id:')) {
                    const s = cleanYamlVal(trimmed.substring(18));
                    currentDep.source_service_id = (s === 'null' || !s) ? null : s;
                }
                if (trimmed.startsWith('target_app_id:')) currentDep.target_app_id = cleanYamlVal(trimmed.substring(14));
                if (trimmed.startsWith('target_service_id:')) currentDep.target_service_id = cleanYamlVal(trimmed.substring(18));
                if (trimmed.startsWith('sync_type:')) currentDep.sync_type = cleanYamlVal(trimmed.substring(10)).toUpperCase();
                if (trimmed.startsWith('protocol:')) {
                    const p = cleanYamlVal(trimmed.substring(9));
                    currentDep.protocol = (p === 'null' || !p) ? null : p;
                }
            }
        }

        if (currentApp) applications.push(currentApp);
        if (currentDep) dependencies.push(currentDep);

        if (applications.length === 0) {
            throw new Error('YAML must declare at least one application.');
        }

        return { applications, dependencies };
    }

    function cleanYamlVal(val) {
        if (!val) return '';
        let s = val.trim();
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            s = s.substring(1, s.length - 1);
        }
        return s;
    }

    // -------------------------------------------------------------
    // Toast Notifications & Modal Management
    // -------------------------------------------------------------
    function showToast(message, type = 'info') {
        const $container = $element.find('.arm-toast-container');
        const $toast = $(`
            <div class="arm-toast arm-toast-${type}">
                <span>${escapeHtml(message)}</span>
                <button type="button" class="arm-node-delete-btn" style="color: inherit;">✕</button>
            </div>
        `);
        $toast.find('button').on('click', function() {
            $toast.fadeOut(150, function() { $(this).remove(); });
        });
        $container.append($toast);
        setTimeout(function() {
            $toast.fadeOut(300, function() { $(this).remove(); });
        }, 4000);
    }

    function openModal(modalId) {
        $element.find('.arm-modal-overlay').show();
        $element.find('.arm-modal').hide();
        $element.find('#' + modalId).show();
    }

    function closeModal() {
        $element.find('.arm-modal-overlay').hide();
        $element.find('.arm-modal').hide();
        state.pendingConfirmAction = null;
        state.pendingTargetAppId = null;
        state.editingAppId = null;
        state.editingServiceId = null;
        state.editingDataId = null;
    }

    function showConfirm(title, message, onConfirm) {
        $element.find('.arm-confirm-title').text(title);
        $element.find('.arm-confirm-message').text(message);
        state.pendingConfirmAction = onConfirm;
        openModal('arm-modal-confirm');
    }

    // Close Modal Handlers
    $element.find('.arm-modal-close-btn, .arm-modal-cancel-btn').on('click', function() {
        closeModal();
    });

    $element.find('.arm-modal-confirm-btn').on('click', function() {
        if (typeof state.pendingConfirmAction === 'function') {
            state.pendingConfirmAction();
        }
        closeModal();
    });

    // -------------------------------------------------------------
    // Validation & State Helpers
    // -------------------------------------------------------------
    function updateConnectButtonState() {
        const totalServices = state.graph.applications.reduce((acc, a) => acc + (a.services ? a.services.length : 0), 0);
        const $btn = $element.find('.arm-connect-mode-btn');

        if (totalServices < 2) {
            $btn.prop('disabled', true).addClass('arm-btn-disabled');
            $btn.attr('title', `Connect Service Dependency disabled: At least 2 services required across applications (Currently: ${totalServices}). Add services first.`);
        } else {
            $btn.prop('disabled', false).removeClass('arm-btn-disabled');
            $btn.attr('title', 'Connect a calling application/service to a provider service interface.');
        }
    }

    // -------------------------------------------------------------
    // UI Modal Dialog Actions
    // -------------------------------------------------------------
    // 1. Add Application
    $element.find('.arm-add-app-btn').on('click', function() {
        $element.find('#arm-input-app-name').val('');
        $element.find('#arm-select-app-scope').val('INTERNAL');
        $element.find('#arm-select-app-sourcing').val('');
        $element.find('#arm-input-app-team').val('');
        $element.find('#arm-input-app-capabilities').val('');
        openModal('arm-modal-app');
        $element.find('#arm-input-app-name').focus();
    });

    $element.find('.arm-modal-app-save-btn').on('click', function() {
        const appName = $element.find('#arm-input-app-name').val().trim();
        const appScope = $element.find('#arm-select-app-scope').val();
        const appSourcingRaw = $element.find('#arm-select-app-sourcing').val();
        const appSourcing = appSourcingRaw ? appSourcingRaw : (appScope === 'INTERNAL' ? 'MAKE' : null);
        const appTeam = $element.find('#arm-input-app-team').val().trim();
        const rawCaps = $element.find('#arm-input-app-capabilities').val().trim();

        if (!appName) {
            showToast('Please enter an application name.', 'warning');
            $element.find('#arm-input-app-name').focus();
            return;
        }

        const caps = rawCaps ? rawCaps.split(',').map(s => s.trim()).filter(Boolean) : [];
        const newId = 'app_' + Math.random().toString(36).substr(2, 9);
        const nextX = 60 + (state.graph.applications.length % 3) * 290;
        const nextY = 60 + Math.floor(state.graph.applications.length / 3) * 230;

        state.graph.applications.push({
            id: newId,
            name: appName,
            scope: appScope,
            sourcing: appSourcing,
            team: appTeam || null,
            business_capabilities: caps,
            services: [],
            data_objects: [],
            x: nextX,
            y: nextY,
            width: 260,
            height: 190
        });

        state.selectedAppId = newId;
        closeModal();
        renderCanvas();
        showToast(`Application '${appName}' [${appScope}${appSourcing ? ' (' + appSourcing + ')' : ''}] created.`, 'success');
    });

    // 2. Edit Application (Save)
    $element.find('.arm-modal-edit-app-save-btn').on('click', function() {
        if (!state.editingAppId) return;
        const app = state.graph.applications.find(a => a.id === state.editingAppId);
        if (!app) return;

        const newName = $element.find('#arm-edit-app-name').val().trim();
        const newScope = $element.find('#arm-edit-app-scope').val();
        const newSourcingRaw = $element.find('#arm-edit-app-sourcing').val();
        const newSourcing = newSourcingRaw ? newSourcingRaw : (newScope === 'INTERNAL' ? 'MAKE' : null);
        const newTeam = $element.find('#arm-edit-app-team').val().trim();
        const rawCaps = $element.find('#arm-edit-app-capabilities').val().trim();

        if (!newName) {
            showToast('Application name cannot be empty.', 'warning');
            return;
        }

        app.name = newName;
        app.scope = newScope;
        app.sourcing = newSourcing;
        app.team = newTeam || null;
        app.business_capabilities = rawCaps ? rawCaps.split(',').map(s => s.trim()).filter(Boolean) : [];

        closeModal();
        renderCanvas();
        showToast(`Application '${app.name}' updated.`, 'success');
    });

    // 3. Add Service
    $element.find('.arm-add-service-btn').on('click', function() {
        if (!state.selectedAppId) {
            showToast('Please click to select an Application container first.', 'warning');
            return;
        }
        const app = state.graph.applications.find(a => a.id === state.selectedAppId);
        if (!app) {
            showToast('Selected application no longer exists.', 'warning');
            return;
        }

        $element.find('.arm-target-app-name').text(app.name);
        $element.find('#arm-input-service-name').val('');
        $element.find('#arm-select-service-type').val('REST_API');
        openModal('arm-modal-service');
        $element.find('#arm-input-service-name').focus();
    });

    $element.find('.arm-modal-service-save-btn').on('click', function() {
        const srvName = $element.find('#arm-input-service-name').val().trim();
        const srvType = $element.find('#arm-select-service-type').val();

        if (!srvName) {
            showToast('Please enter a service interface name.', 'warning');
            $element.find('#arm-input-service-name').focus();
            return;
        }

        const app = state.graph.applications.find(a => a.id === state.selectedAppId);
        if (app) {
            app.services.push({
                id: 'srv_' + Math.random().toString(36).substr(2, 9),
                name: srvName,
                service_type: srvType
            });
            closeModal();
            renderCanvas();
            showToast(`Service '${srvName}' (${srvType}) added to '${app.name}'.`, 'success');
        }
    });

    // 4. Edit Service (Save)
    $element.find('.arm-modal-edit-service-save-btn').on('click', function() {
        if (!state.editingAppId || !state.editingServiceId) return;
        const app = state.graph.applications.find(a => a.id === state.editingAppId);
        if (!app) return;
        const srv = app.services.find(s => s.id === state.editingServiceId);
        if (!srv) return;

        const newName = $element.find('#arm-edit-service-name').val().trim();
        const newType = $element.find('#arm-edit-service-type').val();

        if (!newName) {
            showToast('Service name cannot be empty.', 'warning');
            return;
        }

        srv.name = newName;
        srv.service_type = newType;

        closeModal();
        renderCanvas();
        showToast(`Service interface '${srv.name}' updated.`, 'success');
    });

    // 5. Add Data Object
    $element.find('.arm-add-data-btn').on('click', function() {
        if (!state.selectedAppId) {
            showToast('Please click to select an Application container first.', 'warning');
            return;
        }
        const app = state.graph.applications.find(a => a.id === state.selectedAppId);
        if (!app) {
            showToast('Selected application no longer exists.', 'warning');
            return;
        }

        $element.find('.arm-target-app-name').text(app.name);
        $element.find('#arm-input-data-name').val('');
        $element.find('#arm-input-data-classification').val('Transactional');
        openModal('arm-modal-data');
        $element.find('#arm-input-data-name').focus();
    });

    $element.find('.arm-modal-data-save-btn').on('click', function() {
        const dataName = $element.find('#arm-input-data-name').val().trim();
        const dataClass = $element.find('#arm-input-data-classification').val();

        if (!dataName) {
            showToast('Please enter a data object name.', 'warning');
            $element.find('#arm-input-data-name').focus();
            return;
        }

        const app = state.graph.applications.find(a => a.id === state.selectedAppId);
        if (app) {
            app.data_objects.push({
                id: 'data_' + Math.random().toString(36).substr(2, 9),
                name: dataName,
                classification: dataClass
            });
            closeModal();
            renderCanvas();
            showToast(`Data Object '${dataName}' added to '${app.name}'.`, 'success');
        }
    });

    // 6. Edit Data Object (Save)
    $element.find('.arm-modal-edit-data-save-btn').on('click', function() {
        if (!state.editingAppId || !state.editingDataId) return;
        const app = state.graph.applications.find(a => a.id === state.editingAppId);
        if (!app) return;
        const dataObj = app.data_objects.find(d => d.id === state.editingDataId);
        if (!dataObj) return;

        const newName = $element.find('#arm-edit-data-name').val().trim();
        const newClass = $element.find('#arm-edit-data-classification').val();

        if (!newName) {
            showToast('Data Object name cannot be empty.', 'warning');
            return;
        }

        dataObj.name = newName;
        dataObj.classification = newClass;

        closeModal();
        renderCanvas();
        showToast(`Data Object '${dataObj.name}' updated.`, 'success');
    });

    // 7. Connect Dependency Mode Toggle
    $element.find('.arm-connect-mode-btn').on('click', function() {
        const totalServices = state.graph.applications.reduce((acc, a) => acc + (a.services ? a.services.length : 0), 0);
        if (totalServices < 2) {
            showToast('At least 2 declared services required to establish dependency connections.', 'warning');
            return;
        }

        state.connectMode = !state.connectMode;
        state.connectSourceAppId = null;
        state.connectSourceServiceId = null;
        $(this).toggleClass('arm-btn-active', state.connectMode);
        if (state.connectMode) {
            $(this).text('Click Caller (Source Service/App)...');
            showToast('Click the calling Service/Application, then click the target provider Application.', 'info');
        } else {
            $(this).text('➡️ Connect Service Dependency');
        }
    });

    // 8. Save Dependency from Modal
    $element.find('.arm-modal-dep-save-btn').on('click', function() {
        const targetSrvId = $element.find('#arm-select-target-service').val();
        const sourceSrvId = $element.find('#arm-select-source-service').val();
        const syncType = $element.find('#arm-select-sync-type').val();
        const protocol = $element.find('#arm-input-dep-protocol').val().trim();

        if (!state.connectSourceAppId || !state.pendingTargetAppId) {
            closeModal();
            return;
        }

        if (!targetSrvId) {
            showToast('Please select a target service interface to consume.', 'warning');
            return;
        }

        const srcApp = state.graph.applications.find(a => a.id === state.connectSourceAppId);
        const tgtApp = state.graph.applications.find(a => a.id === state.pendingTargetAppId);

        state.graph.dependencies.push({
            id: 'dep_' + Math.random().toString(36).substr(2, 9),
            source_app_id: state.connectSourceAppId,
            source_service_id: sourceSrvId || state.connectSourceServiceId || null,
            target_app_id: state.pendingTargetAppId,
            target_service_id: targetSrvId,
            sync_type: syncType,
            protocol: protocol || null
        });

        state.connectMode = false;
        state.connectSourceAppId = null;
        state.connectSourceServiceId = null;
        $element.find('.arm-connect-mode-btn').removeClass('arm-btn-active').text('➡️ Connect Service Dependency');
        closeModal();
        renderCanvas();
        showToast(`Service dependency connected: '${srcApp ? srcApp.name : "App"}' ➔ '${tgtApp ? tgtApp.name : "App"}' [${syncType}].`, 'success');
    });

    // 9. Request Hint
    $element.find('.arm-hint-btn').on('click', function() {
        const handlerUrl = runtime.handlerUrl(element, 'get_hint');
        $.ajax({
            type: 'POST',
            url: handlerUrl,
            data: JSON.stringify({}),
            contentType: 'application/json; charset=utf-8',
            success: function(resp) {
                if (resp.success) {
                    $element.find('.arm-hint-box').show();
                    $element.find('.arm-hint-text').text(`[Tier ${resp.tier_index}/${resp.total_tiers}] ${resp.hint_text}`);
                    showToast(`Progressive Hint [Tier ${resp.tier_index}/${resp.total_tiers}] unlocked!`, 'info');
                } else {
                    showToast(resp.message || 'No more hints available.', 'warning');
                }
            },
            error: function() {
                showToast('Failed to request hint. Please try again.', 'error');
            }
        });
    });

    // 10. Reset Diagram
    $element.find('.arm-reset-btn').on('click', function() {
        showConfirm('Reset ARM Diagram', 'Are you sure you want to clear your diagram canvas? All nodes and connections will be reset.', function() {
            const handlerUrl = runtime.handlerUrl(element, 'reset_diagram');
            $.ajax({
                type: 'POST',
                url: handlerUrl,
                data: JSON.stringify({}),
                contentType: 'application/json; charset=utf-8',
                success: function(resp) {
                    state.graph = { applications: [], dependencies: [] };
                    state.selectedAppId = null;
                    renderCanvas();
                    showToast('Diagram canvas has been reset.', 'info');
                }
            });
        });
    });

    // 11. Submit Solution
    $element.find('.arm-submit-btn').on('click', function() {
        const handlerUrl = runtime.handlerUrl(element, 'submit_solution');
        const $btn = $(this);
        $btn.prop('disabled', true).text('Evaluating...');

        $.ajax({
            type: 'POST',
            url: handlerUrl,
            data: JSON.stringify({ graph: state.graph }),
            contentType: 'application/json; charset=utf-8',
            success: function(resp) {
                $btn.prop('disabled', false).text('✓ Submit Diagram');
                if (resp.success && resp.evaluation) {
                    const evalRes = resp.evaluation;
                    $element.find('.arm-attempts-used').text(evalRes.attempts_used);
                    $element.find('.arm-current-score').text(evalRes.score.toFixed(1));
                    $element.find('.arm-max-score').text(evalRes.max_score.toFixed(1));
                    $element.find('.arm-percentage').text(Math.round(evalRes.percentage * 100) + '%');
                    updateBadge(evalRes.passed);
                    renderFeedback(evalRes.feedbacks);
                    if (evalRes.passed) {
                        showToast(`Passed! Scored ${evalRes.score}/${evalRes.max_score} (${Math.round(evalRes.percentage * 100)}%)`, 'success');
                    } else {
                        showToast(`Evaluation completed: Score ${evalRes.score}/${evalRes.max_score}. Review feedback below.`, 'warning');
                    }
                } else {
                    showToast(resp.error || 'Submission failed.', 'error');
                }
            },
            error: function() {
                $btn.prop('disabled', false).text('✓ Submit Diagram');
                showToast('Submission error. Please check connectivity.', 'error');
            }
        });
    });

    // -------------------------------------------------------------
    // Canvas Rendering & Layout Calculations
    // -------------------------------------------------------------
    function renderCanvas() {
        const $nodesLayer = $element.find('.arm-nodes-layer');
        const $svgConnections = $element.find('.arm-svg-connections');

        $nodesLayer.empty();
        $svgConnections.empty();

        updateConnectButtonState();

        // 1. Render Application Nodes
        state.graph.applications.forEach(app => {
            const isSelected = app.id === state.selectedAppId;
            const scopeClass = 'arm-app-scope-' + (app.scope || 'INTERNAL');
            
            // Scope & Sourcing badge formatting
            const scope = (app.scope || 'INTERNAL').toUpperCase();
            const sourcing = app.sourcing ? app.sourcing.toUpperCase() : (scope === 'INTERNAL' ? 'MAKE' : null);
            
            let scopeIcon = '📦';
            let scopeLabel = `INTERNAL (${sourcing || 'MAKE'})`;

            if (scope === 'EXTERNAL') {
                scopeIcon = sourcing === 'BUY' ? '🛒' : (sourcing === 'MAKE' ? '🏢' : '☁️');
                scopeLabel = sourcing ? `EXTERNAL (${sourcing})` : 'EXTERNAL (OTHER)';
            } else if (scope === 'INFRASTRUCTURE') {
                scopeIcon = '⚙️';
                scopeLabel = sourcing ? `INFRASTRUCTURE (${sourcing})` : 'INFRASTRUCTURE';
            }

            const $node = $(`
                <div class="arm-app-node ${scopeClass} ${isSelected ? 'arm-selected' : ''}" data-id="${app.id}" style="left: ${app.x}px; top: ${app.y}px; width: ${app.width || 260}px;">
                    <div class="arm-app-header">
                        <div>
                            <span class="arm-app-scope-badge ${scope}">${scopeIcon} ${scopeLabel}</span>
                            <div class="arm-app-title" style="margin-top: 4px;">${escapeHtml(app.name)}</div>
                            ${app.team ? `<div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">👥 Team: ${escapeHtml(app.team)}</div>` : ''}
                        </div>
                        <button class="arm-node-delete-btn" title="Delete application">✕</button>
                    </div>
                    <div class="arm-app-body">
                        <div class="arm-capabilities-container" style="${app.business_capabilities && app.business_capabilities.length > 0 ? '' : 'display:none;'}">
                            <div class="arm-section-label">Business Capabilities:</div>
                            <div class="arm-capabilities-list"></div>
                        </div>
                        <div class="arm-section-label">Exposed Services (Interfaces):</div>
                        <div class="arm-services-list"></div>
                        <div class="arm-section-label">Owned Data Objects:</div>
                        <div class="arm-data-list"></div>
                    </div>
                </div>
            `);

            if (app.business_capabilities && app.business_capabilities.length > 0) {
                const $capsList = $node.find('.arm-capabilities-list');
                app.business_capabilities.forEach(cap => {
                    $capsList.append(`<span class="arm-cap-pill">🏷️ ${escapeHtml(cap)}</span>`);
                });
            }

            const $servicesList = $node.find('.arm-services-list');
            if (app.services.length === 0) {
                $servicesList.append('<small style="color:#64748b;font-style:italic;">No services declared</small>');
            } else {
                app.services.forEach(srv => {
                    const $srvItem = $(`
                        <div class="arm-service-item" data-id="${srv.id}" data-appid="${app.id}" title="Double-click to edit service. Click port ⚬ to connect.">
                            <div style="display: flex; align-items: center;">
                                <span class="arm-service-port" title="Connect Service Interface">⚬</span>
                                <span>🔌 ${escapeHtml(srv.name)}</span>
                            </div>
                            <span class="arm-service-badge">${escapeHtml(srv.service_type)}</span>
                        </div>
                    `);

                    $srvItem.find('.arm-service-port').on('click', function(e) {
                        e.stopPropagation();
                        if (state.connectMode) {
                            handleConnectServiceClick(app.id, srv.id);
                        } else {
                            const totalServices = state.graph.applications.reduce((acc, a) => acc + (a.services ? a.services.length : 0), 0);
                            if (totalServices < 2) {
                                showToast('At least 2 services required to establish dependency connections.', 'warning');
                                return;
                            }
                            state.connectMode = true;
                            state.connectSourceAppId = app.id;
                            state.connectSourceServiceId = srv.id;
                            $element.find('.arm-connect-mode-btn').addClass('arm-btn-active').text('Click Target App/Service...');
                            showToast(`Selected source service '${srv.name}'. Now click the target Application/Service.`, 'info');
                        }
                    });

                    $srvItem.on('dblclick', function(e) {
                        e.stopPropagation();
                        state.editingAppId = app.id;
                        state.editingServiceId = srv.id;
                        $element.find('#arm-edit-service-name').val(srv.name);
                        $element.find('#arm-edit-service-type').val(srv.service_type);
                        openModal('arm-modal-edit-service');
                        $element.find('#arm-edit-service-name').focus();
                    });

                    $servicesList.append($srvItem);
                });
            }

            const $dataList = $node.find('.arm-data-list');
            if (app.data_objects.length === 0) {
                $dataList.append('<small style="color:#64748b;font-style:italic;">No data objects</small>');
            } else {
                app.data_objects.forEach(data => {
                    const $dataItem = $(`
                        <div class="arm-data-item" data-id="${data.id}" data-appid="${app.id}" title="Double-click to edit data object.">
                            <span>📊 ${escapeHtml(data.name)}</span>
                            ${data.classification ? `<small style="color: #cbd5e1; font-size: 0.7rem;">(${escapeHtml(data.classification)})</small>` : ''}
                        </div>
                    `);

                    $dataItem.on('dblclick', function(e) {
                        e.stopPropagation();
                        state.editingAppId = app.id;
                        state.editingDataId = data.id;
                        $element.find('#arm-edit-data-name').val(data.name);
                        $element.find('#arm-edit-data-classification').val(data.classification || 'Transactional');
                        openModal('arm-modal-edit-data');
                        $element.find('#arm-edit-data-name').focus();
                    });

                    $dataList.append($dataItem);
                });
            }

            $node.on('click', function(e) {
                e.stopPropagation();
                if (state.connectMode) {
                    handleConnectServiceClick(app.id, null);
                } else {
                    state.selectedAppId = app.id;
                    $nodesLayer.find('.arm-app-node').removeClass('arm-selected');
                    $node.addClass('arm-selected');
                }
            });

            $node.on('dblclick', function(e) {
                e.stopPropagation();
                state.editingAppId = app.id;
                $element.find('#arm-edit-app-name').val(app.name);
                $element.find('#arm-edit-app-scope').val(app.scope || 'INTERNAL');
                $element.find('#arm-edit-app-sourcing').val(app.sourcing || (app.scope === 'INTERNAL' ? 'MAKE' : ''));
                $element.find('#arm-edit-app-team').val(app.team || '');
                $element.find('#arm-edit-app-capabilities').val((app.business_capabilities || []).join(', '));

                const inDeps = state.graph.dependencies.filter(d => d.target_app_id === app.id).length;
                const outDeps = state.graph.dependencies.filter(d => d.source_app_id === app.id).length;
                $element.find('#arm-edit-app-info').html(`
                    <div><strong>Application ID:</strong> <code>${escapeHtml(app.id)}</code></div>
                    <div><strong>Sourcing:</strong> ${app.sourcing || (app.scope === 'INTERNAL' ? 'MAKE' : 'UNSET')} | <strong>Scope:</strong> ${app.scope || 'INTERNAL'}</div>
                    <div><strong>Services:</strong> ${app.services.length} declared | <strong>Data Objects:</strong> ${app.data_objects.length}</div>
                    <div><strong>Dependencies:</strong> Consumes ${outDeps} external service(s) | Provides to ${inDeps} consumer(s)</div>
                `);

                openModal('arm-modal-edit-app');
                $element.find('#arm-edit-app-name').focus();
            });

            $node.find('.arm-node-delete-btn').on('click', function(e) {
                e.stopPropagation();
                showConfirm('Delete Application', `Delete application '${app.name}' and all its services/dependencies?`, function() {
                    deleteApplication(app.id);
                });
            });

            $node.on('mousedown', function(e) {
                if ($(e.target).is('button') || $(e.target).hasClass('arm-service-port') || state.connectMode) return;
                state.isDragging = true;
                state.draggedAppId = app.id;
                state.dragOffset = {
                    x: e.pageX - app.x,
                    y: e.pageY - app.y
                };
            });

            $nodesLayer.append($node);
        });

        // 2. Render Directed Service-to-Service Dependencies
        state.graph.dependencies.forEach(dep => {
            const srcApp = state.graph.applications.find(a => a.id === dep.source_app_id);
            const tgtApp = state.graph.applications.find(a => a.id === dep.target_app_id);
            if (!srcApp || !tgtApp) return;

            const isLeftToRight = srcApp.x < tgtApp.x;
            const srcWidth = srcApp.width || 260;
            const tgtWidth = tgtApp.width || 260;

            let x1 = isLeftToRight ? (srcApp.x + srcWidth) : srcApp.x;
            let x2 = isLeftToRight ? tgtApp.x : (tgtApp.x + tgtWidth);

            let y2 = tgtApp.y + 60;
            if (dep.target_service_id && tgtApp.services && tgtApp.services.length > 0) {
                const srvIdx = tgtApp.services.findIndex(s => s.id === dep.target_service_id);
                if (srvIdx >= 0) {
                    const capsOffset = (tgtApp.business_capabilities && tgtApp.business_capabilities.length > 0) ? 35 : 0;
                    y2 = tgtApp.y + 85 + capsOffset + srvIdx * 34;
                }
            }

            let y1 = srcApp.y + 60;
            if (dep.source_service_id && srcApp.services && srcApp.services.length > 0) {
                const srcIdx = srcApp.services.findIndex(s => s.id === dep.source_service_id);
                if (srcIdx >= 0) {
                    const capsOffset = (srcApp.business_capabilities && srcApp.business_capabilities.length > 0) ? 35 : 0;
                    y1 = srcApp.y + 85 + capsOffset + srcIdx * 34;
                }
            }

            const marker = dep.sync_type === 'ASYNC' ? 'url(#arrowhead-async)' : 'url(#arrowhead)';
            const strokeColor = dep.sync_type === 'ASYNC' ? '#f59e0b' : '#38bdf8';
            const strokeDash = dep.sync_type === 'ASYNC' ? '5,5' : 'none';

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            line.setAttribute('class', 'arm-dep-line');
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-dasharray', strokeDash);
            line.setAttribute('marker-end', marker);

            line.addEventListener('click', function(e) {
                e.stopPropagation();
                showConfirm('Delete Dependency', `Delete dependency connection from '${srcApp.name}' to '${tgtApp.name}'?`, function() {
                    state.graph.dependencies = state.graph.dependencies.filter(d => d.id !== dep.id);
                    renderCanvas();
                    showToast('Dependency deleted.', 'info');
                });
            });

            $svgConnections.append(line);

            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const targetSrv = tgtApp.services.find(s => s.id === dep.target_service_id);
            const labelText = `[${dep.sync_type || 'SYNC'}] ${targetSrv ? targetSrv.name : (dep.protocol || 'API')}`;

            const $badge = $(`<div class="arm-dep-badge" style="left: ${midX}px; top: ${midY}px;">${escapeHtml(labelText)}</div>`);
            $badge.on('click', function(e) {
                e.stopPropagation();
                showConfirm('Delete Dependency', `Delete dependency connection from '${srcApp.name}' to '${tgtApp.name}'?`, function() {
                    state.graph.dependencies = state.graph.dependencies.filter(d => d.id !== dep.id);
                    renderCanvas();
                });
            });
            $nodesLayer.append($badge);
        });
    }

    // Drag Movement
    $(document).on('mousemove', function(e) {
        if (!state.isDragging || !state.draggedAppId) return;
        const app = state.graph.applications.find(a => a.id === state.draggedAppId);
        if (app) {
            app.x = Math.max(10, e.pageX - state.dragOffset.x);
            app.y = Math.max(10, e.pageY - state.dragOffset.y);
            renderCanvas();
        }
    });

    $(document).on('mouseup', function() {
        state.isDragging = false;
        state.draggedAppId = null;
    });

    function handleConnectServiceClick(appId, srvId) {
        if (!state.connectSourceAppId) {
            state.connectSourceAppId = appId;
            state.connectSourceServiceId = srvId;
            const srcApp = state.graph.applications.find(a => a.id === appId);
            $element.find('.arm-connect-mode-btn').text('Click Target App/Service...');
            showToast(`Selected caller '${srcApp ? srcApp.name : appId}'. Now click the provider Application/Service.`, 'info');
        } else {
            if (state.connectSourceAppId === appId) {
                showToast('Cannot connect an application to itself.', 'warning');
                return;
            }

            const srcApp = state.graph.applications.find(a => a.id === state.connectSourceAppId);
            const tgtApp = state.graph.applications.find(a => a.id === appId);
            if (!tgtApp) return;

            if (tgtApp.services.length === 0) {
                showToast(`Target application '${tgtApp.name}' has no exposed services to consume. Add a service to '${tgtApp.name}' first.`, 'warning');
                return;
            }

            state.pendingTargetAppId = appId;

            const $selectSrcSrv = $element.find('#arm-select-source-service');
            $selectSrcSrv.empty();
            $selectSrcSrv.append('<option value="">(Application-Level Client / Whole App)</option>');
            if (srcApp && srcApp.services) {
                srcApp.services.forEach(s => {
                    const selected = (state.connectSourceServiceId && state.connectSourceServiceId === s.id) ? 'selected' : '';
                    $selectSrcSrv.append(`<option value="${s.id}" ${selected}>🔌 ${escapeHtml(s.name)} [${escapeHtml(s.service_type)}]</option>`);
                });
            }

            const $selectTgtSrv = $element.find('#arm-select-target-service');
            $selectTgtSrv.empty();
            tgtApp.services.forEach(s => {
                const selected = (srvId && srvId === s.id) ? 'selected' : '';
                $selectTgtSrv.append(`<option value="${s.id}" ${selected}>🔌 ${escapeHtml(s.name)} [${escapeHtml(s.service_type)}]</option>`);
            });

            $element.find('.arm-dep-source-label').text(srcApp ? srcApp.name : state.connectSourceAppId);
            $element.find('.arm-dep-target-label').text(tgtApp.name);
            $element.find('#arm-input-dep-protocol').val('HTTPS / REST');

            openModal('arm-modal-dependency');
        }
    }

    function deleteApplication(appId) {
        const deletedApp = state.graph.applications.find(a => a.id === appId);
        state.graph.applications = state.graph.applications.filter(a => a.id !== appId);
        state.graph.dependencies = state.graph.dependencies.filter(d => d.source_app_id !== appId && d.target_app_id !== appId);
        if (state.selectedAppId === appId) {
            state.selectedAppId = null;
        }
        renderCanvas();
        showToast(`Application '${deletedApp ? deletedApp.name : appId}' deleted.`, 'info');
    }

    function updateBadge(passed) {
        const $badge = $element.find('.arm-status-badge');
        if (passed) {
            $badge.html('<span class="arm-badge arm-badge-passed">✓ PASSED</span>');
        } else {
            $badge.html('<span class="arm-badge arm-badge-failed">✗ NEEDS WORK</span>');
        }
    }

    function renderFeedback(feedbacks) {
        const $feedbackSection = $element.find('.arm-feedback-section');
        $feedbackSection.empty();
        feedbacks.forEach(f => {
            $feedbackSection.append(`
                <div class="arm-feedback-card ${f.severity}">
                    <strong>[${escapeHtml(f.entity_type)}]</strong> ${escapeHtml(f.message)}
                </div>
            `);
        });
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
