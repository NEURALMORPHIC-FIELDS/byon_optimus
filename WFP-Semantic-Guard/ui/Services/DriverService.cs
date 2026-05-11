using System;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using Microsoft.Win32.SafeHandles;
using WfpSemanticGuard.Models;

namespace WfpSemanticGuard.Services
{
    public class DriverService : IDisposable
    {
        private const string DEVICE_NAME = @"\\.\WfpGuard";
        private const string SERVICE_NAME = "WfpGuard";

        // IOCTL codes - calculated from CTL_CODE macro
        // CTL_CODE(DeviceType, Function, Method, Access)
        // DeviceType = 0x8000, Method = METHOD_BUFFERED (0)
        // FILE_READ_ACCESS = 1, FILE_WRITE_ACCESS = 2
        private const uint IOCTL_WFP_GUARD_GET_STATS      = 0x80006000;  // 0x800, READ
        private const uint IOCTL_WFP_GUARD_GET_EVENT      = 0x80006004;  // 0x801, READ
        private const uint IOCTL_WFP_GUARD_SET_VERDICT    = 0x8000A008;  // 0x802, WRITE
        private const uint IOCTL_WFP_GUARD_SET_CONFIG     = 0x8000A00C;  // 0x803, WRITE
        private const uint IOCTL_WFP_GUARD_GET_APP_PROFILE = 0x80006010; // 0x804, READ
        private const uint IOCTL_WFP_GUARD_WHITELIST_APP  = 0x8000A014;  // 0x805, WRITE
        private const uint IOCTL_WFP_GUARD_BLACKLIST_APP  = 0x8000A018;  // 0x806, WRITE
        private const uint IOCTL_WFP_GUARD_GET_FRAGMERGENT_STATS = 0x8000601C;  // 0x807, READ
        private const uint IOCTL_WFP_GUARD_SET_FRAGMERGENT_CONFIG = 0x8000A020; // 0x808, WRITE

        private const int MAX_APP_PATH_LENGTH = 260;

        private SafeFileHandle? _deviceHandle;
        private bool _disposed;

        public bool IsConnected => _deviceHandle != null && !_deviceHandle.IsInvalid && !_deviceHandle.IsClosed;

        public event EventHandler<NetworkEvent>? EventReceived;
        public event EventHandler<DriverStatistics>? StatisticsUpdated;
        public event EventHandler<bool>? ConnectionStateChanged;

        #region Native Structures

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct WFP_GUARD_STATISTICS
        {
            public ulong TotalEvents;
            public ulong AllowedEvents;
            public ulong BlockedEvents;
            public ulong PendingEvents;

            public uint BehavioralDetections;
            public uint TemporalDetections;
            public uint CorrelationDetections;
            public uint ExfiltrationDetections;
            public uint BurstDetections;
            public uint ReputationDetections;

            public uint TrackedApps;
            public uint ActiveFlows;
            public ulong UptimeMs;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1, CharSet = CharSet.Unicode)]
        private struct WFP_GUARD_EVENT
        {
            public ulong EventId;
            public ulong Timestamp;
            public uint ProcessId;
            public uint RemoteIpV4;
            public ushort RemotePort;
            public ushort LocalPort;
            public byte Protocol;
            public byte Direction;
            public ushort PacketSize;
            public byte EntropyEstimate;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)]
            public byte[] Reserved;

            // Fragmergent Brain fields
            public ushort FragClarity;
            public short FragClarityDelta;
            public ushort FragAnomalyScore;
            public byte FragPhase;
            public byte FragAnomalyLevel;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = MAX_APP_PATH_LENGTH)]
            public string AppPath;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct WFP_GUARD_VERDICT
        {
            public ulong EventId;
            public int Action;        // WFP_GUARD_ACTION
            public uint DetectionFlags;
            public ushort ConfidenceScore;
            public ushort Reserved;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct WFP_GUARD_CONFIG
        {
            public byte EnableBehavioral;
            public byte EnableTemporal;
            public byte EnableCorrelation;
            public byte EnableExfiltration;
            public byte EnableBurst;
            public byte EnableReputation;
            public byte DefaultAction;
            public byte Reserved;

            public ushort ClusterThreshold;
            public ushort TemporalThreshold;
            public ushort CorrelationThreshold;
            public ushort ReputationBlockThreshold;
            public ushort ReputationTrustThreshold;
            public ushort Reserved2;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1, CharSet = CharSet.Unicode)]
        private struct WFP_GUARD_APP_PATH
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = MAX_APP_PATH_LENGTH)]
            public string Path;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct WFP_GUARD_FRAGMERGENT_STATS
        {
            public byte Enabled;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)]
            public byte[] Reserved;
            public ulong TotalProcessed;
            public ulong AnomalyDetections;
            public uint ActiveBrains;
            public uint EquilibriumCount;
            public uint FragmentationCount;
            public uint EmergenceCount;
            public ulong PhaseTransitions;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct WFP_GUARD_FRAGMERGENT_CONFIG
        {
            public byte Enabled;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)]
            public byte[] Reserved;
            public ushort FragmergentWeight;
            public ushort AnomalyMild;
            public ushort AnomalyModerate;
            public ushort AnomalySevere;
            public ushort Reserved2;
        }

        #endregion

        #region Native Methods

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern SafeFileHandle CreateFile(
            string lpFileName,
            uint dwDesiredAccess,
            uint dwShareMode,
            IntPtr lpSecurityAttributes,
            uint dwCreationDisposition,
            uint dwFlagsAndAttributes,
            IntPtr hTemplateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool DeviceIoControl(
            SafeFileHandle hDevice,
            uint dwIoControlCode,
            IntPtr lpInBuffer,
            uint nInBufferSize,
            IntPtr lpOutBuffer,
            uint nOutBufferSize,
            out uint lpBytesReturned,
            IntPtr lpOverlapped);

        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_ATTRIBUTE_NORMAL = 0x80;

        #endregion

        public bool Connect()
        {
            try
            {
                if (IsConnected)
                    return true;

                _deviceHandle = CreateFile(
                    DEVICE_NAME,
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    IntPtr.Zero,
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    IntPtr.Zero);

                if (_deviceHandle.IsInvalid)
                {
                    var error = Marshal.GetLastWin32Error();
                    System.Diagnostics.Debug.WriteLine($"Failed to connect to driver: Win32 error {error}");
                    return false;
                }

                ConnectionStateChanged?.Invoke(this, true);
                return true;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Exception connecting to driver: {ex.Message}");
                return false;
            }
        }

        public void Disconnect()
        {
            if (_deviceHandle != null && !_deviceHandle.IsInvalid)
            {
                _deviceHandle.Close();
                _deviceHandle = null;
                ConnectionStateChanged?.Invoke(this, false);
            }
        }

        public bool IsDriverInstalled()
        {
            try
            {
                using var sc = new ServiceController(SERVICE_NAME);
                var status = sc.Status;
                return true;
            }
            catch
            {
                return false;
            }
        }

        public bool IsDriverRunning()
        {
            try
            {
                using var sc = new ServiceController(SERVICE_NAME);
                return sc.Status == ServiceControllerStatus.Running;
            }
            catch
            {
                return false;
            }
        }

        public bool StartDriver()
        {
            try
            {
                using var sc = new ServiceController(SERVICE_NAME);
                if (sc.Status != ServiceControllerStatus.Running)
                {
                    sc.Start();
                    sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
                }
                return sc.Status == ServiceControllerStatus.Running;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to start driver: {ex.Message}");
                return false;
            }
        }

        public bool StopDriver()
        {
            try
            {
                Disconnect();
                using var sc = new ServiceController(SERVICE_NAME);
                if (sc.Status == ServiceControllerStatus.Running)
                {
                    sc.Stop();
                    sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
                }
                return sc.Status == ServiceControllerStatus.Stopped;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to stop driver: {ex.Message}");
                return false;
            }
        }

        public DriverStatistics GetStatistics()
        {
            var stats = new DriverStatistics
            {
                IsRunning = IsDriverRunning()
            };

            if (!IsConnected || !stats.IsRunning)
                return stats;

            try
            {
                var nativeStats = new WFP_GUARD_STATISTICS();
                int size = Marshal.SizeOf<WFP_GUARD_STATISTICS>();
                IntPtr buffer = Marshal.AllocHGlobal(size);

                try
                {
                    if (DeviceIoControl(
                        _deviceHandle!,
                        IOCTL_WFP_GUARD_GET_STATS,
                        IntPtr.Zero, 0,
                        buffer, (uint)size,
                        out uint bytesReturned,
                        IntPtr.Zero))
                    {
                        nativeStats = Marshal.PtrToStructure<WFP_GUARD_STATISTICS>(buffer);

                        stats.TotalConnections = nativeStats.TotalEvents;
                        stats.AllowedConnections = nativeStats.AllowedEvents;
                        stats.BlockedConnections = nativeStats.BlockedEvents;
                        stats.PendingEvents = nativeStats.PendingEvents;
                        stats.TrackedApps = nativeStats.TrackedApps;
                        stats.ActiveFlows = nativeStats.ActiveFlows;
                        stats.Uptime = TimeSpan.FromMilliseconds(nativeStats.UptimeMs);

                        // Estimate packets/bytes per second from detection counters
                        stats.PacketsPerSecond = nativeStats.BehavioralDetections +
                                                 nativeStats.TemporalDetections;
                        stats.BytesPerSecond = stats.PacketsPerSecond * 500; // Rough estimate
                    }
                    else
                    {
                        var error = Marshal.GetLastWin32Error();
                        System.Diagnostics.Debug.WriteLine($"GetStatistics IOCTL failed: {error}");
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"GetStatistics exception: {ex.Message}");
            }

            return stats;
        }

        public NetworkEvent? GetNextEvent()
        {
            if (!IsConnected)
                return null;

            try
            {
                int size = Marshal.SizeOf<WFP_GUARD_EVENT>();
                IntPtr buffer = Marshal.AllocHGlobal(size);

                try
                {
                    if (DeviceIoControl(
                        _deviceHandle!,
                        IOCTL_WFP_GUARD_GET_EVENT,
                        IntPtr.Zero, 0,
                        buffer, (uint)size,
                        out uint bytesReturned,
                        IntPtr.Zero) && bytesReturned == size)
                    {
                        var nativeEvent = Marshal.PtrToStructure<WFP_GUARD_EVENT>(buffer);

                        var networkEvent = new NetworkEvent
                        {
                            EventId = nativeEvent.EventId,
                            Timestamp = DateTime.FromFileTimeUtc((long)nativeEvent.Timestamp),
                            ProcessId = nativeEvent.ProcessId,
                            ProcessPath = nativeEvent.AppPath ?? string.Empty,
                            ProcessName = System.IO.Path.GetFileName(nativeEvent.AppPath ?? "unknown"),
                            RemoteAddress = FormatIpAddress(nativeEvent.RemoteIpV4),
                            RemotePort = nativeEvent.RemotePort,
                            LocalPort = nativeEvent.LocalPort,
                            Protocol = nativeEvent.Protocol == 6 ? "TCP" :
                                       nativeEvent.Protocol == 17 ? "UDP" : "OTHER",
                            Verdict = EventVerdict.Pending,
                            Threat = ThreatLevel.None,
                            // Fragmergent fields
                            FragmergentClarity = nativeEvent.FragClarity / 1000.0,
                            FragmergentClarityDelta = nativeEvent.FragClarityDelta / 1000.0,
                            FragmergentAnomalyScore = nativeEvent.FragAnomalyScore / 1000.0,
                            FragmergentPhase = (FragmergentPhase)nativeEvent.FragPhase,
                            FragmergentAnomalyLevel = (FragmergentAnomalyLevel)nativeEvent.FragAnomalyLevel
                        };

                        EventReceived?.Invoke(this, networkEvent);
                        return networkEvent;
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"GetNextEvent exception: {ex.Message}");
            }

            return null;
        }

        public bool SetVerdict(ulong eventId, EventVerdict verdict)
        {
            if (!IsConnected)
                return false;

            try
            {
                var nativeVerdict = new WFP_GUARD_VERDICT
                {
                    EventId = eventId,
                    Action = verdict switch
                    {
                        EventVerdict.Allow => 0,
                        EventVerdict.Block => 1,
                        EventVerdict.Pending => 3,
                        _ => 0
                    },
                    DetectionFlags = 0,
                    ConfidenceScore = 1000,
                    Reserved = 0
                };

                int size = Marshal.SizeOf<WFP_GUARD_VERDICT>();
                IntPtr buffer = Marshal.AllocHGlobal(size);

                try
                {
                    Marshal.StructureToPtr(nativeVerdict, buffer, false);

                    return DeviceIoControl(
                        _deviceHandle!,
                        IOCTL_WFP_GUARD_SET_VERDICT,
                        buffer, (uint)size,
                        IntPtr.Zero, 0,
                        out _,
                        IntPtr.Zero);
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"SetVerdict exception: {ex.Message}");
                return false;
            }
        }

        public bool SetConfig(bool enableBehavioral, bool enableTemporal, bool enableCorrelation,
                              bool enableExfiltration, bool enableBurst, bool enableReputation,
                              ushort clusterThreshold = 700, ushort temporalThreshold = 650,
                              ushort correlationThreshold = 600, ushort reputationBlockThreshold = 350,
                              byte defaultAction = 0)
        {
            if (!IsConnected)
                return false;

            try
            {
                var config = new WFP_GUARD_CONFIG
                {
                    EnableBehavioral = (byte)(enableBehavioral ? 1 : 0),
                    EnableTemporal = (byte)(enableTemporal ? 1 : 0),
                    EnableCorrelation = (byte)(enableCorrelation ? 1 : 0),
                    EnableExfiltration = (byte)(enableExfiltration ? 1 : 0),
                    EnableBurst = (byte)(enableBurst ? 1 : 0),
                    EnableReputation = (byte)(enableReputation ? 1 : 0),
                    DefaultAction = defaultAction,
                    Reserved = 0,
                    ClusterThreshold = clusterThreshold,
                    TemporalThreshold = temporalThreshold,
                    CorrelationThreshold = correlationThreshold,
                    ReputationBlockThreshold = reputationBlockThreshold,
                    ReputationTrustThreshold = 650,
                    Reserved2 = 0
                };

                int size = Marshal.SizeOf<WFP_GUARD_CONFIG>();
                IntPtr buffer = Marshal.AllocHGlobal(size);

                try
                {
                    Marshal.StructureToPtr(config, buffer, false);

                    return DeviceIoControl(
                        _deviceHandle!,
                        IOCTL_WFP_GUARD_SET_CONFIG,
                        buffer, (uint)size,
                        IntPtr.Zero, 0,
                        out _,
                        IntPtr.Zero);
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"SetConfig exception: {ex.Message}");
                return false;
            }
        }

        public FragmergentStatistics? GetFragmergentStats()
        {
            if (!IsConnected)
                return null;

            try
            {
                int size = Marshal.SizeOf<WFP_GUARD_FRAGMERGENT_STATS>();
                IntPtr buffer = Marshal.AllocHGlobal(size);

                try
                {
                    if (DeviceIoControl(
                        _deviceHandle!,
                        IOCTL_WFP_GUARD_GET_FRAGMERGENT_STATS,
                        IntPtr.Zero, 0,
                        buffer, (uint)size,
                        out uint bytesReturned,
                        IntPtr.Zero) && bytesReturned == size)
                    {
                        var nativeStats = Marshal.PtrToStructure<WFP_GUARD_FRAGMERGENT_STATS>(buffer);

                        return new FragmergentStatistics
                        {
                            IsEnabled = nativeStats.Enabled != 0,
                            TotalProcessed = nativeStats.TotalProcessed,
                            AnomalyDetections = nativeStats.AnomalyDetections,
                            ActiveBrains = nativeStats.ActiveBrains,
                            EquilibriumCount = nativeStats.EquilibriumCount,
                            FragmentationCount = nativeStats.FragmentationCount,
                            EmergenceCount = nativeStats.EmergenceCount,
                            PhaseTransitions = nativeStats.PhaseTransitions
                        };
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"GetFragmergentStats exception: {ex.Message}");
            }

            return null;
        }

        public bool SetFragmergentConfig(bool enabled, ushort weight = 300,
            ushort anomalyMild = 200, ushort anomalyModerate = 350, ushort anomalySevere = 500)
        {
            if (!IsConnected)
                return false;

            try
            {
                var config = new WFP_GUARD_FRAGMERGENT_CONFIG
                {
                    Enabled = (byte)(enabled ? 1 : 0),
                    Reserved = new byte[3],
                    FragmergentWeight = weight,
                    AnomalyMild = anomalyMild,
                    AnomalyModerate = anomalyModerate,
                    AnomalySevere = anomalySevere,
                    Reserved2 = 0
                };

                int size = Marshal.SizeOf<WFP_GUARD_FRAGMERGENT_CONFIG>();
                IntPtr buffer = Marshal.AllocHGlobal(size);

                try
                {
                    Marshal.StructureToPtr(config, buffer, false);

                    return DeviceIoControl(
                        _deviceHandle!,
                        IOCTL_WFP_GUARD_SET_FRAGMERGENT_CONFIG,
                        buffer, (uint)size,
                        IntPtr.Zero, 0,
                        out _,
                        IntPtr.Zero);
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"SetFragmergentConfig exception: {ex.Message}");
                return false;
            }
        }

        public bool WhitelistApp(string processPath)
        {
            return SetAppListStatus(processPath, true);
        }

        public bool BlacklistApp(string processPath)
        {
            return SetAppListStatus(processPath, false);
        }

        private bool SetAppListStatus(string processPath, bool whitelist)
        {
            if (!IsConnected || string.IsNullOrEmpty(processPath))
                return false;

            try
            {
                var appPath = new WFP_GUARD_APP_PATH { Path = processPath };
                int size = Marshal.SizeOf<WFP_GUARD_APP_PATH>();
                IntPtr buffer = Marshal.AllocHGlobal(size);

                try
                {
                    Marshal.StructureToPtr(appPath, buffer, false);

                    uint ioctl = whitelist ? IOCTL_WFP_GUARD_WHITELIST_APP : IOCTL_WFP_GUARD_BLACKLIST_APP;

                    return DeviceIoControl(
                        _deviceHandle!,
                        ioctl,
                        buffer, (uint)size,
                        IntPtr.Zero, 0,
                        out _,
                        IntPtr.Zero);
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"SetAppListStatus exception: {ex.Message}");
                return false;
            }
        }

        private static string FormatIpAddress(uint ip)
        {
            // Network byte order to dotted decimal
            byte[] bytes = BitConverter.GetBytes(ip);
            return $"{bytes[0]}.{bytes[1]}.{bytes[2]}.{bytes[3]}";
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                Disconnect();
                _disposed = true;
            }
        }
    }
}
