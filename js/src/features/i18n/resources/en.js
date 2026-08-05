/**
 * @file English language resources
 * @module i18n/resources/en
 * @description
 *   English resources for the DeepSeek Tampermonkey script i18n module
 *   (key → English copy). Keys are fully aligned with `zh-CN.js`.
 *   Naming convention: `section.subsection.key`
 *   Coverage: settings panel sections & option labels, menu items,
 *   tool names & descriptions, Agent continuation prompts,
 *   tool card status copy, toast messages, error prompts.
 *   This file is pure data, no logic.
 */

const en = {
    // ===== Common buttons & status =====
    common: {
        add: 'Add',
        cancel: 'Cancel',
        clear: 'Clear',
        close: 'Close',
        confirm: 'Confirm',
        delete: 'Delete',
        edit: 'Edit',
        enable: 'Enable',
        enabled: 'Enabled',
        disable: 'Disable',
        disabled: 'Disabled',
        loading: 'Loading…',
        none: 'None',
        open: 'Open',
        preview: 'Preview',
        refresh: 'Refresh',
        remove: 'Remove',
        retry: 'Retry',
        save: 'Save',
        saveChanges: 'Save Changes',
        search: 'Search',
        status: 'Status',
        success: 'Success',
        update: 'Update',
        unnamed: 'Untitled',
        activate: 'Activate this preset',
        deactivate: 'Deactivate',
    },

    // ===== Settings panel =====
    settings: {
        panel: {
            title: 'Script Settings',
            subtitle: 'DeepSeek Promax v5.0',
        },
        // Tabs
        tab: {
            appearance: '🎨 Appearance',
            features: '✨ Features',
            cleanup: '🧹 Cleanup',
            privacy: '🔒 Privacy',
            presets: '💬 Presets',
            scenarios: '📋 Scenarios',
            skills: '⚡ Skills',
            agent: '🤖 Agent',
            export: '📤 Export',
            automation: '👻 Automation',
            extensions: '🚀 Extensions',
        },
        // Section titles
        section: {
            themeColor: 'Theme Color',
            fontCustom: '🔤 Font Customization',
            chatBackground: '🖼️ Chat Background',
            contentRender: 'Content Rendering',
            dialogEnhance: 'Conversation Enhancement',
            efficiencyTools: 'Efficiency Tools',
            interfaceCleanup: 'Interface Cleanup',
            browsePrivacy: 'Browsing Privacy',
            sensitiveReplace: '🔐 Sensitive Word Replacement',
            messagePreset: 'Message Presets',
            scenarioTemplate: 'Scenario Templates',
            skillLibrary: 'Skill Library',
            skillImport: '📥 Import Skills',
            skillSources: '📦 Imported Sources',
            agentSystem: 'Agent System',
            submodule: 'Sub-modules (individually controllable when master switch is on)',
            memoryManage: 'Memory Management',
            dialogExport: 'Conversation Export',
            usageStats: '📊 Usage Statistics',
            loopEngine: 'Loop Engine',
            thinkingPosture: '🧠 Thinking Posture',
            taskMode: '▶ Task Mode',
            personaSystem: '👤 Persona System',
            workflowAutomation: '⛓ Workflow Automation',
            roadmapAutopilot: '🗺 Roadmap Autopilot',
            promptQueue: '📋 Prompt Queue',
            handoffReport: '🤝 Handoff Report',
            agentEnhance: '🌐 Agent Capability Enhancement',
            workbenchUx: 'Workbench & UX',
            dataAutomation: 'Data & Automation',
            advancedCapability: 'Advanced Capability',
        },
        // Footer buttons
        footer: {
            save: '💾 Save & Apply',
            reset: '↺ Reset to Defaults',
        },
        // Toggle labels & help descriptions (id maps to OPTION_CONFIG_KEYS)
        toggle: {
            sakura: {
                label: '🌸 Sakura Falling',
                desc: 'Falling sakura animation on the page for a romantic atmosphere',
            },
            narrow: {
                label: '📐 Narrow Margins',
                desc: 'Compress left/right padding of chat content for a denser, more compact layout',
            },
            image: {
                label: '🖼️ Image Rendering',
                desc: 'Automatically render Markdown image links and plain image URLs as clickable previews',
            },
            strikethrough: {
                label: '✏️ Strikethrough Rendering',
                desc: 'Convert ~~text~~ to strikethrough style (not effective inside code blocks)',
            },
            mermaid: {
                label: '📊 Mermaid Charts',
                desc: 'Render Mermaid code blocks as charts (flowcharts, sequence diagrams, Gantt charts, etc.)',
            },
            citation: {
                label: '🗑️ Remove Citations',
                desc: 'Remove [citation:number] markers and source citation icons from replies',
            },
            copyCode: {
                label: '📋 Click Inline Code to Copy',
                desc: 'Click Markdown inline code to copy it to the clipboard for quick reference',
            },
            antiRecall: {
                label: '🛡️ Anti-Recall',
                desc: 'Intercept and cache recalled replies to prevent accidental loss of conversation content',
            },
            autoRetry: {
                label: '🔄 Auto Retry',
                desc: 'Automatically click the retry button when it appears, up to 10 retries, avoiding manual operation',
            },
            folderPanel: {
                label: '📁 Folder Management',
                desc: 'Embed a folder management panel in the DeepSeek sidebar, supporting two-level hierarchy and conversation favorites',
            },
            defaultMode: {
                label: '⚡ Default Mode',
                desc: 'Automatically switch to the specified mode (Quick/Expert/Vision) when a new conversation starts',
            },
            promptInject: {
                label: '🤖 System Prompt Injection',
                desc: 'Automatically inject a system prompt when sending each message (DeepSeek will not display it but will follow it)',
            },
            inlineExport: {
                label: '📤 Inline Message Export',
                desc: 'Add an export button next to each AI reply to export that message alone as a Markdown file',
            },
            historyTags: {
                label: '🏷️ History Tag Search',
                desc: 'Inject a tag filter into the history search popup; tag conversations and filter by tags',
            },
            contextMenu: {
                label: '🖱️ Context Menu Templates',
                desc: 'Pop up a menu after selecting text, supporting one-click summarize/explain/translate and custom scenario templates',
            },
            tokenSpeed: {
                label: '⚡ Token Speed Indicator',
                desc: 'Show real-time token count and output speed (tok/s) next to each AI reply, requires request interception',
            },
            removeForward: {
                label: '✂️ Remove Forward Button',
                desc: 'Remove the forward/share buttons on messages to keep the interface clean',
            },
            removeDownloadApp: {
                label: '📱 Remove Download Entry',
                desc: 'Remove the download app entry from the page and the download option in the dropdown menu',
            },
            placeholderText: {
                label: '💬 Modify Placeholder Text',
                desc: 'Modify the input box placeholder text content (text only, not color)',
            },
            title: {
                label: '🎭 Title Disguise',
                desc: 'Randomly change the browser tab title to prevent others from peeking at browsing content via the title',
            },
            redirect: {
                label: '↗️ Auto Redirect',
                desc: 'Only redirect to chat.deepseek.com when visiting www.deepseek.com or deepseek.com',
            },
            privacyShield: {
                label: '🛡️ Enable Sensitive Word Replacement',
                desc: 'Replace sensitive words inside message containers on the page with specified text to protect privacy',
            },
            caseSensitive: {
                label: '🔍 Case Sensitive',
                desc: 'Whether sensitive word replacement is case-sensitive (off means case-insensitive matching)',
            },
            usageStats: {
                label: '📊 Enable Usage Statistics',
                desc: 'Record token count, speed and duration of each conversation turn, generating a 30-day activity heatmap',
            },
            loopEngine: {
                label: '👻 Enable Loop Engine',
                desc: 'Enable the loop engine: automatically continue the conversation when an AI reply ends with a signal marker, enabling unattended looping',
            },
            loopNotify: {
                label: '🔔 Desktop Notifications',
                desc: 'Send a browser desktop notification each time the loop engine executes, for real-time progress tracking',
            },
            loopCrashRecovery: {
                label: '🔄 Crash Recovery',
                desc: 'Automatically resume execution after the loop engine crashes; auto-pause after 3 minutes of inactivity',
            },
            loopDrift: {
                label: '🛡️ Drift Protection (Round Limit)',
                desc: 'Drift protection: soft-pause when the round limit is reached, with options to extend or re-anchor to the original task',
            },
            loopUnattended: {
                label: '🤖 Unattended Mode',
                desc: 'Unattended mode: allow background tabs to run, using Web Worker to prevent throttling',
            },
            personaPerTask: {
                label: '🔁 Per-Step Persona Injection',
                desc: 'Per-step persona injection: attach persona instructions to each loop command (not just the first round)',
            },
            workflowAutoAdvance: {
                label: '⚡ Auto-Advance Next Stage',
                desc: 'Workflow auto-advance: automatically send the next stage instruction after AI completes a stage',
            },
            workflowPauseBetween: {
                label: '⏸ Pause Between Steps (wait after each stage)',
                desc: 'Pause between steps: pause after each workflow stage completes, waiting for the user to manually continue',
            },
            agentSystem: {
                label: '🤖 Enable Agent System (Master Switch)',
                desc: '🤖 Agent system master switch: one-click enable of full Agent capabilities (memory + tool calls + loop). When enabled, AI can proactively call tools to save/recall/review memory, and auto-send continuation messages to form an Agent loop. Note: after enabling, DeepSeek will show auto-sent messages (tool result relay); do not manually interfere with the input box',
            },
            agentMemory: {
                label: '🧠 Memory Module (auto-inject + manage)',
                desc: '🧠 Memory module: automatically inject relevant memories into the prompt so the AI remembers your preferences and conversation history. Provides a memory management panel (CRUD, archive, import/export)',
            },
            agentTools: {
                label: '🔧 Tool Call Module ([capability] prompt + XML execution)',
                desc: '🔧 Tool call module: inject [capability] prompts teaching the AI to proactively call tools (memory_save/memory_recall/agent_finish XML tags), automatically recognizing and executing AI-output tool calls',
            },
            agentLoop: {
                label: '🔄 Agent Loop Module (tool result relay + continuation)',
                desc: '🔄 Agent loop module: after a tool call executes, wrap the result in <tool_results> XML and send it as a new message to the AI, letting it see the tool result and continue the conversation (Agent loop, up to 3 rounds). Depends on the tool call module',
            },
            webTools: {
                label: '🌐 Web Tools Master Switch',
                desc: '🌐 Web tools master switch: when enabled, the AI can use web_search for online search and web_fetch to fetch webpage content',
            },
            webSearch: {
                label: '🔍 web_search',
                desc: '🔍 web_search tool: fetch DuckDuckGo/Bing search results via cross-origin requests, returning structured title/URL/snippet',
            },
            webFetch: {
                label: '📄 web_fetch',
                desc: '📄 web_fetch tool: fetch the visible body text of a target URL, authorized by site whitelist and truncated to a specified length',
            },
            mcp: {
                label: '🔌 MCP Protocol Client',
                desc: '🔌 MCP protocol client: connect to external MCP servers to extend AI tool capabilities (configure servers in the management panel)',
            },
            project: {
                label: '📁 Project Workbench',
                desc: '📁 Project workbench: manage multiple projects, isolate conversations/memory/config, support quick switching and project-level context injection',
            },
            pet: {
                label: '🐳 Desktop Pet',
                desc: '🐳 Desktop pet: display a whale pet in the page corner that switches mood and lines based on conversation state, accompanying your conversation',
            },
            artifactsExport: {
                label: '📤 Artifacts Export',
                desc: '📤 Artifacts export: export AI-generated code/documents as HTML/Markdown/PDF artifact files',
            },
            memoryImport: {
                label: '📥 Memory Import',
                desc: '📥 Memory import: batch import memories from external files (JSON/Markdown) into the memory system',
            },
            sync: {
                label: '🔄 Data Sync (WebDAV)',
                desc: '🔄 Data sync: sync config/memory/project data to the cloud via WebDAV, supporting multi-device data consistency',
            },
            automationModule: {
                label: '⏰ Automation Scheduling',
                desc: '⏰ Automation scheduling: execute preset tasks on schedule, supporting cron expression scheduling and conditional triggers',
            },
            multimodal: {
                label: '🎨 Multimodal Analysis',
                desc: '🎨 Multimodal analysis: analyze image/audio/video content, extending AI understanding of non-text modalities',
            },
            pythonSandbox: {
                label: '🐍 Python Sandbox',
                desc: '🐍 Python sandbox: execute Python code in the browser via Pyodide, available for AI to call to complete computational tasks',
            },
            magicWand: {
                label: '🪄 Page Collapse Control',
                desc: '🪄 Page collapse control: inject a control panel at the bottom of the sidebar for quick toggling of sidebar width, user font size, deep think folding, input box expansion, and code block folding',
            },
            timeInject: {
                label: '🕐 Time Injection',
                desc: '🕐 Time injection: inject the current date and time (down to the second) into each conversation, making the AI aware of the current time',
            },
            codeFold: {
                label: '📦 Code Block Folding',
                desc: '📦 Code block folding: auto-fold code blocks exceeding the threshold, with preview lines and fold/expand toggle',
            },
            tableExport: {
                label: '📊 Table Optimization & Export',
                desc: '📊 Table optimization: hover tables to show PNG/CSV export buttons, with theme adaptation and column width strategies',
            },
            thinkFold: {
                label: '🧠 Auto-Collapse Thinking',
                desc: '🧠 Auto-collapse thinking: automatically collapse the "Thinking" section when AI starts reasoning, reducing page scrolling',
            },
            script: {
                label: '🟢 Script Master Switch',
                desc: '🟢 Script master switch: when off, only the settings panel entry is retained; all feature enhancements (sakura/font/background/Agent etc.) are disabled. Useful for temporarily disabling the script to troubleshoot issues',
            },
            fontCustom: {
                label: '🔤 Enable Font Customization',
                desc: '🔤 Enable font customization: replace DeepSeek default font with a system font or online font (.woff2/.ttf/Google Fonts CSS)',
            },
            bgImage: {
                label: '🖼️ Enable Chat Background',
                desc: '🖼️ Enable chat background: set a custom background image for the chat area (supports image URL or local upload), with adjustable opacity',
            },
            scenarios: {
                label: '📋 Enable Scenario Templates (Master Switch)',
                desc: '📋 Scenario templates master switch: when off, the scenario list is not loaded and the right-click menu does not show scenario items (only the custom scenario input area is retained)',
            },
            skill: {
                label: '⚡ Enable Skill System (Master Switch)',
                desc: '⚡ Skill system master switch: when off, /commands do not trigger skills, and slash commands in the input box are treated as plain text',
            },
            skillSidebar: {
                label: '📋 Skill Sidebar',
                desc: 'When typing / in the input box, show the skill list next to the preset menu for quick skill selection',
            },
            presets: {
                label: '💬 Enable Preset System (Master Switch)',
                desc: '💬 Preset system master switch: when off, no activated preset content (role/scenario prompts) is injected; the preset list can still be managed but will not take effect',
            },
        },
        // Input field labels & placeholders
        field: {
            systemFont: 'System Font',
            onlineFont: 'Online Font',
            systemFontPlaceholder: "e.g. Arial, 'Microsoft YaHei'",
            onlineFontPlaceholder: '.woff2 / .ttf or Google Fonts CSS',
            imageUrl: 'Image URL',
            imageUrlPlaceholder: 'Enter image link or choose a file',
            opacity: 'Opacity',
            targetMode: 'Target Mode',
            promptContent: 'Prompt Content',
            promptContentPlaceholder: 'Enter the system prompt to be auto-injected on each conversation…',
            placeholderText: 'Placeholder Text',
            placeholderTextPlaceholder: 'e.g. Say something…',
            titleList: 'Title List',
            titleListPlaceholder: 'One title per line',
            sensitiveWord: 'Sensitive Word',
            sensitiveReplacement: 'Replace With',
            presetName: 'Name (e.g. catgirl)',
            presetPrompt: 'Prompt (e.g. you are a catgirl)',
            scenarioLabel: 'Scenario name (e.g. abbreviate)',
            scenarioTemplate: 'Template (use {text} for selected text)',
            skillName: 'Skill name (kebab-case, e.g. my-skill)',
            skillDescription: 'Short description',
            maxRounds: 'Max Rounds',
            postureSelect: 'Posture',
            modeSelect: 'Mode',
            taskDesc: 'Task Description',
            taskDescPlaceholder: 'Enter the task to loop on…',
            personaSelect: 'Select Persona',
            workflowSelect: 'Select Workflow',
            roadmapTaskPlaceholder: 'Enter a task; AI will first generate a roadmap then execute step by step…',
            queueList: 'Task List',
            queuePlaceholder: 'One task per line, the script will execute them in order…',
            projectName: 'Project Name',
            projectNamePlaceholder: 'For handoff report metadata',
        },
        // Dropdown options
        option: {
            themeDefault: 'Default',
            modeQuick: 'Quick Mode (no switch)',
            modeExpert: 'Expert Mode',
            modeVision: 'Vision Mode',
            postureStandard: '🔒 Locked — strictly follow the plan',
            postureEvolving: '🌱 Adaptive — can expand mid-way',
            postureExtended: '🔍 Audit — plan + final gap audit',
            payloadLoop: '▶ Loop — step-by-step execution',
            payloadThink: '🧠 Think First — AI plans batches itself',
            payloadRoadmap: '🗺 Roadmap — AI research → roadmap → auto-execute',
            personaNone: 'None',
            personaResearcher: 'Researcher',
            personaBuilder: 'Builder',
            personaRedteam: 'Red Team',
            personaDevil: "Devil's Advocate",
            personaTester: 'Test Engineer',
            personaCustomer: 'Customer Voice',
            personaExecutive: 'Executive',
            personaRoundtable: 'Roundtable',
            workflowNone: 'Manual (no auto stage injection)',
            workflowDeepResearch: 'Deep Research — research → branch → red team → synthesize',
            workflowRdLab: 'R&D Lab — invent → prototype → evaluate → converge',
            workflowShipyard: 'Shipyard — concept → execution plan → QA → production-ready',
            workflowDebate: 'Debate — multi-perspective challenge and synthesis',
            workflowPreMortem: 'Pre-Mortem — assume failure → investigate → harden',
            workflowTrollproof: 'Trollproof — hostile feedback → filter → harden',
            workflowLensRelay: 'Lens Relay — multi-perspective independent evaluation → synthesize',
        },
        // Action buttons
        button: {
            exportJson: '📥 Export JSON',
            exportMd: '📝 Export MD',
            exportImg: '📸 Screenshot PNG',
            loopStart: '▶ Start Loop',
            loopPause: '⏸ Pause',
            loopStop: '⏹ Stop',
            loopReset: '↺ Reset',
            roadmap: '🗺 Roadmap',
            thinkFirst: '🧠 Think First',
            queueStart: '📋 Start Queue',
            handoff: '🤝 Generate Handoff',
            handoffBackup: '📥 Backup Handoff',
        },
        // Info cards
        info: {
            presetHint: 'After activating a preset, its content is injected as a prefix to each message. Click ◉ to toggle activation.',
            scenarioHint: 'Select text and right-click to apply a scenario template. Built-in scenarios cannot be deleted but can be disabled or edited.',
            skillHint: 'Type <code>/skill-name args</code> in the input box to trigger a skill. Built-in skills are always enabled; custom skills can be disabled.',
            skillEditHint: 'After adding, edit the skill instructions (body) using <code>{args}</code> as the argument placeholder.',
            exportHint: 'Click the buttons below to export the current conversation. Data source priority: API interception → direct request → DOM extraction. Screenshot export requires loading html2canvas online.',
            loopProtocol: '<b>Signal protocol:</b> If an AI reply ends with <code>[[GITL::PROCEED]]</code> it auto-continues; if it ends with <code>[[GITL::HALT]]</code> it stops.',
            loopAntiDetect: '<b>Anti-detection:</b> 8-15 second random delay.',
            loopWatchdog: '<b>Watchdog:</b> auto-pause after 3 minutes of inactivity.',
            personaMulti: '<b>Multi-select:</b> hold Ctrl/Cmd to select a committee combination.',
            personaRoundtable: '<b>Roundtable:</b> AI simulates 5 perspectives for independent evaluation, then synthesizes.',
            personaPerTask: '<b>Per-step injection:</b> when enabled, each loop command carries persona instructions.',
            postureStandardDesc: 'Locked to the declared plan; adding, deleting, merging or reordering steps is not allowed. Most predictable.',
            postureEvolvingDesc: 'The plan can expand during execution — when a real obstacle or gap appears, the AI may add steps and explain the reason.',
            postureExtendedDesc: 'Lock the execution plan, then run a coverage audit after completion, filling only material gaps.',
        },
        // Agent warning card
        agentWarn: {
            title: '⚠️ Important: about auto-messages from tool calls',
            body: 'After enabling the Agent system, DeepSeek will <b>automatically send a continuation message</b> after calling a tool (save/recall/merge/review memory), relaying the tool result back to the AI so it can continue based on the result (the Agent loop).',
            normalBehavior: 'This is <b>normal behavior</b>, not a bug:',
            bullet1: 'The input box will be auto-locked and filled with continuation content, <b>do not manually type or click send</b>',
            bullet2: 'A "Stop Agent" button appears in the bottom-right; click it to interrupt',
            bullet3: 'A single user message triggers at most 3 continuation rounds; it auto-stops when the limit is reached',
            bullet4: 'Switching conversations or refreshing the page immediately terminates the continuation',
            bullet5: 'The loop ends normally when the AI calls the <code>agent_finish</code> tool',
            closeLoopHint: 'To avoid auto-messages, disable the "Agent Loop" sub-module and use only the tool-call capability.',
        },
    },

    // ===== Menu items =====
    menu: {
        scriptSettings: 'Script Settings',
        scriptSettingsWithIcon: '⚙️ Script Settings',
    },

    // ===== Tool names & descriptions (maps to capability-register.js TOOL_LABELS) =====
    tools: {
        memory_save: { name: 'Save Memory', desc: 'Save a new long-term memory' },
        memory_update: { name: 'Update Memory', desc: 'Update an existing memory' },
        memory_delete: { name: 'Delete Memory', desc: 'Delete a specified memory' },
        memory_import_preview: { name: 'Preview Import Memory', desc: 'Preview imported memories (not actually saved)' },
        memory_recall: { name: 'Recall Memory', desc: 'Report which existing memories were referenced' },
        memory_merge: { name: 'Merge Memory', desc: 'Merge multiple related memories into one' },
        memory_review: { name: 'Review Memory', desc: 'Review and organize the memory store' },
        memory_search: { name: 'Search Memory', desc: 'Actively search the memory store' },
        memory_list: { name: 'List Memory', desc: 'List memories in the store' },
        memory_pin: { name: 'Pin Memory', desc: 'Toggle the pinned state of a memory' },
        memory_stats: { name: 'Memory Stats', desc: 'Return a memory store statistics overview' },
        memory_export: { name: 'Export Memory', desc: 'Export the memory store as JSON' },
        memory_archive: { name: 'Archive Memory', desc: 'Archive stale memories' },
        memory_get: { name: 'Get Memory', desc: 'Read a single memory by ID' },
        memory_clear: { name: 'Clear Memory', desc: 'Batch-clear memories in a scope' },
        memory_replace: { name: 'Replace Memory', desc: 'Overwrite a memory and keep history' },
        todo_write: { name: 'Write Todo List', desc: 'Fully replace the current todo list' },
        todo_read: { name: 'Read Todo List', desc: 'View the current todo list state' },
        todo_clear: { name: 'Clear Todo List', desc: 'Clear all todos' },
        ask_user: { name: 'Ask User', desc: 'Ask the user and pause the Agent loop' },
        start_agent: { name: 'Start Agent', desc: 'Explicitly start the Agent loop' },
        agent_finish: { name: 'Finish Agent', desc: 'Explicitly end the Agent loop' },
    },

    // ===== Agent continuation prompts (from capability-register.js tool results) =====
    agent: {
        started: 'Agent started',
        finished: 'Agent finished',
        startDetail: 'AI proactively started the Agent loop',
        finishDetail: 'AI declared the task complete. The Agent loop has been terminated; the user may continue typing.',
        taskPrefix: 'Task',
        reasonPrefix: 'Reason',
        waitUser: 'Waiting for user answer',
        shownQuestions: 'Shown {count} question(s) to the user, waiting for an answer',
        loopTerminated: 'The Agent loop has been terminated; the user may continue typing.',
    },

    // ===== Tool card status copy (from text-process.js) =====
    toolCard: {
        title: 'Tool Call',
        count: '{count} time(s)',
        todoTitle: 'Todo List',
        recallInfo: 'Recalled {count} item(s): {ids}{more}',
        recallMore: ' and {count} more',
        mergeInfo: 'Merged {count} item(s) → {name}',
        reviewFocus: 'Review focus: {focus}',
        reviewDefault: 'Full review',
    },

    // ===== Toast messages =====
    toast: {
        saved: 'Saved',
        deleted: 'Deleted',
        updated: 'Updated',
        copied: 'Copied to clipboard',
        exported: 'Export succeeded',
        imported: 'Import succeeded',
        settingsSaved: '✅ Settings saved, refreshing page…',
        resetDone: '✅ Reset to defaults, refreshing page…',
        preparing: '⏳ Preparing…',
        namePromptRequired: 'Name and prompt cannot be empty',
        emptyPreset: 'No presets yet, add one',
        noSensitiveWords: 'No sensitive words',
        manualPause: 'Manual pause',
    },

    // ===== Error prompts (from capability-register.js tool failure results) =====
    error: {
        invalidToolCall: 'Invalid tool call',
        emptyToolOrPayload: 'Tool name or payload is empty',
        toolExecFailed: 'Tool execution failed',
        unknownTool: 'Unknown tool: {name}',
        memoryFormat: 'Memory format error',
        saveFailed: 'Save failed',
        updateFailed: 'Update failed',
        deleteFailed: 'Delete failed',
        mergeFailed: 'Merge failed',
        previewFailed: 'Preview failed',
        exportFailed: 'Export failed',
        replaceFailed: 'Replace failed',
        clearFailed: 'Clear failed',
        pinFailed: 'Pin failed',
        paramError: 'Parameter error',
        notFound: 'Memory not found',
        needConfirm: 'Confirmation required',
        todoNotInit: 'Todo module not initialized',
        execFailed: 'Execution failed',
    },
};

export default en;
