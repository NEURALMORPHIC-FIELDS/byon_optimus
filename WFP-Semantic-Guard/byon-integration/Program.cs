// BYON-WFP Bridge Service Entry Point
// Runs as Windows Service or Console Application
// Patent: EP25216372.0 - OmniVault

using System;
using System.IO;
using System.Threading;
using WfpSemanticGuard.ByonIntegration;

namespace ByonWfpBridgeService
{
    class Program
    {
        private static ByonWfpBridge? _bridge;
        private static readonly ManualResetEvent _exitEvent = new(false);

        static int Main(string[] args)
        {
            Console.WriteLine("===========================================");
            Console.WriteLine("  BYON-WFP Bridge Service");
            Console.WriteLine("  WFP Semantic Guard + BYON Optimus");
            Console.WriteLine("  Patent: EP25216372.0 - OmniVault");
            Console.WriteLine("===========================================");
            Console.WriteLine();

            // Parse arguments
            var handoffPath = GetArg(args, "--handoff") ?? @"C:\byon_optimus\handoff";
            var publicKeyPath = GetArg(args, "--pubkey") ?? @"C:\byon_optimus\keys\auditor.public.pem";

            // Allow override from environment
            handoffPath = Environment.GetEnvironmentVariable("BYON_HANDOFF_PATH") ?? handoffPath;
            publicKeyPath = Environment.GetEnvironmentVariable("BYON_AUDITOR_PUBKEY") ?? publicKeyPath;

            Console.WriteLine($"Handoff Path: {handoffPath}");
            Console.WriteLine($"Public Key:   {publicKeyPath}");
            Console.WriteLine();

            // Ensure directories exist
            if (!Directory.Exists(handoffPath))
            {
                Console.WriteLine($"Creating handoff directory: {handoffPath}");
                Directory.CreateDirectory(handoffPath);
            }

            // Create and initialize bridge
            _bridge = new ByonWfpBridge(handoffPath, publicKeyPath);

            _bridge.OnLog += (s, msg) => Console.WriteLine(msg);
            _bridge.OnIntentApproved += (s, intent) =>
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine($"[APPROVED] Intent: {intent.IntentId}");
                Console.WriteLine($"           Action: {intent.Action}");
                Console.WriteLine($"           Permissions: {intent.NetworkPermissions.Length}");
                Console.ResetColor();
            };
            _bridge.OnIntentExpired += (s, intentId) =>
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine($"[EXPIRED] Intent: {intentId}");
                Console.ResetColor();
            };

            if (!_bridge.Initialize())
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("Failed to initialize BYON-WFP Bridge!");
                Console.ResetColor();
                return 1;
            }

            Console.WriteLine();
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("Bridge is running. Press Ctrl+C to stop.");
            Console.ResetColor();
            Console.WriteLine();

            // Handle Ctrl+C
            Console.CancelKeyPress += (s, e) =>
            {
                e.Cancel = true;
                Console.WriteLine("\nShutting down...");
                _exitEvent.Set();
            };

            // Wait for exit signal
            _exitEvent.WaitOne();

            // Cleanup
            _bridge.Dispose();
            Console.WriteLine("BYON-WFP Bridge stopped.");
            return 0;
        }

        private static string? GetArg(string[] args, string name)
        {
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == name)
                {
                    return args[i + 1];
                }
            }
            return null;
        }
    }
}
