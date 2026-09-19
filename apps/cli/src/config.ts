/**
 * The CLI's view of the agent contract.
 *
 * The prompt itself lives with the tools it describes, so other composition
 * roots - the eval runner, later the dashboard - can use the same one without
 * reaching into this app.
 */
export { DEFAULT_TASK, SYSTEM_PROMPT } from "@agent-ops/tools";
