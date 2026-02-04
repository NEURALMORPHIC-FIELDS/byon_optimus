using System;
using CommunityToolkit.Mvvm.ComponentModel;

namespace WfpSemanticGuard.Models
{
    public enum EventVerdict
    {
        Pending = 0,
        Allow = 1,
        Block = 2,
        Monitor = 3
    }

    public enum ThreatLevel
    {
        None = 0,
        Low = 1,
        Medium = 2,
        High = 3,
        Critical = 4
    }

    public enum FragmergentPhase
    {
        Equilibrium = 0,
        Fragmentation = 1,
        Emergence = 2
    }

    public enum FragmergentAnomalyLevel
    {
        None = 0,
        Mild = 1,
        Moderate = 2,
        Severe = 3,
        Critical = 4
    }

    public partial class NetworkEvent : ObservableObject
    {
        public ulong EventId { get; set; }
        public DateTime Timestamp { get; set; }
        public uint ProcessId { get; set; }
        public string ProcessName { get; set; } = string.Empty;
        public string ProcessPath { get; set; } = string.Empty;
        public string LocalAddress { get; set; } = string.Empty;
        public ushort LocalPort { get; set; }
        public string RemoteAddress { get; set; } = string.Empty;
        public ushort RemotePort { get; set; }
        public string Protocol { get; set; } = "TCP";

        [ObservableProperty]
        private EventVerdict _verdict;

        public ThreatLevel Threat { get; set; }
        public string ClusterType { get; set; } = string.Empty;
        public double ThreatScore { get; set; }
        public string Description { get; set; } = string.Empty;

        // Fragmergent Brain fields
        public double FragmergentClarity { get; set; }
        public double FragmergentClarityDelta { get; set; }
        public double FragmergentAnomalyScore { get; set; }
        public FragmergentPhase FragmergentPhase { get; set; }
        public FragmergentAnomalyLevel FragmergentAnomalyLevel { get; set; }

        // Display properties
        public string FragmergentClarityDisplay => $"{FragmergentClarity:P0}";
        public string FragmergentPhaseDisplay => FragmergentPhase.ToString();
        public string FragmergentAnomalyDisplay => FragmergentAnomalyLevel == FragmergentAnomalyLevel.None
            ? "Normal"
            : FragmergentAnomalyLevel.ToString();
    }

    public partial class AppProfile : ObservableObject
    {
        public uint ProcessId { get; set; }
        public string ProcessName { get; set; } = string.Empty;
        public string ProcessPath { get; set; } = string.Empty;

        [ObservableProperty]
        private ulong _totalConnections;

        [ObservableProperty]
        private ulong _blockedConnections;

        [ObservableProperty]
        private ulong _allowedConnections;

        public ulong BytesSent { get; set; }
        public ulong BytesReceived { get; set; }
        public double ReputationScore { get; set; }
        public string ClusterType { get; set; } = string.Empty;
        public ThreatLevel ThreatLevel { get; set; }

        [ObservableProperty]
        private bool _isWhitelisted;

        [ObservableProperty]
        private bool _isBlacklisted;

        public DateTime FirstSeen { get; set; }

        [ObservableProperty]
        private DateTime _lastSeen;
    }

    public class DriverStatistics
    {
        public bool IsRunning { get; set; }
        public ulong TotalConnections { get; set; }
        public ulong BlockedConnections { get; set; }
        public ulong AllowedConnections { get; set; }
        public ulong PendingEvents { get; set; }
        public ulong TrackedApps { get; set; }
        public ulong ActiveFlows { get; set; }
        public double CpuUsage { get; set; }
        public ulong MemoryUsage { get; set; }
        public TimeSpan Uptime { get; set; }
        public ulong PacketsPerSecond { get; set; }
        public ulong BytesPerSecond { get; set; }
    }

    public class FragmergentStatistics
    {
        public bool IsEnabled { get; set; }
        public ulong TotalProcessed { get; set; }
        public ulong AnomalyDetections { get; set; }
        public uint ActiveBrains { get; set; }
        public uint EquilibriumCount { get; set; }
        public uint FragmentationCount { get; set; }
        public uint EmergenceCount { get; set; }
        public ulong PhaseTransitions { get; set; }

        // Display properties
        public string StatusDisplay => IsEnabled ? "Active" : "Disabled";
        public string PhaseDistribution => $"Eq: {EquilibriumCount} | Frag: {FragmentationCount} | Em: {EmergenceCount}";
    }
}
