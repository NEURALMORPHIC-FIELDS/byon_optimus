// ---------------------------------------------------------------------------
// TestFailureMemory
// ---------------------------------------------------------------------------
// Captures the EXACT result of every pytest / compileall / CLI run so the
// next coding turn can see the precise failure (command, exit code,
// stdout/stderr excerpts, failing test name, root cause hint).
//
// CodingContextBuilder pulls the most recent failure into the prompt so
// the model is fixing the real error, not a recalled paraphrase of it.
// ---------------------------------------------------------------------------

const STDOUT_LIMIT = 4000;
const STDERR_LIMIT = 2000;

export class TestFailureMemory {
    constructor() {
        this._runs = [];   // append-only
        this._seq = 1;
    }

    /**
     * @param {Object} r
     * @param {string} r.phase
     * @param {string} r.command
     * @param {number} r.exit_code
     * @param {string} [r.stdout]
     * @param {string} [r.stderr]
     * @param {string} [r.label]
     */
    record(r) {
        const stdout = (r.stdout || "").slice(0, STDOUT_LIMIT);
        const stderr = (r.stderr || "").slice(0, STDERR_LIMIT);
        const failing = extractFailingTest(stdout) || extractFailingTest(stderr);
        const file = extractFailingFile(stdout) || extractFailingFile(stderr);
        const root = extractRootCause(stdout) || extractRootCause(stderr);

        const entry = {
            run_id: `TR_${String(this._seq++).padStart(4, "0")}`,
            ts: new Date().toISOString(),
            phase: r.phase ?? "unknown",
            label: r.label ?? null,
            command: r.command,
            exit_code: r.exit_code ?? null,
            stdout_excerpt: stdout,
            stderr_excerpt: stderr,
            failing_test: failing,
            failing_file: file,
            root_cause: root,
            success: r.exit_code === 0,
            fix_attempt: null,
            regression_test_added: false,
        };
        this._runs.push(entry);
        return entry;
    }

    /** Mark a recorded failure as having had a fix attempted. */
    markFixAttempt(run_id, fix_attempt) {
        const r = this._runs.find(x => x.run_id === run_id);
        if (!r) return false;
        r.fix_attempt = String(fix_attempt || "");
        return true;
    }
    markRegressionTestAdded(run_id) {
        const r = this._runs.find(x => x.run_id === run_id);
        if (!r) return false;
        r.regression_test_added = true;
        return true;
    }

    listAll() { return this._runs.slice(); }
    listFailures() { return this._runs.filter(r => !r.success); }
    lastFailure() {
        for (let i = this._runs.length - 1; i >= 0; i--) {
            if (!this._runs[i].success) return this._runs[i];
        }
        return null;
    }
    lastFailureFor(phase) {
        for (let i = this._runs.length - 1; i >= 0; i--) {
            if (!this._runs[i].success && this._runs[i].phase === phase) return this._runs[i];
        }
        return null;
    }
    recent(n = 5) { return this._runs.slice(-n); }

    snapshot() {
        return {
            total: this._runs.length,
            failures: this.listFailures().length,
            runs: this._runs.slice(),
        };
    }
}

// -----------------------------------------------------------------------
// Parsers (best-effort; tolerant of pytest version differences)
// -----------------------------------------------------------------------

function extractFailingTest(text) {
    if (!text) return null;
    // pytest short-test-summary: `FAILED tests/test_x.py::test_y - ...`
    let m = text.match(/^FAILED\s+([^\s]+::[^\s]+)/m);
    if (m) return m[1];
    // pytest verbose: `tests/test_x.py::test_y FAILED`
    m = text.match(/^([\w\/\-.]+::[\w_]+)\s+FAILED/m);
    if (m) return m[1];
    // generic Python error line: `File "x.py", line N, in func`
    m = text.match(/File\s+"([^"]+)",\s+line\s+\d+,\s+in\s+(\w+)/);
    if (m) return `${m[1]}::${m[2]}`;
    return null;
}

function extractFailingFile(text) {
    if (!text) return null;
    // pytest collection error: `ERROR collecting tests/test_x.py`
    let m = text.match(/ERROR collecting\s+([^\s]+)/);
    if (m) return m[1];
    // FAILED line — keep file part only
    m = text.match(/^FAILED\s+([^:\s]+)::/m);
    if (m) return m[1];
    m = text.match(/File\s+"([^"]+)"/);
    if (m) return m[1];
    return null;
}

function extractRootCause(text) {
    if (!text) return null;
    // pytest short summary section bottom-line
    const lines = text.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].trim();
        if (!l) continue;
        if (/^(E\s+)?(AssertionError|TypeError|ValueError|ImportError|ModuleNotFoundError|AttributeError|KeyError|NameError|SyntaxError|IndentationError|RuntimeError)\b/.test(l)) {
            return l;
        }
        if (/^FAILED\b/.test(l) && l.includes("-")) {
            return l;
        }
    }
    return null;
}
