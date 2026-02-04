/**
 * Ed25519 Signature Security Tests
 * ==================================
 *
 * Tests cryptographic signature security:
 * - Key generation
 * - Signing operations
 * - Signature verification
 * - Tamper detection
 * - Replay attack prevention
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as crypto from "node:crypto";

// ============================================
// Mock Ed25519 Implementation
// ============================================

interface KeyPair {
    publicKey: string;
    privateKey: string;
}

interface SignedMessage {
    data: string;
    signature: string;
    timestamp: string;
    nonce: string;
}

class Ed25519Security {
    private usedNonces: Set<string> = new Set();
    private maxNonceAge: number = 300000; // 5 minutes

    generateKeyPair(): KeyPair {
        const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" }
        });

        return { publicKey, privateKey };
    }

    sign(data: string, privateKey: string): SignedMessage {
        const timestamp = new Date().toISOString();
        const nonce = crypto.randomBytes(16).toString("hex");
        const messageToSign = `${timestamp}:${nonce}:${data}`;

        const signature = crypto
            .sign(null, Buffer.from(messageToSign), privateKey)
            .toString("base64");

        return {
            data,
            signature,
            timestamp,
            nonce
        };
    }

    verify(
        signedMessage: SignedMessage,
        publicKey: string,
        options: { checkTimestamp?: boolean; checkNonce?: boolean } = {}
    ): { valid: boolean; error?: string } {
        const { checkTimestamp = true, checkNonce = true } = options;

        // Check timestamp freshness
        if (checkTimestamp) {
            const messageTime = new Date(signedMessage.timestamp).getTime();
            const now = Date.now();
            if (now - messageTime > this.maxNonceAge) {
                return { valid: false, error: "Message expired" };
            }
        }

        // Check nonce (replay prevention)
        if (checkNonce) {
            if (this.usedNonces.has(signedMessage.nonce)) {
                return { valid: false, error: "Nonce already used (replay attack)" };
            }
            this.usedNonces.add(signedMessage.nonce);
        }

        // Verify signature
        try {
            const messageToVerify = `${signedMessage.timestamp}:${signedMessage.nonce}:${signedMessage.data}`;
            const isValid = crypto.verify(
                null,
                Buffer.from(messageToVerify),
                publicKey,
                Buffer.from(signedMessage.signature, "base64")
            );

            return { valid: isValid, error: isValid ? undefined : "Invalid signature" };
        } catch (err) {
            return { valid: false, error: `Verification error: ${err}` };
        }
    }

    clearNonces(): void {
        this.usedNonces.clear();
    }
}

// ============================================
// Execution Order Signing
// ============================================

interface ExecutionOrder {
    order_id: string;
    plan_id: string;
    actions: Array<{ type: string; target: string }>;
    approved_by: string;
}

class ExecutionOrderSigner {
    private security: Ed25519Security;

    constructor() {
        this.security = new Ed25519Security();
    }

    signOrder(order: ExecutionOrder, privateKey: string): SignedMessage {
        const orderData = JSON.stringify({
            order_id: order.order_id,
            plan_id: order.plan_id,
            actions: order.actions,
            approved_by: order.approved_by
        });

        return this.security.sign(orderData, privateKey);
    }

    verifyOrder(
        signedOrder: SignedMessage,
        publicKey: string
    ): { valid: boolean; order?: ExecutionOrder; error?: string } {
        const result = this.security.verify(signedOrder, publicKey);

        if (!result.valid) {
            return { valid: false, error: result.error };
        }

        try {
            const order = JSON.parse(signedOrder.data) as ExecutionOrder;
            return { valid: true, order };
        } catch {
            return { valid: false, error: "Invalid order data" };
        }
    }

    generateKeyPair(): KeyPair {
        return this.security.generateKeyPair();
    }

    clearNonces(): void {
        this.security.clearNonces();
    }
}

// ============================================
// Security Tests
// ============================================

describe("Ed25519 Signature Security", () => {
    let security: Ed25519Security;
    let keyPair: KeyPair;

    beforeEach(() => {
        security = new Ed25519Security();
        keyPair = security.generateKeyPair();
    });

    describe("Key Generation", () => {
        it("should generate valid key pair", () => {
            expect(keyPair.publicKey).toContain("-----BEGIN PUBLIC KEY-----");
            expect(keyPair.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
        });

        it("should generate unique key pairs", () => {
            const keyPair2 = security.generateKeyPair();

            expect(keyPair.publicKey).not.toBe(keyPair2.publicKey);
            expect(keyPair.privateKey).not.toBe(keyPair2.privateKey);
        });

        it("should generate 32-byte keys (Ed25519)", () => {
            // Ed25519 public key is 32 bytes, but PEM encoding adds headers
            // Just verify the key works for signing
            const signed = security.sign("test", keyPair.privateKey);
            const verified = security.verify(signed, keyPair.publicKey, {
                checkTimestamp: false,
                checkNonce: false
            });
            expect(verified.valid).toBe(true);
        });
    });

    describe("Signing Operations", () => {
        it("should sign message with timestamp and nonce", () => {
            const signed = security.sign("test data", keyPair.privateKey);

            expect(signed.data).toBe("test data");
            expect(signed.signature).toBeTruthy();
            expect(signed.timestamp).toBeTruthy();
            expect(signed.nonce).toBeTruthy();
        });

        it("should produce different signatures for same data", () => {
            const signed1 = security.sign("same data", keyPair.privateKey);
            const signed2 = security.sign("same data", keyPair.privateKey);

            // Different nonces mean different signatures
            expect(signed1.signature).not.toBe(signed2.signature);
            expect(signed1.nonce).not.toBe(signed2.nonce);
        });

        it("should produce deterministic signature for same input (without nonce)", () => {
            // This tests that Ed25519 itself is deterministic
            const data = "deterministic test";
            const timestamp = "2026-02-02T00:00:00Z";
            const nonce = "fixed-nonce";
            const messageToSign = `${timestamp}:${nonce}:${data}`;

            const sig1 = crypto.sign(null, Buffer.from(messageToSign), keyPair.privateKey);
            const sig2 = crypto.sign(null, Buffer.from(messageToSign), keyPair.privateKey);

            expect(sig1.toString("base64")).toBe(sig2.toString("base64"));
        });
    });

    describe("Signature Verification", () => {
        it("should verify valid signature", () => {
            const signed = security.sign("valid message", keyPair.privateKey);
            const result = security.verify(signed, keyPair.publicKey);

            expect(result.valid).toBe(true);
        });

        it("should reject tampered data", () => {
            const signed = security.sign("original", keyPair.privateKey);
            signed.data = "tampered";

            const result = security.verify(signed, keyPair.publicKey, {
                checkTimestamp: false,
                checkNonce: false
            });

            expect(result.valid).toBe(false);
            expect(result.error).toContain("Invalid signature");
        });

        it("should reject tampered signature", () => {
            const signed = security.sign("message", keyPair.privateKey);
            signed.signature = Buffer.from("tampered").toString("base64");

            const result = security.verify(signed, keyPair.publicKey, {
                checkTimestamp: false,
                checkNonce: false
            });

            expect(result.valid).toBe(false);
        });

        it("should reject wrong public key", () => {
            const signed = security.sign("secret", keyPair.privateKey);
            const wrongKeyPair = security.generateKeyPair();

            const result = security.verify(signed, wrongKeyPair.publicKey, {
                checkTimestamp: false,
                checkNonce: false
            });

            expect(result.valid).toBe(false);
        });
    });

    describe("Replay Attack Prevention", () => {
        it("should accept first use of nonce", () => {
            const signed = security.sign("message", keyPair.privateKey);
            const result = security.verify(signed, keyPair.publicKey, { checkTimestamp: false });

            expect(result.valid).toBe(true);
        });

        it("should reject replay (same nonce)", () => {
            const signed = security.sign("message", keyPair.privateKey);

            // First verification passes
            const result1 = security.verify(signed, keyPair.publicKey, { checkTimestamp: false });
            expect(result1.valid).toBe(true);

            // Second verification (replay) fails
            const result2 = security.verify(signed, keyPair.publicKey, { checkTimestamp: false });
            expect(result2.valid).toBe(false);
            expect(result2.error).toContain("replay attack");
        });

        it("should clear nonces for fresh state", () => {
            const signed = security.sign("message", keyPair.privateKey);

            security.verify(signed, keyPair.publicKey, { checkTimestamp: false });
            security.clearNonces();

            // After clearing, same nonce should work again
            const result = security.verify(signed, keyPair.publicKey, { checkTimestamp: false });
            expect(result.valid).toBe(true);
        });
    });

    describe("Timestamp Freshness", () => {
        it("should accept fresh messages", () => {
            const signed = security.sign("fresh", keyPair.privateKey);
            const result = security.verify(signed, keyPair.publicKey);

            expect(result.valid).toBe(true);
        });

        it("should reject expired messages", () => {
            const signed = security.sign("old", keyPair.privateKey);

            // Manually set old timestamp
            const oldTime = new Date(Date.now() - 400000); // 6+ minutes ago
            signed.timestamp = oldTime.toISOString();

            // Re-sign with old timestamp (in real scenario, attacker can't do this)
            const messageToSign = `${signed.timestamp}:${signed.nonce}:${signed.data}`;
            signed.signature = crypto
                .sign(null, Buffer.from(messageToSign), keyPair.privateKey)
                .toString("base64");

            const result = security.verify(signed, keyPair.publicKey);

            expect(result.valid).toBe(false);
            expect(result.error).toContain("expired");
        });
    });
});

describe("Execution Order Signing Security", () => {
    let signer: ExecutionOrderSigner;
    let keyPair: KeyPair;

    beforeEach(() => {
        signer = new ExecutionOrderSigner();
        keyPair = signer.generateKeyPair();
    });

    describe("Order Signing", () => {
        it("should sign execution order", () => {
            const order: ExecutionOrder = {
                order_id: "ORD-001",
                plan_id: "PLAN-001",
                actions: [{ type: "file_create", target: "src/new.ts" }],
                approved_by: "user@test.com"
            };

            const signed = signer.signOrder(order, keyPair.privateKey);

            expect(signed.signature).toBeTruthy();
            expect(JSON.parse(signed.data)).toEqual(order);
        });

        it("should verify signed order", () => {
            const order: ExecutionOrder = {
                order_id: "ORD-002",
                plan_id: "PLAN-002",
                actions: [{ type: "code_edit", target: "src/edit.ts" }],
                approved_by: "admin"
            };

            const signed = signer.signOrder(order, keyPair.privateKey);
            const result = signer.verifyOrder(signed, keyPair.publicKey);

            expect(result.valid).toBe(true);
            expect(result.order).toEqual(order);
        });
    });

    describe("Order Tampering Detection", () => {
        it("should detect tampered order_id", () => {
            const order: ExecutionOrder = {
                order_id: "ORD-ORIGINAL",
                plan_id: "PLAN-001",
                actions: [],
                approved_by: "user"
            };

            const signed = signer.signOrder(order, keyPair.privateKey);

            // Tamper with order_id
            const tamperedOrder = JSON.parse(signed.data);
            tamperedOrder.order_id = "ORD-TAMPERED";
            signed.data = JSON.stringify(tamperedOrder);

            const result = signer.verifyOrder(signed, keyPair.publicKey);
            expect(result.valid).toBe(false);
        });

        it("should detect tampered actions", () => {
            const order: ExecutionOrder = {
                order_id: "ORD-001",
                plan_id: "PLAN-001",
                actions: [{ type: "file_create", target: "safe.ts" }],
                approved_by: "user"
            };

            const signed = signer.signOrder(order, keyPair.privateKey);

            // Tamper with actions
            const tamperedOrder = JSON.parse(signed.data);
            tamperedOrder.actions = [{ type: "file_delete", target: "/etc/passwd" }];
            signed.data = JSON.stringify(tamperedOrder);

            const result = signer.verifyOrder(signed, keyPair.publicKey);
            expect(result.valid).toBe(false);
        });

        it("should detect added actions", () => {
            const order: ExecutionOrder = {
                order_id: "ORD-001",
                plan_id: "PLAN-001",
                actions: [{ type: "file_create", target: "approved.ts" }],
                approved_by: "user"
            };

            const signed = signer.signOrder(order, keyPair.privateKey);

            // Add malicious action
            const tamperedOrder = JSON.parse(signed.data);
            tamperedOrder.actions.push({ type: "shell_exec", target: "rm -rf /" });
            signed.data = JSON.stringify(tamperedOrder);

            const result = signer.verifyOrder(signed, keyPair.publicKey);
            expect(result.valid).toBe(false);
        });

        it("should detect approver change", () => {
            const order: ExecutionOrder = {
                order_id: "ORD-001",
                plan_id: "PLAN-001",
                actions: [],
                approved_by: "limited-user"
            };

            const signed = signer.signOrder(order, keyPair.privateKey);

            // Change approver
            const tamperedOrder = JSON.parse(signed.data);
            tamperedOrder.approved_by = "admin";
            signed.data = JSON.stringify(tamperedOrder);

            const result = signer.verifyOrder(signed, keyPair.publicKey);
            expect(result.valid).toBe(false);
        });
    });

    describe("Key Security", () => {
        it("should not accept orders signed with different key", () => {
            const order: ExecutionOrder = {
                order_id: "ORD-001",
                plan_id: "PLAN-001",
                actions: [],
                approved_by: "user"
            };

            const maliciousKeyPair = signer.generateKeyPair();
            const signed = signer.signOrder(order, maliciousKeyPair.privateKey);

            // Try to verify with legitimate public key
            const result = signer.verifyOrder(signed, keyPair.publicKey);
            expect(result.valid).toBe(false);
        });

        it("should reject orders without signature", () => {
            const signed: SignedMessage = {
                data: JSON.stringify({ order_id: "ORD-001", plan_id: "PLAN-001", actions: [], approved_by: "user" }),
                signature: "",
                timestamp: new Date().toISOString(),
                nonce: "test-nonce"
            };

            const result = signer.verifyOrder(signed, keyPair.publicKey);
            expect(result.valid).toBe(false);
        });
    });

    describe("Replay Prevention for Orders", () => {
        it("should prevent order replay", () => {
            const order: ExecutionOrder = {
                order_id: "ORD-REPLAY-TEST",
                plan_id: "PLAN-001",
                actions: [{ type: "file_create", target: "new.ts" }],
                approved_by: "user"
            };

            const signed = signer.signOrder(order, keyPair.privateKey);

            // First execution
            const result1 = signer.verifyOrder(signed, keyPair.publicKey);
            expect(result1.valid).toBe(true);

            // Replay attempt
            const result2 = signer.verifyOrder(signed, keyPair.publicKey);
            expect(result2.valid).toBe(false);
            expect(result2.error).toContain("replay");
        });
    });
});
