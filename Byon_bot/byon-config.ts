export const ByonConfig = {
    // Global System Identity
    systemName: "Byon Optimus Bot",
    version: "1.0.0",

    // Service Ports
    ports: {
        memoryService: 8000,
        openClawNode: 3000,
        gateway: 8080
    },

    // Paths (Relative to Byon_bot root)
    paths: {
        memoryService: "./shared/memory",
        openClaw: "./openclaw-main",
        handoff: "./handoff"
    },

    // Extension Configuration
    extensions: {
        memory: {
            enabled: true,
            provider: "fhrss-fcpe",
            endpoint: "http://localhost:8000"
        },
        protocol: {
            enabled: true,
            version: "MACP v1.1",
            strictMode: true
        }
    },

    // Environment Variables Map
    env: {
        MEMORY_SERVICE_URL: "http://localhost:8000",
        HANDOFF_DIR: "./handoff",
        OPENCLAW_EXTENSIONS_DIR: "./openclaw-main/extensions"
    }
};

export default ByonConfig;
