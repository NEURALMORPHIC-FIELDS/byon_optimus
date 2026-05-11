# BYON Optimus — GDPR Compliance Documentation

> **v0.6.4 banner.** This document was authored against the v0.1 / v0.2 architecture (FHRSS+FCPE memory backend). The data-minimisation principles, retention model and lawful-basis analysis remain valid, but the active memory substrate is now hybrid **FAISS + FCE-M v0.6.0**. References to "FCPE 73,000x compression" below are *historical* and apply to the pre-v0.6 backend; storage-footprint and retention guarantees for the current hybrid backend live in [`RESEARCH_PROGRESS_v0.6.md`](RESEARCH_PROGRESS_v0.6.md) and in the memory-service health endpoints.

**Version:** 1.0.0 (compliance text); architecture references superseded by v0.6.4
**Date:** 2026-02-02 (original)
**Data Controller:** Vasile Lucian Borbeleac

---

## 1. Overview

This document outlines the GDPR (General Data Protection Regulation) compliance measures implemented in the BYON Optimus Multi-Agent Orchestration System.

## 2. Data Processing Activities

### 2.1 Categories of Personal Data

The system may process the following categories of data:

| Category | Description | Retention |
|----------|-------------|-----------|
| Code Memories | Source code snippets stored for context | Configurable |
| Conversation Logs | User interactions with agents | Session-based |
| Fact Memories | Extracted knowledge from interactions | Configurable |
| System Logs | Service operational logs | 30 days |

### 2.2 Lawful Basis for Processing

- **Legitimate Interest**: Processing necessary for software development assistance
- **Consent**: User explicitly initiates interactions with the system
- **Contract**: Processing necessary for service delivery

## 3. Data Subject Rights

### 3.1 Right to Access (Article 15)

Users can request access to their data via:
```
POST /api/gdpr/access
{
  "user_id": "<user_identifier>",
  "request_type": "access"
}
```

### 3.2 Right to Erasure (Article 17)

Users can request deletion of their data:
```
POST /api/gdpr/delete
{
  "user_id": "<user_identifier>",
  "request_type": "erasure"
}
```

### 3.3 Right to Rectification (Article 16)

Users can request correction of inaccurate data through the standard API endpoints.

### 3.4 Right to Data Portability (Article 20)

Data export available in JSON format:
```
POST /api/gdpr/export
{
  "user_id": "<user_identifier>",
  "format": "json"
}
```

## 4. Technical Measures

### 4.1 Data Encryption

- **At Rest**: FHRSS+FCPE encoding provides inherent data protection
- **In Transit**: TLS 1.3 required for all external communications
- **Key Management**: Ed25519 signing keys for ExecutionOrders

### 4.2 Access Controls

- Role-based access for Worker, Auditor, and Executor agents
- Air-gapped Executor with no network access
- Ed25519 signature verification for all execution orders

### 4.3 Data Minimization

- FCPE provides 73,000x compression, minimizing storage footprint
- Only essential data retained for service functionality
- Automatic cleanup of expired entries (TTL-based)

### 4.4 Pseudonymization

- Context IDs used instead of direct identifiers
- No direct PII required for core functionality

## 5. Security Measures

### 5.1 Network Security

- CORS restricted to specific origins
- Rate limiting: 100 requests/minute per client
- Resource limits on all containerized services

### 5.2 Application Security

- Input validation on all API endpoints
- ReDoS protection (safe string operations)
- Path traversal prevention
- Forbidden path restrictions (.env, .git, credentials)

### 5.3 Infrastructure Security

- Docker containers with resource limits
- Air-gapped execution environment
- WFP-Semantic-Guard kernel-level network filtering

## 6. Data Breach Procedures

### 6.1 Detection

- Structured logging for anomaly detection
- Health monitoring on all services
- Rate limit violation alerts

### 6.2 Response Timeline

| Phase | Timeline | Action |
|-------|----------|--------|
| Detection | 0-24h | Identify and contain breach |
| Assessment | 24-48h | Evaluate scope and impact |
| Notification | 72h | Notify supervisory authority if required |
| Communication | Post-72h | Notify affected data subjects |

### 6.3 Documentation

All breaches documented with:
- Nature of breach
- Categories of data affected
- Approximate number of records
- Remediation measures taken

## 7. Third-Party Processors

### 7.1 Sub-Processors

| Processor | Purpose | Data Transferred |
|-----------|---------|------------------|
| Anthropic API | AI model inference | Conversation context |
| OpenClaw Gateway | External communications | Filtered messages |

### 7.2 Data Processing Agreements

All third-party processors bound by DPA with:
- Processing instructions
- Security requirements
- Audit rights
- Breach notification obligations

## 8. International Transfers

### 8.1 Transfer Mechanisms

- Standard Contractual Clauses (SCCs) for non-EU transfers
- Adequacy decisions where applicable

### 8.2 Safeguards

- Encryption of data in transit
- Access logging and monitoring
- Regular security assessments

## 9. Privacy by Design

### 9.1 Architecture Decisions

- **Air-gapped Executor**: Critical operations isolated from network
- **Dual Gate Architecture**: WFP-Semantic-Guard ensures only authorized traffic
- **FHRSS Fault Tolerance**: Data integrity even under 40% loss

### 9.2 Default Settings

- Minimal data collection by default
- Logging retention limited to 30 days
- No analytics or tracking without consent

## 10. Data Protection Impact Assessment (DPIA)

### 10.1 Processing Requiring DPIA

- Large-scale code analysis
- Systematic monitoring of user interactions
- Automated decision-making affecting code execution

### 10.2 Risk Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Unauthorized access | High | Low | Multi-layer authentication |
| Data leakage | High | Low | Air-gapped execution |
| Service disruption | Medium | Medium | FHRSS redundancy |

## 11. Contact Information

**Data Protection Inquiries:**
- Patent Holder: Vasile Lucian Borbeleac
- Patent Number: EP25216372.0

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02-02 | Initial GDPR compliance documentation |

---

*This document is part of the BYON Optimus compliance framework and should be reviewed annually or upon significant system changes.*
