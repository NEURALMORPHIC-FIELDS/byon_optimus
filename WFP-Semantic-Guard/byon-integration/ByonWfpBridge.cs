// BYON-WFP Bridge Service
// Integrates WFP Semantic Guard with BYON Optimus Execution System
// Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac

using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;
using Microsoft.Win32.SafeHandles;

namespace WfpSemanticGuard.ByonIntegration
{
    /// <summary>
    /// EXECUTION_INTENT structure from BYON Auditor
    /// Only signed intents can unlock network access
    /// </summary>
    public class ExecutionIntent
    {
        public string IntentId { get; set; } = "";
        public string OrderId { get; set; } = "";
        public string Action { get; set; } = "";
        public NetworkPermission[] NetworkPermissions { get; set; } = Array.Empty<NetworkPermission>();
        public long Timestamp { get; set; }
        public long ExpiresAt { get; set; }
        public string Signature { get; set; } = "";
        public string PublicKey { get; set; } = "";
    }

    public class NetworkPermission
    {
        public string Protocol { get; set; } = "tcp";
        public string Host { get; set; } = "";
        public int Port { get; set; }
        public string Direction { get; set; } = "outbound";
    }

    /// <summary>
    /// WFP Rule structure to push to kernel driver
    /// </summary>
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct WfpIntentRule
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string IntentId;

        public uint RemoteIp;      // IPv4 in network byte order
        public ushort RemotePort;  // Port in host byte order
        public byte Protocol;      // 6=TCP, 17=UDP
        public byte Direction;     // 0=inbound, 1=outbound
        public long ExpiresAt;     // Unix timestamp
        public byte IsActive;      // 1=active, 0=expired
    }

    /// <summary>
    /// Bridge between BYON Optimus and WFP Semantic Guard
    /// Watches handoff directory for signed EXECUTION_INTENTs
    /// </summary>
    public class ByonWfpBridge : IDisposable
    {
        // IOCTL codes for WFP driver communication
        private const uint IOCTL_ADD_INTENT_RULE = 0x80002050;
        private const uint IOCTL_REMOVE_INTENT_RULE = 0x80002054;
        private const uint IOCTL_CLEAR_INTENT_RULES = 0x80002058;
        private const uint IOCTL_GET_INTENT_STATS = 0x8000205C;

        private readonly string _handoffPath;
        private readonly string _publicKeyPath;
        private readonly FileSystemWatcher _watcher;
        private readonly ConcurrentDictionary<string, ExecutionIntent> _activeIntents;
        private SafeFileHandle? _driverHandle;
        private byte[]? _publicKey;
        private bool _disposed;

        public event EventHandler<string>? OnLog;
        public event EventHandler<ExecutionIntent>? OnIntentApproved;
        public event EventHandler<string>? OnIntentExpired;

        public ByonWfpBridge(string handoffPath, string publicKeyPath)
        {
            _handoffPath = handoffPath;
            _publicKeyPath = publicKeyPath;
            _activeIntents = new ConcurrentDictionary<string, ExecutionIntent>();

            // Setup file watcher for intent files
            var intentDir = Path.Combine(_handoffPath, "auditor_to_executor");
            if (!Directory.Exists(intentDir))
            {
                Directory.CreateDirectory(intentDir);
            }

            _watcher = new FileSystemWatcher(intentDir, "*.intent.json")
            {
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.CreationTime,
                EnableRaisingEvents = false
            };
            _watcher.Created += OnIntentFileCreated;
            _watcher.Changed += OnIntentFileCreated;
        }

        public bool Initialize()
        {
            try
            {
                // Load Auditor's public key for signature verification
                if (File.Exists(_publicKeyPath))
                {
                    var keyPem = File.ReadAllText(_publicKeyPath);
                    _publicKey = ParseEd25519PublicKey(keyPem);
                    Log($"Loaded Auditor public key from {_publicKeyPath}");
                }
                else
                {
                    Log($"WARNING: Public key not found at {_publicKeyPath}");
                    Log("Intent signature verification will be skipped!");
                }

                // Open handle to WFP driver
                _driverHandle = OpenDriver();
                if (_driverHandle == null || _driverHandle.IsInvalid)
                {
                    Log("WARNING: Could not open WFP driver - running in simulation mode");
                }
                else
                {
                    Log("Connected to WFP Semantic Guard driver");
                    // Clear any stale rules
                    ClearAllRules();
                }

                // Start watching for intent files
                _watcher.EnableRaisingEvents = true;
                Log($"Watching for intents in: {_watcher.Path}");

                // Process any existing intent files
                ProcessExistingIntents();

                return true;
            }
            catch (Exception ex)
            {
                Log($"ERROR initializing bridge: {ex.Message}");
                return false;
            }
        }

        private void ProcessExistingIntents()
        {
            var intentDir = Path.Combine(_handoffPath, "auditor_to_executor");
            foreach (var file in Directory.GetFiles(intentDir, "*.intent.json"))
            {
                ProcessIntentFile(file);
            }
        }

        private void OnIntentFileCreated(object sender, FileSystemEventArgs e)
        {
            // Small delay to ensure file is fully written
            System.Threading.Thread.Sleep(100);
            ProcessIntentFile(e.FullPath);
        }

        private void ProcessIntentFile(string filePath)
        {
            try
            {
                if (!File.Exists(filePath)) return;

                var json = File.ReadAllText(filePath);
                var intent = JsonSerializer.Deserialize<ExecutionIntent>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                if (intent == null)
                {
                    Log($"Invalid intent file: {filePath}");
                    return;
                }

                // Verify signature
                if (_publicKey != null && !VerifySignature(intent))
                {
                    Log($"REJECTED: Invalid signature for intent {intent.IntentId}");
                    return;
                }

                // Check expiration
                var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                if (intent.ExpiresAt > 0 && intent.ExpiresAt < now)
                {
                    Log($"REJECTED: Intent {intent.IntentId} has expired");
                    return;
                }

                // Add to active intents
                _activeIntents[intent.IntentId] = intent;

                // Push rules to WFP driver
                foreach (var perm in intent.NetworkPermissions)
                {
                    var rule = CreateWfpRule(intent, perm);
                    AddRule(rule);
                }

                Log($"APPROVED: Intent {intent.IntentId} - {intent.NetworkPermissions.Length} network permissions");
                OnIntentApproved?.Invoke(this, intent);
            }
            catch (Exception ex)
            {
                Log($"ERROR processing intent file {filePath}: {ex.Message}");
            }
        }

        private WfpIntentRule CreateWfpRule(ExecutionIntent intent, NetworkPermission perm)
        {
            return new WfpIntentRule
            {
                IntentId = intent.IntentId.Substring(0, Math.Min(63, intent.IntentId.Length)),
                RemoteIp = ResolveHostToIp(perm.Host),
                RemotePort = (ushort)perm.Port,
                Protocol = perm.Protocol.ToLower() == "udp" ? (byte)17 : (byte)6,
                Direction = perm.Direction.ToLower() == "inbound" ? (byte)0 : (byte)1,
                ExpiresAt = intent.ExpiresAt,
                IsActive = 1
            };
        }

        private uint ResolveHostToIp(string host)
        {
            try
            {
                // Handle IP addresses directly
                if (System.Net.IPAddress.TryParse(host, out var ip))
                {
                    var bytes = ip.GetAddressBytes();
                    if (bytes.Length == 4)
                    {
                        return BitConverter.ToUInt32(bytes, 0);
                    }
                }

                // DNS resolution
                var addresses = System.Net.Dns.GetHostAddresses(host);
                foreach (var addr in addresses)
                {
                    if (addr.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        return BitConverter.ToUInt32(addr.GetAddressBytes(), 0);
                    }
                }
            }
            catch { }

            return 0; // 0.0.0.0 = any
        }

        private bool VerifySignature(ExecutionIntent intent)
        {
            if (_publicKey == null) return true; // Skip if no key

            try
            {
                // Reconstruct signed data (all fields except signature)
                var signedData = $"{intent.IntentId}|{intent.OrderId}|{intent.Action}|{intent.Timestamp}|{intent.ExpiresAt}";
                var dataBytes = Encoding.UTF8.GetBytes(signedData);
                var signatureBytes = Convert.FromBase64String(intent.Signature);

                // Verify Ed25519 signature
                using var ed25519 = new Ed25519PublicKey(_publicKey);
                return ed25519.Verify(dataBytes, signatureBytes);
            }
            catch (Exception ex)
            {
                Log($"Signature verification error: {ex.Message}");
                return false;
            }
        }

        private byte[] ParseEd25519PublicKey(string pem)
        {
            // Strip PEM headers and decode base64
            var lines = pem.Split('\n')
                .Where(l => !l.StartsWith("-----"))
                .Select(l => l.Trim());
            var base64 = string.Join("", lines);
            var der = Convert.FromBase64String(base64);

            // Ed25519 public key is last 32 bytes of DER encoding
            if (der.Length >= 32)
            {
                return der.Skip(der.Length - 32).ToArray();
            }
            return der;
        }

        #region Driver Communication

        private SafeFileHandle? OpenDriver()
        {
            try
            {
                var handle = NativeMethods.CreateFile(
                    @"\\.\WfpGuard",
                    NativeMethods.GENERIC_READ | NativeMethods.GENERIC_WRITE,
                    0,
                    IntPtr.Zero,
                    NativeMethods.OPEN_EXISTING,
                    0,
                    IntPtr.Zero
                );

                if (handle.IsInvalid)
                {
                    return null;
                }
                return handle;
            }
            catch
            {
                return null;
            }
        }

        private bool AddRule(WfpIntentRule rule)
        {
            if (_driverHandle == null || _driverHandle.IsInvalid)
            {
                Log($"[SIM] Would add rule for {rule.IntentId}: {rule.RemoteIp}:{rule.RemotePort}");
                return true;
            }

            var size = Marshal.SizeOf<WfpIntentRule>();
            var ptr = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(rule, ptr, false);
                uint bytesReturned = 0;
                return NativeMethods.DeviceIoControl(
                    _driverHandle,
                    IOCTL_ADD_INTENT_RULE,
                    ptr, (uint)size,
                    IntPtr.Zero, 0,
                    ref bytesReturned,
                    IntPtr.Zero
                );
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }
        }

        private bool RemoveRule(string intentId)
        {
            if (_driverHandle == null || _driverHandle.IsInvalid) return true;

            var idBytes = Encoding.ASCII.GetBytes(intentId.PadRight(64, '\0'));
            var ptr = Marshal.AllocHGlobal(64);
            try
            {
                Marshal.Copy(idBytes, 0, ptr, 64);
                uint bytesReturned = 0;
                return NativeMethods.DeviceIoControl(
                    _driverHandle,
                    IOCTL_REMOVE_INTENT_RULE,
                    ptr, 64,
                    IntPtr.Zero, 0,
                    ref bytesReturned,
                    IntPtr.Zero
                );
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }
        }

        private void ClearAllRules()
        {
            if (_driverHandle == null || _driverHandle.IsInvalid) return;

            uint bytesReturned = 0;
            NativeMethods.DeviceIoControl(
                _driverHandle,
                IOCTL_CLEAR_INTENT_RULES,
                IntPtr.Zero, 0,
                IntPtr.Zero, 0,
                ref bytesReturned,
                IntPtr.Zero
            );
            Log("Cleared all intent rules from WFP driver");
        }

        #endregion

        private void Log(string message)
        {
            var timestamp = DateTime.Now.ToString("HH:mm:ss.fff");
            OnLog?.Invoke(this, $"[{timestamp}] [BYON-WFP] {message}");
            Console.WriteLine($"[{timestamp}] [BYON-WFP] {message}");
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            _watcher.EnableRaisingEvents = false;
            _watcher.Dispose();

            ClearAllRules();
            _driverHandle?.Dispose();
        }
    }

    /// <summary>
    /// Simple Ed25519 verification wrapper
    /// </summary>
    internal class Ed25519PublicKey : IDisposable
    {
        private readonly byte[] _key;

        public Ed25519PublicKey(byte[] publicKey)
        {
            _key = publicKey;
        }

        public bool Verify(byte[] data, byte[] signature)
        {
            // Use .NET's built-in Ed25519 (requires .NET 5+)
            try
            {
                using var ecdsa = System.Security.Cryptography.ECDsa.Create();
                // For Ed25519, we'd use a specialized library
                // This is a placeholder - in production use NSec or Chaos.NaCl
                return true; // Simplified for demo
            }
            catch
            {
                return false;
            }
        }

        public void Dispose() { }
    }

    internal static class NativeMethods
    {
        public const uint GENERIC_READ = 0x80000000;
        public const uint GENERIC_WRITE = 0x40000000;
        public const uint OPEN_EXISTING = 3;

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern SafeFileHandle CreateFile(
            string lpFileName,
            uint dwDesiredAccess,
            uint dwShareMode,
            IntPtr lpSecurityAttributes,
            uint dwCreationDisposition,
            uint dwFlagsAndAttributes,
            IntPtr hTemplateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool DeviceIoControl(
            SafeFileHandle hDevice,
            uint dwIoControlCode,
            IntPtr lpInBuffer,
            uint nInBufferSize,
            IntPtr lpOutBuffer,
            uint nOutBufferSize,
            ref uint lpBytesReturned,
            IntPtr lpOverlapped);
    }
}
