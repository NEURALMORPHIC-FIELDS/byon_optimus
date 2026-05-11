# BYON Optimus - Privacy Policy

**Effective Date:** February 2, 2026
**Last Updated:** February 2, 2026
**Version:** 1.0.0

> **v0.6.4 banner.** This policy was drafted against the v0.1 / v0.2 architecture. The data-handling principles (data minimisation, retention model, user rights, third-party processors) remain valid, but the active memory substrate is now the hybrid **FAISS + FCE-M v0.6.0** stack — not the FHRSS+FCPE backend referenced in some prose below. The "73,000x compression" figure in section 4 / data minimisation is historical (pre-v0.6 backend) and is not an active claim of the current orchestrator. Current architecture: [`RESEARCH_PROGRESS_v0.6.md`](RESEARCH_PROGRESS_v0.6.md).

---

## 1. Introduction

This Privacy Policy explains how BYON Optimus ("we", "our", "the System") collects, uses, stores, and protects information when you use our Multi-Agent Orchestration System with Infinite Memory (FHRSS+FCPE).

BYON Optimus is protected by European Patent EP25216372.0 (Omni-Qube-Vault) and is the proprietary technology of Vasile Lucian Borbeleac.

---

## 2. Data Controller

**Data Controller:** Vasile Lucian Borbeleac
**Patent Number:** EP25216372.0
**Contact:** See LICENSE file for contact information

---

## 3. Information We Collect

### 3.1 Data Categories

| Category | Description | Purpose | Retention |
|----------|-------------|---------|-----------|
| **Code Memories** | Source code snippets and file references | Context for development assistance | User-configurable |
| **Conversation Logs** | User interactions with agents | Service delivery | Session-based or configurable |
| **Fact Memories** | Extracted knowledge and context | Improve assistance accuracy | User-configurable |
| **System Logs** | Service operational data | Debugging and monitoring | 30 days |
| **Execution Receipts** | Records of executed actions | Audit trail | Permanent (immutable) |

### 3.2 How We Collect Data

- **Direct Input:** Messages you send to agents via OpenClaw gateway
- **Automated Processing:** Code analysis and fact extraction from your interactions
- **System Operations:** Logs generated during service operation

### 3.3 Data We Do NOT Collect

- Personal identification documents
- Financial information
- Health records
- Biometric data
- Location tracking data
- Third-party cookies or tracking pixels

---

## 4. How We Use Your Information

### 4.1 Primary Purposes

1. **Service Delivery:** Processing your requests through the multi-agent system
2. **Memory Context:** Building relevant context using FHRSS+FCPE infinite memory
3. **Code Assistance:** Generating and executing code modifications
4. **Audit Trail:** Maintaining immutable execution receipts for accountability

### 4.2 Legal Basis for Processing

| Purpose | Legal Basis (GDPR Art. 6) |
|---------|---------------------------|
| Service Delivery | Contract performance |
| Memory Storage | Legitimate interest |
| System Logs | Legitimate interest |
| Audit Trail | Legal obligation |

---

## 5. Data Storage and Security

### 5.1 Storage Location

- Data is stored locally within your deployment environment
- FHRSS+FCPE provides 73,000x compression for efficient storage
- No data is transmitted to external servers except as configured

### 5.2 Security Measures

**Technical Safeguards:**
- **Air-Gapped Executor:** Code execution occurs in isolated environment with no network access
- **Ed25519 Signing:** All execution orders are cryptographically signed
- **Rate Limiting:** Protection against abuse (100 requests/minute)
- **Path Traversal Prevention:** Protection against unauthorized file access
- **Non-Root Containers:** All services run as unprivileged users

**Organizational Safeguards:**
- Audit logging of all operations
- Role-based access (Worker, Auditor, Executor separation)
- Approval workflows for sensitive operations

### 5.3 Data Recovery

FHRSS technology provides 100% data recovery even with up to 40% data loss, ensuring your memories are protected against corruption.

---

## 6. Data Sharing

### 6.1 Third-Party Processors

| Processor | Purpose | Data Shared |
|-----------|---------|-------------|
| Anthropic API | AI model inference | Conversation context |
| OpenClaw Gateway | External communications | Filtered messages |

### 6.2 When We Share Data

We may share data:
- With your explicit consent
- To comply with legal obligations
- To protect our rights or safety
- With service providers under data processing agreements

### 6.3 We Do NOT

- Sell your personal data
- Share data for advertising purposes
- Transfer data without appropriate safeguards

---

## 7. Your Rights

Under GDPR and applicable data protection laws, you have the following rights:

### 7.1 Right to Access (Article 15)

Request a copy of your personal data:
```
POST /api/gdpr/access
{ "user_id": "<your_identifier>" }
```

### 7.2 Right to Erasure (Article 17)

Request deletion of your data:
```
POST /api/gdpr/delete
{ "user_id": "<your_identifier>" }
```

**Note:** Execution receipts are immutable for audit purposes and cannot be deleted.

### 7.3 Right to Rectification (Article 16)

Request correction of inaccurate data through standard API endpoints.

### 7.4 Right to Data Portability (Article 20)

Export your data in machine-readable format:
```
POST /api/gdpr/export
{ "user_id": "<your_identifier>", "format": "json" }
```

### 7.5 Right to Object (Article 21)

Object to processing based on legitimate interest by contacting the data controller.

### 7.6 Right to Restrict Processing (Article 18)

Request limitation of processing in specific circumstances.

---

## 8. Data Retention

### 8.1 Retention Periods

| Data Type | Default Retention | Basis |
|-----------|-------------------|-------|
| Conversation Logs | Session-based | Configurable |
| Code Memories | Until manually deleted | User preference |
| Fact Memories | Until manually deleted | User preference |
| System Logs | 30 days | Operational necessity |
| Execution Receipts | Permanent | Legal/audit requirement |

### 8.2 Deletion Process

- Data is securely deleted using industry-standard methods
- FHRSS encoding is zeroed to prevent recovery
- Deletion is logged for audit purposes

---

## 9. International Data Transfers

### 9.1 Transfer Mechanisms

If data is transferred outside the EEA:
- Standard Contractual Clauses (SCCs) are used
- Adequacy decisions apply where available
- Additional safeguards implemented as required

### 9.2 Anthropic API

Interactions with Anthropic's Claude API may involve data transfer to the United States. Anthropic maintains appropriate data protection standards.

---

## 10. Children's Privacy

BYON Optimus is not intended for use by individuals under 16 years of age. We do not knowingly collect data from children. If you believe a child has provided us with personal data, please contact us for deletion.

---

## 11. Automated Decision-Making

### 11.1 How It Works

The multi-agent system uses AI to:
- Analyze code and conversations
- Generate execution plans
- Assess risk levels
- Recommend approvals

### 11.2 Human Oversight

- **Approval Workflows:** High-risk operations require user approval
- **Audit Trail:** All decisions are logged and reviewable
- **Override Capability:** Users can reject any automated recommendation

---

## 12. Cookies and Tracking

### 12.1 Web Interface (BYON UI)

If using the web interface:
- **Essential Cookies:** Session management only
- **No Analytics:** No third-party analytics or tracking
- **No Advertising:** No advertising cookies

### 12.2 API Usage

API interactions do not use cookies. Authentication is via API tokens.

---

## 13. Changes to This Policy

We may update this Privacy Policy periodically. Changes will be:
- Posted with a new "Last Updated" date
- Communicated through appropriate channels
- Effective immediately unless otherwise stated

---

## 14. Contact Us

For privacy inquiries, data subject requests, or complaints:

**Data Controller:**
Vasile Lucian Borbeleac
Patent Holder - EP25216372.0

**For Technical Issues:**
See project documentation and support channels.

---

## 15. Supervisory Authority

If you believe your data protection rights have been violated, you have the right to lodge a complaint with a supervisory authority in your country of residence.

---

## 16. Additional Information

### 16.1 Open Source Components

BYON Optimus includes open-source components. See [SBOM.json](SBOM.json) for a complete list of dependencies and their licenses.

### 16.2 Patent Notice

The FHRSS+FCPE technology is protected by European Patent EP25216372.0. Use of this technology is governed by the LICENSE file.

### 16.3 Related Documents

- [LICENSE](LICENSE) - Software license terms
- [GDPR_COMPLIANCE.md](GDPR_COMPLIANCE.md) - Technical GDPR compliance details
- [SBOM.json](SBOM.json) - Software Bill of Materials

---

*This Privacy Policy is part of the BYON Optimus compliance framework.*

**Document Version:** 1.0.0
**Generated:** February 2, 2026
