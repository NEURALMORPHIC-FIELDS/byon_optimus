/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON CLI Module
 * ===============
 *
 * Command-line interface for BYON orchestrator.
 *
 * Available Commands:
 *   approve   - Approve or reject pending plan requests
 *   watch     - Watch for new activity in real-time
 *   status    - Display system status
 *   history   - View execution history
 *   inbox     - View and manage inbox messages
 *
 * Patent: FHRSS/OmniVault - Vasile Lucian Borbeleac - EP25216372.0
 */

// Types
export type {
    CliResult,
    CliOptions,
    ApproveOptions,
    WatchOptions,
    StatusOptions,
    HistoryOptions,
    InboxOptions
} from "./types.js";

// Commands
export { approveCommand, autoApproveCommand } from "./approve.js";
export { watchCommand } from "./watch.js";
export { statusCommand } from "./status.js";
export { historyCommand } from "./history.js";
export { inboxCommand } from "./inbox.js";

// ============================================================================
// MAIN CLI ENTRY
// ============================================================================

/**
 * Parse command line arguments and execute command
 */
export async function runCli(args: string[]): Promise<void> {
    const command = args[0];
    const restArgs = args.slice(1);

    // Parse options
    const options = parseOptions(restArgs);
    const positional = restArgs.filter(a => !a.startsWith("--") && !a.startsWith("-"));

    try {
        let result;

        switch (command) {
            case "approve":
                if (options.auto) {
                    const { autoApproveCommand } = await import("./approve.js");
                    result = await autoApproveCommand(options);
                } else {
                    const { approveCommand } = await import("./approve.js");
                    result = await approveCommand(positional[0], options);
                }
                break;

            case "watch":
                const { watchCommand } = await import("./watch.js");
                result = await watchCommand(options);
                break;

            case "status":
                const { statusCommand } = await import("./status.js");
                result = await statusCommand(options);
                break;

            case "history":
                const { historyCommand } = await import("./history.js");
                result = await historyCommand(options);
                break;

            case "inbox":
                const { inboxCommand } = await import("./inbox.js");
                result = await inboxCommand(positional[0], options);
                break;

            case "help":
            case "--help":
            case "-h":
                printHelp();
                return;

            case "version":
            case "--version":
            case "-v":
                console.log("byon-orchestrator v1.0.0");
                return;

            default:
                console.error(`Unknown command: ${command}`);
                console.log("\nRun 'byon help' for usage information.");
                process.exit(1);
        }

        // Handle result
        if (result) {
            if (result.success) {
                if (options.json && result.data) {
                    console.log(JSON.stringify(result.data, null, 2));
                } else if (result.message) {
                    console.log(result.message);
                }
            } else {
                console.error(`Error: ${result.message}`);
                process.exit(1);
            }
        }
    } catch (error) {
        console.error(`Command failed: ${error}`);
        process.exit(1);
    }
}

// ============================================================================
// HELPERS
// ============================================================================

function parseOptions(args: string[]): Record<string, unknown> {
    const options: Record<string, unknown> = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg.startsWith("--")) {
            const key = arg.slice(2).replace(/-/g, "_");

            // Check if next arg is a value
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith("-")) {
                options[key] = parseValue(nextArg);
                i++;
            } else {
                options[key] = true;
            }
        } else if (arg.startsWith("-") && arg.length === 2) {
            const shortFlags: Record<string, string> = {
                "-v": "verbose",
                "-j": "json",
                "-h": "help",
                "-a": "auto"
            };
            const key = shortFlags[arg];
            if (key) {
                options[key] = true;
            }
        }
    }

    return options;
}

function parseValue(value: string): unknown {
    // Try number
    if (/^\d+$/.test(value)) {
        return parseInt(value, 10);
    }

    // Try boolean
    if (value === "true") {return true;}
    if (value === "false") {return false;}

    // String
    return value;
}

function printHelp(): void {
    console.log(`
BYON Orchestrator CLI
=====================

Usage: byon <command> [options]

Commands:
  approve [request_id]    Approve or reject pending plan requests
    --list                List pending requests (default if no ID)
    --reject              Reject the request
    --reason <text>       Reason for decision
    --auto                Auto-approve all low-risk requests

  watch                   Watch for new activity in real-time
    --interval <ms>       Polling interval (default: 2000)
    --filter <type>       Filter: pending, approved, rejected, all

  status                  Display system status
    --memory              Show memory service status
    --agents              Show agent status
    --handoff             Show handoff queue status

  history                 View execution history
    --limit <n>           Limit results (default: 20)
    --since <time>        Time range: 1h, 1d, 1w, 1m
    --status <type>       Filter: approved, rejected, all

  inbox [message_id]      View and manage inbox messages
    --limit <n>           Limit results (default: 20)
    --unread              Show only unread messages

Global Options:
  --json                  Output in JSON format
  --verbose               Verbose output
  --help                  Show help

Examples:
  byon approve                      # List pending requests
  byon approve abc123               # Approve request abc123
  byon approve --reject abc123      # Reject request abc123
  byon approve --auto               # Auto-approve low-risk
  byon watch                        # Watch all activity
  byon status                       # Show system status
  byon history --since 1d           # Show last day's history
  byon inbox                        # List inbox messages
`);
}
