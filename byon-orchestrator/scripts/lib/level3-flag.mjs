/**
 * Level 3 Full Organism Experiment env-flag helper.
 *
 * Strict-boolean parsing of `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT`.
 * Default OFF. Accepts ONLY the exact strings "true" or "false" (case-
 * sensitive). Any other value — including "yes", "1", "TRUE", "True",
 * "on", or the empty string — is treated as `false` and a warning is
 * logged to stderr the first time the function sees that value.
 *
 * When the flag is OFF (default), the level3 full-organism experiment
 * code path is **completely inert**:
 *   - the runner refuses to start,
 *   - the optional memory-service `/level3/...` endpoints are not
 *     registered,
 *   - the relational-field library can still be imported (no side
 *     effects on import), but it is not invoked by any production code.
 *
 * The single source of truth for the flag's name and shape lives here.
 */

export const LEVEL3_FLAG_NAME = "BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT";

const _warnedValues = new Set();

/**
 * Return true iff `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT === "true"`.
 *
 * Any other value (including unset) returns false. A warning is
 * logged on stderr the first time a non-canonical value is observed
 * for that process.
 */
export function isLevel3FullOrganismExperimentEnabled(env = process.env) {
    const raw = env[LEVEL3_FLAG_NAME];
    if (raw === undefined) return false;
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (!_warnedValues.has(raw)) {
        _warnedValues.add(raw);
        process.stderr.write(
            `[level3-flag] ignoring non-canonical ${LEVEL3_FLAG_NAME}=${JSON.stringify(raw)}; ` +
                `flag must be exactly "true" or "false" (got rejected; default OFF applied)\n`,
        );
    }
    return false;
}

/**
 * Throw with a clear message if the flag is not enabled. Used by the
 * runner's pre-flight to make the failure mode obvious.
 */
export function assertLevel3FullOrganismEnabled(env = process.env) {
    if (!isLevel3FullOrganismExperimentEnabled(env)) {
        throw new Error(
            `${LEVEL3_FLAG_NAME} must be set to "true" to run the ` +
                "level3 full-organism experiment. Default is OFF; no " +
                "production behavior changes when this flag is unset.",
        );
    }
}

/**
 * Reset the internal warning memo. Test-only utility.
 */
export function _resetLevel3FlagWarnings() {
    _warnedValues.clear();
}
