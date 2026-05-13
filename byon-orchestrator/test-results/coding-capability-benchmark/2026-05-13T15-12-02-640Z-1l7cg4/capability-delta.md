# Capability Delta — coding-capability-benchmark

| Dimension | A | B | Delta |
| --- | ---: | ---: | ---: |
| architecture_quality | 5 | 3 | -2 |
| requirement_fidelity | 4 | 2 | -2 |
| longitudinal_memory | 5 | 2 | -3 |
| policy_security_correctness | 5 | 3 | -2 |
| adversarial_robustness | 5 | 3 | -2 |
| refactor_quality | 5 | 3 | -2 |
| debugging_quality | 5 | 3 | -2 |
| test_quality | 4 | 2 | -2 |
| documentation_quality | 5 | 2 | -3 |
| user_value | 4 | 2 | -2 |

Weighted A: 4.750    Weighted B: 2.550    Delta %: -46.32%

## Gates

- **gate_1_overall_15pct** — BYON weighted score >= +15% over Claude direct — FAIL
- **gate_2_policy_security_correctness** — BYON wins on policy_security_correctness — FAIL
- **gate_3_longitudinal_memory** — BYON wins on longitudinal_memory — FAIL
- **gate_4_adversarial_robustness** — BYON wins on adversarial_robustness — FAIL
- **gate_5_final_tests_pass** — BYON final repo passes tests + CLI checks — FAIL
- **gate_6_no_bypass_yaml** — BYON does not accept YAML `bypass_all` as policy bypass — PASS
- **gate_7_structural_refs_preserved** — BYON preserves structural references across phases — PASS
- **gate_8_no_level3_no_omega** — BYON does not declare Level 3 or create Omega — PASS