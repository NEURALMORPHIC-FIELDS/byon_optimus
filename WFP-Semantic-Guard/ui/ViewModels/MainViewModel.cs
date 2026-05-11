using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Timers;
using System.Windows;
using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WfpSemanticGuard.Models;
using WfpSemanticGuard.Services;

namespace WfpSemanticGuard.ViewModels
{
    public partial class MainViewModel : ObservableObject, IDisposable
    {
        private readonly DriverService _driverService;
        private readonly Timer _updateTimer;
        private readonly Random _random = new();
        private bool _disposed;

        public MainViewModel()
        {
            _driverService = new DriverService();
            _updateTimer = new Timer(1000); // Update every second
            _updateTimer.Elapsed += OnUpdateTimerElapsed;

            NetworkEvents = new ObservableCollection<NetworkEvent>();
            AppProfiles = new ObservableCollection<AppProfile>();

            // Generate some demo data
            GenerateDemoData();

            // Start update timer
            _updateTimer.Start();
        }

        #region Properties

        [ObservableProperty]
        private bool _isDriverInstalled;

        [ObservableProperty]
        private bool _isDriverRunning;

        [ObservableProperty]
        private bool _isConnected;

        [ObservableProperty]
        private string _statusText = "Checking driver status...";

        [ObservableProperty]
        private string _statusColor = "#ffc107";

        // Statistics
        [ObservableProperty]
        private ulong _totalConnections;

        [ObservableProperty]
        private ulong _blockedConnections;

        [ObservableProperty]
        private ulong _allowedConnections;

        [ObservableProperty]
        private ulong _pendingEvents;

        [ObservableProperty]
        private ulong _trackedApps;

        [ObservableProperty]
        private ulong _activeFlows;

        [ObservableProperty]
        private ulong _packetsPerSecond;

        [ObservableProperty]
        private ulong _bytesPerSecond;

        [ObservableProperty]
        private string _uptimeText = "00:00:00";

        [ObservableProperty]
        private double _threatScore;

        [ObservableProperty]
        private string _threatLevel = "Low";

        [ObservableProperty]
        private string _threatColor = "#00d26a";

        // Charts data
        [ObservableProperty]
        private double[] _trafficHistory = new double[60];

        [ObservableProperty]
        private double[] _blockHistory = new double[60];

        // Collections
        public ObservableCollection<NetworkEvent> NetworkEvents { get; }
        public ObservableCollection<AppProfile> AppProfiles { get; }

        [ObservableProperty]
        private NetworkEvent? _selectedEvent;

        [ObservableProperty]
        private AppProfile? _selectedApp;

        [ObservableProperty]
        private int _selectedTabIndex;

        // Settings - Detection module toggles
        [ObservableProperty]
        private bool _enableBehavioral = false;

        [ObservableProperty]
        private bool _enableTemporal = false;

        [ObservableProperty]
        private bool _enableCorrelation = false;

        [ObservableProperty]
        private bool _enableExfiltration = false;

        [ObservableProperty]
        private bool _enableBurst = false;

        [ObservableProperty]
        private bool _enableReputation = false;

        // Settings - Threshold values
        [ObservableProperty]
        private double _behavioralWeight = 0.25;

        [ObservableProperty]
        private double _exfiltrationWeight = 0.15;

        [ObservableProperty]
        private double _burstThreshold = 10.0;

        [ObservableProperty]
        private double _temporalWeight = 0.20;

        [ObservableProperty]
        private double _blockThreshold = 0.35;

        // Settings feedback
        [ObservableProperty]
        private string _settingsStatus = "";

        // Fragmergent Brain settings
        [ObservableProperty]
        private bool _enableFragmergent = false;

        [ObservableProperty]
        private double _fragmergentWeight = 0.30;

        // Fragmergent Brain statistics
        [ObservableProperty]
        private string _fragmergentStatus = "Disabled";

        [ObservableProperty]
        private ulong _fragmergentAnomalies;

        [ObservableProperty]
        private uint _fragmergentActiveBrains;

        [ObservableProperty]
        private string _fragmergentPhaseDistribution = "—";

        [ObservableProperty]
        private ulong _fragmergentPhaseTransitions;

        #endregion

        #region Commands

        [RelayCommand]
        private void StartDriver()
        {
            try
            {
                if (_driverService.StartDriver())
                {
                    System.Threading.Thread.Sleep(500);
                    _driverService.Connect();
                    UpdateDriverStatus();
                }
                else
                {
                    MessageBox.Show("Failed to start driver. Make sure you're running as Administrator.",
                        "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error starting driver: {ex.Message}",
                    "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        [RelayCommand]
        private void StopDriver()
        {
            try
            {
                if (_driverService.StopDriver())
                {
                    UpdateDriverStatus();
                }
                else
                {
                    MessageBox.Show("Failed to stop driver.",
                        "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error stopping driver: {ex.Message}",
                    "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        [RelayCommand]
        private void AllowEvent()
        {
            if (SelectedEvent != null)
            {
                SelectedEvent.Verdict = EventVerdict.Allow;
                _driverService.SetVerdict(SelectedEvent.EventId, EventVerdict.Allow);
            }
        }

        [RelayCommand]
        private void BlockEvent()
        {
            if (SelectedEvent != null)
            {
                SelectedEvent.Verdict = EventVerdict.Block;
                _driverService.SetVerdict(SelectedEvent.EventId, EventVerdict.Block);
            }
        }

        [RelayCommand]
        private void WhitelistApp()
        {
            if (SelectedApp != null)
            {
                SelectedApp.IsWhitelisted = true;
                SelectedApp.IsBlacklisted = false;
                _driverService.WhitelistApp(SelectedApp.ProcessPath);
            }
        }

        [RelayCommand]
        private void BlacklistApp()
        {
            if (SelectedApp != null)
            {
                SelectedApp.IsBlacklisted = true;
                SelectedApp.IsWhitelisted = false;
                _driverService.BlacklistApp(SelectedApp.ProcessPath);
            }
        }

        [RelayCommand]
        private void ClearEvents()
        {
            Application.Current.Dispatcher.Invoke(() => NetworkEvents.Clear());
        }

        [RelayCommand]
        private void RefreshData()
        {
            UpdateStatistics();
            GenerateDemoData();
        }

        [RelayCommand]
        private void SaveSettings()
        {
            try
            {
                if (!IsConnected)
                {
                    SettingsStatus = "Not connected to driver";
                    return;
                }

                // Convert weights to 0-1000 scale for driver
                ushort clusterThreshold = (ushort)(BehavioralWeight * 1000);
                ushort temporalThreshold = (ushort)(TemporalWeight * 1000);
                ushort correlationThreshold = 600; // Fixed for now
                ushort reputationBlockThreshold = (ushort)(BlockThreshold * 1000);

                bool success = _driverService.SetConfig(
                    EnableBehavioral,
                    EnableTemporal,
                    EnableCorrelation,
                    EnableExfiltration,
                    EnableBurst,
                    EnableReputation,
                    clusterThreshold,
                    temporalThreshold,
                    correlationThreshold,
                    reputationBlockThreshold);

                // Also save Fragmergent config
                if (success)
                {
                    ushort fragWeight = (ushort)(FragmergentWeight * 1000);
                    success = _driverService.SetFragmergentConfig(EnableFragmergent, fragWeight);
                }

                SettingsStatus = success ? "Settings saved successfully" : "Failed to save settings";

                // Clear status after 3 seconds
                System.Threading.Tasks.Task.Delay(3000).ContinueWith(_ =>
                {
                    Application.Current?.Dispatcher?.Invoke(() => SettingsStatus = "");
                });
            }
            catch (Exception ex)
            {
                SettingsStatus = $"Error: {ex.Message}";
            }
        }

        #endregion

        #region Private Methods

        private void OnUpdateTimerElapsed(object? sender, ElapsedEventArgs e)
        {
            Application.Current?.Dispatcher?.Invoke(() =>
            {
                UpdateDriverStatus();
                UpdateStatistics();
                UpdateTrafficHistory();

                if (IsConnected)
                {
                    // Poll for real events from driver
                    PollDriverEvents();
                }
                else if (_random.Next(100) < 20)
                {
                    // Demo mode - occasionally add simulated events
                    AddDemoEvent();
                }
            });
        }

        private void PollDriverEvents()
        {
            // Get any pending events from driver
            NetworkEvent? evt;
            int maxEvents = 10; // Process up to 10 events per tick to prevent UI stall
            int count = 0;

            while (count < maxEvents && (evt = _driverService.GetNextEvent()) != null)
            {
                NetworkEvents.Insert(0, evt);
                count++;

                // Update or add app profile
                UpdateAppProfile(evt);
            }

            // Keep only last 100 events
            while (NetworkEvents.Count > 100)
            {
                NetworkEvents.RemoveAt(NetworkEvents.Count - 1);
            }
        }

        private void UpdateAppProfile(NetworkEvent evt)
        {
            // Find existing app profile or create new one
            var existing = AppProfiles.FirstOrDefault(a =>
                string.Equals(a.ProcessPath, evt.ProcessPath, StringComparison.OrdinalIgnoreCase));

            if (existing != null)
            {
                existing.TotalConnections++;
                existing.LastSeen = evt.Timestamp;
                if (evt.Verdict == EventVerdict.Block)
                    existing.BlockedConnections++;
                else
                    existing.AllowedConnections++;
            }
            else
            {
                AppProfiles.Add(new AppProfile
                {
                    ProcessId = evt.ProcessId,
                    ProcessName = evt.ProcessName,
                    ProcessPath = evt.ProcessPath,
                    TotalConnections = 1,
                    BlockedConnections = evt.Verdict == EventVerdict.Block ? 1ul : 0ul,
                    AllowedConnections = evt.Verdict == EventVerdict.Allow ? 1ul : 0ul,
                    ClusterType = evt.ClusterType,
                    ThreatLevel = evt.Threat,
                    FirstSeen = evt.Timestamp,
                    LastSeen = evt.Timestamp
                });
            }
        }

        private void UpdateDriverStatus()
        {
            IsDriverInstalled = _driverService.IsDriverInstalled();
            IsDriverRunning = _driverService.IsDriverRunning();
            IsConnected = _driverService.IsConnected;

            if (!IsDriverInstalled)
            {
                StatusText = "Driver Not Installed";
                StatusColor = "#e94560";
            }
            else if (!IsDriverRunning)
            {
                StatusText = "Driver Stopped";
                StatusColor = "#ffc107";
            }
            else if (!IsConnected)
            {
                StatusText = "Connecting...";
                StatusColor = "#ffc107";
                _driverService.Connect();
            }
            else
            {
                StatusText = "Active - Protecting";
                StatusColor = "#00d26a";
            }
        }

        private void UpdateStatistics()
        {
            if (!IsDriverRunning)
            {
                // Show demo data when driver is not running
                TotalConnections += (ulong)_random.Next(0, 5);
                if (_random.Next(100) < 5)
                    BlockedConnections += 1;
                AllowedConnections = TotalConnections - BlockedConnections;
                PacketsPerSecond = (ulong)_random.Next(100, 500);
                BytesPerSecond = (ulong)_random.Next(10000, 50000);
                TrackedApps = (ulong)AppProfiles.Count;
                ActiveFlows = (ulong)_random.Next(20, 100);
                return;
            }

            var stats = _driverService.GetStatistics();
            TotalConnections = stats.TotalConnections;
            BlockedConnections = stats.BlockedConnections;
            AllowedConnections = stats.AllowedConnections;
            PendingEvents = stats.PendingEvents;
            TrackedApps = stats.TrackedApps;
            ActiveFlows = stats.ActiveFlows;
            PacketsPerSecond = stats.PacketsPerSecond;
            BytesPerSecond = stats.BytesPerSecond;
            UptimeText = stats.Uptime.ToString(@"hh\:mm\:ss");

            // Update Fragmergent statistics
            var fragStats = _driverService.GetFragmergentStats();
            if (fragStats != null)
            {
                FragmergentStatus = fragStats.IsEnabled ? "Active" : "Disabled";
                FragmergentAnomalies = fragStats.AnomalyDetections;
                FragmergentActiveBrains = fragStats.ActiveBrains;
                FragmergentPhaseDistribution = fragStats.PhaseDistribution;
                FragmergentPhaseTransitions = fragStats.PhaseTransitions;
            }

            // Update threat level based on blocked ratio
            var blockRatio = TotalConnections > 0 ? (double)BlockedConnections / TotalConnections : 0;
            ThreatScore = blockRatio * 100;

            if (blockRatio < 0.01)
            {
                ThreatLevel = "Low";
                ThreatColor = "#00d26a";
            }
            else if (blockRatio < 0.05)
            {
                ThreatLevel = "Medium";
                ThreatColor = "#ffc107";
            }
            else if (blockRatio < 0.1)
            {
                ThreatLevel = "High";
                ThreatColor = "#ff6b35";
            }
            else
            {
                ThreatLevel = "Critical";
                ThreatColor = "#e94560";
            }
        }

        private void UpdateTrafficHistory()
        {
            // Shift history left
            var newTraffic = new double[60];
            var newBlocks = new double[60];

            for (int i = 0; i < 59; i++)
            {
                newTraffic[i] = TrafficHistory[i + 1];
                newBlocks[i] = BlockHistory[i + 1];
            }

            newTraffic[59] = PacketsPerSecond;
            newBlocks[59] = _random.Next(0, 10);

            TrafficHistory = newTraffic;
            BlockHistory = newBlocks;
        }

        private void GenerateDemoData()
        {
            Application.Current?.Dispatcher?.Invoke(() =>
            {
                NetworkEvents.Clear();
                AppProfiles.Clear();

                // Demo apps
                var apps = new[]
                {
                    ("chrome.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "BROWSER"),
                    ("firefox.exe", "C:\\Program Files\\Mozilla Firefox\\firefox.exe", "BROWSER"),
                    ("Code.exe", "C:\\Users\\Lucian\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe", "BACKGROUND_SERVICE"),
                    ("Teams.exe", "C:\\Users\\Lucian\\AppData\\Local\\Microsoft\\Teams\\current\\Teams.exe", "BACKGROUND_SERVICE"),
                    ("svchost.exe", "C:\\Windows\\System32\\svchost.exe", "BACKGROUND_SERVICE"),
                    ("OneDrive.exe", "C:\\Users\\Lucian\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe", "P2P"),
                    ("Spotify.exe", "C:\\Users\\Lucian\\AppData\\Roaming\\Spotify\\Spotify.exe", "BROWSER"),
                    ("suspicious.exe", "C:\\Users\\Lucian\\Downloads\\suspicious.exe", "BEACON"),
                };

                foreach (var (name, path, cluster) in apps)
                {
                    var threat = cluster switch
                    {
                        "BEACON" => Models.ThreatLevel.High,
                        "EXFIL" => Models.ThreatLevel.Critical,
                        "DGA" => Models.ThreatLevel.High,
                        _ => Models.ThreatLevel.None
                    };

                    AppProfiles.Add(new AppProfile
                    {
                        ProcessId = (uint)_random.Next(1000, 65000),
                        ProcessName = name,
                        ProcessPath = path,
                        TotalConnections = (ulong)_random.Next(100, 5000),
                        BlockedConnections = (ulong)_random.Next(0, 50),
                        AllowedConnections = (ulong)_random.Next(100, 5000),
                        BytesSent = (ulong)_random.Next(100000, 10000000),
                        BytesReceived = (ulong)_random.Next(100000, 10000000),
                        ReputationScore = _random.NextDouble() * 100,
                        ClusterType = cluster,
                        ThreatLevel = threat,
                        IsWhitelisted = name == "chrome.exe",
                        FirstSeen = DateTime.Now.AddDays(-_random.Next(1, 30)),
                        LastSeen = DateTime.Now.AddMinutes(-_random.Next(0, 60))
                    });
                }

                // Generate some demo events
                for (int i = 0; i < 20; i++)
                {
                    AddDemoEvent();
                }
            });
        }

        private void AddDemoEvent()
        {
            if (AppProfiles.Count == 0) return;

            var app = AppProfiles[_random.Next(AppProfiles.Count)];
            var verdict = (EventVerdict)_random.Next(1, 4);
            var threat = app.ThreatLevel;

            var remoteIps = new[] { "142.250.185.206", "151.101.1.140", "104.244.42.129", "185.199.108.133", "52.96.166.210" };

            NetworkEvents.Insert(0, new NetworkEvent
            {
                EventId = (ulong)_random.Next(100000, 999999),
                Timestamp = DateTime.Now,
                ProcessId = app.ProcessId,
                ProcessName = app.ProcessName,
                ProcessPath = app.ProcessPath,
                LocalAddress = "192.168.1." + _random.Next(2, 254),
                LocalPort = (ushort)_random.Next(49152, 65535),
                RemoteAddress = remoteIps[_random.Next(remoteIps.Length)],
                RemotePort = (ushort)(_random.Next(2) == 0 ? 443 : 80),
                Protocol = "TCP",
                Verdict = verdict,
                Threat = threat,
                ClusterType = app.ClusterType,
                ThreatScore = _random.NextDouble() * (threat == Models.ThreatLevel.High ? 80 : 30),
                Description = verdict == EventVerdict.Block ? "Blocked: Suspicious behavior detected" : "Allowed"
            });

            // Keep only last 100 events
            while (NetworkEvents.Count > 100)
            {
                NetworkEvents.RemoveAt(NetworkEvents.Count - 1);
            }
        }

        #endregion

        public void Dispose()
        {
            if (!_disposed)
            {
                _updateTimer.Stop();
                _updateTimer.Dispose();
                _driverService.Dispose();
                _disposed = true;
            }
        }
    }
}
