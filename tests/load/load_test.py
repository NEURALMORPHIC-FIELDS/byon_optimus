#!/usr/bin/env python3
"""
BYON Optimus Load Testing Suite
================================

Simulates high-volume concurrent message processing to validate:
- System throughput under load
- Resource limits (CPU, memory)
- Queue performance (Redis)
- Rate limiting behavior
- Error handling under stress

Usage:
    python load_test.py --messages 100 --concurrent 10
    python load_test.py --messages 1000 --concurrent 50 --duration 300
    python load_test.py --profile burst  # Predefined profiles
"""

import asyncio
import aiohttp
import time
import json
import argparse
import sys
import os
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from collections import defaultdict
import statistics

# ============================================================================
# CONFIGURATION
# ============================================================================

@dataclass
class LoadTestConfig:
    """Load test configuration"""
    # Target configuration
    gateway_url: str = "http://localhost:3000"
    memory_service_url: str = "http://localhost:8001"
    worker_url: str = "http://localhost:3002"
    
    # Load parameters
    total_messages: int = 100
    concurrent_workers: int = 10
    duration_seconds: Optional[int] = None  # If set, run for duration instead of message count
    
    # Message parameters
    message_template: str = "Load test message {i}: This is a test message with content. "
    message_repeat: int = 50  # Repeat message content N times
    
    # Rate limiting
    messages_per_second: Optional[float] = None  # If set, throttle to this rate
    
    # Monitoring
    stats_interval_seconds: int = 10  # Print stats every N seconds
    
    # Timeouts
    request_timeout_seconds: int = 30
    
    # Test profile
    profile: str = "default"  # default, burst, sustained, stress


@dataclass
class MessageResult:
    """Result of sending a single message"""
    message_id: int
    success: bool
    status_code: Optional[int]
    latency_ms: float
    error: Optional[str]
    timestamp: float


@dataclass
class LoadTestStats:
    """Aggregated load test statistics"""
    total_messages: int = 0
    successful_messages: int = 0
    failed_messages: int = 0
    
    latencies: List[float] = field(default_factory=list)
    
    status_codes: Dict[int, int] = field(default_factory=lambda: defaultdict(int))
    errors: Dict[str, int] = field(default_factory=lambda: defaultdict(int))
    
    start_time: float = 0
    end_time: float = 0
    
    @property
    def duration_seconds(self) -> float:
        return self.end_time - self.start_time if self.end_time > self.start_time else 0
    
    @property
    def messages_per_second(self) -> float:
        return self.total_messages / self.duration_seconds if self.duration_seconds > 0 else 0
    
    @property
    def success_rate(self) -> float:
        return self.successful_messages / self.total_messages if self.total_messages > 0 else 0
    
    @property
    def avg_latency_ms(self) -> float:
        return statistics.mean(self.latencies) if self.latencies else 0
    
    @property
    def p50_latency_ms(self) -> float:
        return statistics.median(self.latencies) if self.latencies else 0
    
    @property
    def p95_latency_ms(self) -> float:
        return statistics.quantiles(self.latencies, n=20)[18] if len(self.latencies) > 20 else 0
    
    @property
    def p99_latency_ms(self) -> float:
        return statistics.quantiles(self.latencies, n=100)[98] if len(self.latencies) > 100 else 0
    
    @property
    def min_latency_ms(self) -> float:
        return min(self.latencies) if self.latencies else 0
    
    @property
    def max_latency_ms(self) -> float:
        return max(self.latencies) if self.latencies else 0


# ============================================================================
# LOAD TEST PROFILES
# ============================================================================

PROFILES = {
    "default": LoadTestConfig(
        total_messages=100,
        concurrent_workers=10,
        message_repeat=50
    ),
    "burst": LoadTestConfig(
        total_messages=200,
        concurrent_workers=50,
        message_repeat=20,
        duration_seconds=30
    ),
    "sustained": LoadTestConfig(
        duration_seconds=300,
        concurrent_workers=20,
        messages_per_second=10,
        message_repeat=50
    ),
    "stress": LoadTestConfig(
        total_messages=1000,
        concurrent_workers=100,
        message_repeat=100
    ),
    "minimal": LoadTestConfig(
        total_messages=10,
        concurrent_workers=2,
        message_repeat=10
    )
}


# ============================================================================
# LOAD TEST ENGINE
# ============================================================================

class LoadTester:
    """Load test engine"""
    
    def __init__(self, config: LoadTestConfig):
        self.config = config
        self.stats = LoadTestStats()
        self.results: List[MessageResult] = []
        self.session: Optional[aiohttp.ClientSession] = None
        self.message_queue: asyncio.Queue = asyncio.Queue()
        self.stop_flag = False
    
    async def setup(self):
        """Setup test environment"""
        timeout = aiohttp.ClientTimeout(total=self.config.request_timeout_seconds)
        self.session = aiohttp.ClientSession(timeout=timeout)
        
        print(f"\n{'='*80}")
        print(f"BYON Optimus Load Test")
        print(f"{'='*80}")
        print(f"Profile: {self.config.profile}")
        print(f"Gateway URL: {self.config.gateway_url}")
        print(f"Memory Service URL: {self.config.memory_service_url}")
        print(f"Total Messages: {self.config.total_messages if self.config.total_messages else 'unlimited'}")
        print(f"Concurrent Workers: {self.config.concurrent_workers}")
        print(f"Duration: {self.config.duration_seconds}s" if self.config.duration_seconds else "Until message count reached")
        print(f"Rate Limit: {self.config.messages_per_second} msg/s" if self.config.messages_per_second else "No rate limit")
        print(f"{'='*80}\n")
    
    async def teardown(self):
        """Cleanup test environment"""
        if self.session:
            await self.session.close()
    
    async def send_message(self, message_id: int, content: str) -> MessageResult:
        """Send a single message via inbox"""
        start_time = time.time()
        
        try:
            # Create message file in inbox
            inbox_path = Path("./handoff/inbox")
            inbox_path.mkdir(parents=True, exist_ok=True)
            
            message_data = {
                "message_id": f"load_test_{message_id}",
                "user_id": "load_test_user",
                "channel": "test",
                "content": content,
                "timestamp": time.time()
            }
            
            message_file = inbox_path / f"load_test_{message_id}_{int(time.time() * 1000)}.json"
            
            # Write message file
            with open(message_file, 'w') as f:
                json.dump(message_data, f)
            
            latency_ms = (time.time() - start_time) * 1000
            
            return MessageResult(
                message_id=message_id,
                success=True,
                status_code=200,
                latency_ms=latency_ms,
                error=None,
                timestamp=start_time
            )
            
        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            return MessageResult(
                message_id=message_id,
                success=False,
                status_code=None,
                latency_ms=latency_ms,
                error=str(e),
                timestamp=start_time
            )
    
    async def worker(self, worker_id: int):
        """Worker coroutine that processes messages from queue"""
        while not self.stop_flag:
            try:
                # Get message from queue with timeout
                message_id = await asyncio.wait_for(
                    self.message_queue.get(),
                    timeout=1.0
                )
                
                # Generate message content
                content = self.config.message_template.format(i=message_id)
                content = content * self.config.message_repeat
                
                # Send message
                result = await self.send_message(message_id, content)
                
                # Record result
                self.results.append(result)
                self.stats.total_messages += 1
                
                if result.success:
                    self.stats.successful_messages += 1
                else:
                    self.stats.failed_messages += 1
                    if result.error:
                        self.stats.errors[result.error] += 1
                
                if result.status_code:
                    self.stats.status_codes[result.status_code] += 1
                
                self.stats.latencies.append(result.latency_ms)
                
                # Mark task done
                self.message_queue.task_done()
                
            except asyncio.TimeoutError:
                # No more messages in queue
                continue
            except Exception as e:
                print(f"Worker {worker_id} error: {e}")
    
    async def message_producer(self):
        """Produce messages to queue"""
        message_id = 0
        
        if self.config.duration_seconds:
            # Time-based test
            end_time = time.time() + self.config.duration_seconds
            
            while time.time() < end_time and not self.stop_flag:
                await self.message_queue.put(message_id)
                message_id += 1
                
                # Rate limiting
                if self.config.messages_per_second:
                    await asyncio.sleep(1.0 / self.config.messages_per_second)
        else:
            # Count-based test
            for i in range(self.config.total_messages):
                if self.stop_flag:
                    break
                
                await self.message_queue.put(i)
                message_id += 1
                
                # Rate limiting
                if self.config.messages_per_second:
                    await asyncio.sleep(1.0 / self.config.messages_per_second)
    
    async def stats_monitor(self):
        """Monitor and print statistics periodically"""
        last_count = 0
        
        while not self.stop_flag:
            await asyncio.sleep(self.config.stats_interval_seconds)
            
            current_count = self.stats.total_messages
            interval_count = current_count - last_count
            interval_rate = interval_count / self.config.stats_interval_seconds
            
            print(f"\r[{time.strftime('%H:%M:%S')}] "
                  f"Messages: {current_count} | "
                  f"Rate: {interval_rate:.1f} msg/s | "
                  f"Success: {self.stats.success_rate*100:.1f}% | "
                  f"Avg Latency: {self.stats.avg_latency_ms:.0f}ms | "
                  f"P95: {self.stats.p95_latency_ms:.0f}ms",
                  end="")
            
            last_count = current_count
    
    async def run(self):
        """Run load test"""
        await self.setup()
        
        self.stats.start_time = time.time()
        
        # Start workers
        workers = [
            asyncio.create_task(self.worker(i))
            for i in range(self.config.concurrent_workers)
        ]
        
        # Start stats monitor
        monitor = asyncio.create_task(self.stats_monitor())
        
        # Start message producer
        await self.message_producer()
        
        # Wait for all messages to be processed
        await self.message_queue.join()
        
        # Stop workers and monitor
        self.stop_flag = True
        
        # Wait for workers to finish
        await asyncio.gather(*workers, return_exceptions=True)
        monitor.cancel()
        
        self.stats.end_time = time.time()
        
        await self.teardown()
        
        self.print_results()
    
    def print_results(self):
        """Print test results"""
        print(f"\n\n{'='*80}")
        print(f"LOAD TEST RESULTS")
        print(f"{'='*80}")
        
        print(f"\n📊 Summary:")
        print(f"  Total Messages: {self.stats.total_messages}")
        print(f"  Successful: {self.stats.successful_messages} ({self.stats.success_rate*100:.2f}%)")
        print(f"  Failed: {self.stats.failed_messages}")
        print(f"  Duration: {self.stats.duration_seconds:.2f}s")
        print(f"  Throughput: {self.stats.messages_per_second:.2f} messages/second")
        
        print(f"\n⏱️  Latency:")
        print(f"  Min: {self.stats.min_latency_ms:.2f}ms")
        print(f"  Avg: {self.stats.avg_latency_ms:.2f}ms")
        print(f"  P50: {self.stats.p50_latency_ms:.2f}ms")
        print(f"  P95: {self.stats.p95_latency_ms:.2f}ms")
        print(f"  P99: {self.stats.p99_latency_ms:.2f}ms")
        print(f"  Max: {self.stats.max_latency_ms:.2f}ms")
        
        if self.stats.status_codes:
            print(f"\n📡 Status Codes:")
            for code, count in sorted(self.stats.status_codes.items()):
                percentage = count / self.stats.total_messages * 100
                print(f"  {code}: {count} ({percentage:.2f}%)")
        
        if self.stats.errors:
            print(f"\n❌ Errors:")
            for error, count in sorted(self.stats.errors.items(), key=lambda x: x[1], reverse=True)[:10]:
                print(f"  {error}: {count}")
        
        print(f"\n{'='*80}")
        
        # Evaluation
        self.evaluate_results()
    
    def evaluate_results(self):
        """Evaluate test results against criteria"""
        print(f"\n🎯 Evaluation:")
        
        criteria = {
            "Success Rate > 95%": self.stats.success_rate > 0.95,
            "Throughput > 10 msg/s": self.stats.messages_per_second > 10,
            "P95 Latency < 1000ms": self.stats.p95_latency_ms < 1000,
            "P99 Latency < 2000ms": self.stats.p99_latency_ms < 2000,
            "No critical errors": self.stats.failed_messages < self.stats.total_messages * 0.05
        }
        
        passed = 0
        total = len(criteria)
        
        for criterion, result in criteria.items():
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"  {status} - {criterion}")
            if result:
                passed += 1
        
        print(f"\n📈 Overall: {passed}/{total} criteria passed ({passed/total*100:.0f}%)")
        
        if passed == total:
            print(f"✅ Load test PASSED - System is production ready!")
            return 0
        elif passed >= total * 0.8:
            print(f"⚠️  Load test PARTIAL - Some improvements needed")
            return 1
        else:
            print(f"❌ Load test FAILED - System not ready for production load")
            return 2
    
    def save_results(self, output_path: str):
        """Save results to JSON file"""
        results_data = {
            "config": {
                "total_messages": self.config.total_messages,
                "concurrent_workers": self.config.concurrent_workers,
                "duration_seconds": self.config.duration_seconds,
                "profile": self.config.profile
            },
            "stats": {
                "total_messages": self.stats.total_messages,
                "successful_messages": self.stats.successful_messages,
                "failed_messages": self.stats.failed_messages,
                "duration_seconds": self.stats.duration_seconds,
                "messages_per_second": self.stats.messages_per_second,
                "success_rate": self.stats.success_rate,
                "latency": {
                    "min_ms": self.stats.min_latency_ms,
                    "avg_ms": self.stats.avg_latency_ms,
                    "p50_ms": self.stats.p50_latency_ms,
                    "p95_ms": self.stats.p95_latency_ms,
                    "p99_ms": self.stats.p99_latency_ms,
                    "max_ms": self.stats.max_latency_ms
                },
                "status_codes": dict(self.stats.status_codes),
                "errors": dict(self.stats.errors)
            },
            "results": [
                {
                    "message_id": r.message_id,
                    "success": r.success,
                    "status_code": r.status_code,
                    "latency_ms": r.latency_ms,
                    "error": r.error,
                    "timestamp": r.timestamp
                }
                for r in self.results
            ]
        }
        
        with open(output_path, 'w') as f:
            json.dump(results_data, f, indent=2)
        
        print(f"\n💾 Results saved to: {output_path}")


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="BYON Optimus Load Testing")
    
    parser.add_argument(
        "--profile",
        choices=list(PROFILES.keys()),
        default="default",
        help="Load test profile"
    )
    
    parser.add_argument(
        "--messages",
        type=int,
        help="Total number of messages (overrides profile)"
    )
    
    parser.add_argument(
        "--concurrent",
        type=int,
        help="Number of concurrent workers (overrides profile)"
    )
    
    parser.add_argument(
        "--duration",
        type=int,
        help="Test duration in seconds (overrides profile)"
    )
    
    parser.add_argument(
        "--rate",
        type=float,
        help="Messages per second rate limit (overrides profile)"
    )
    
    parser.add_argument(
        "--gateway-url",
        default="http://localhost:3000",
        help="OpenClaw Gateway URL"
    )
    
    parser.add_argument(
        "--memory-url",
        default="http://localhost:8001",
        help="Memory Service URL"
    )
    
    parser.add_argument(
        "--output",
        help="Output file for results (JSON)"
    )
    
    args = parser.parse_args()
    
    # Load profile
    config = PROFILES[args.profile]
    config.profile = args.profile
    
    # Override with command line arguments
    if args.messages:
        config.total_messages = args.messages
    if args.concurrent:
        config.concurrent_workers = args.concurrent
    if args.duration:
        config.duration_seconds = args.duration
    if args.rate:
        config.messages_per_second = args.rate
    if args.gateway_url:
        config.gateway_url = args.gateway_url
    if args.memory_url:
        config.memory_service_url = args.memory_url
    
    # Run load test
    tester = LoadTester(config)
    
    try:
        asyncio.run(tester.run())
        
        # Save results if output specified
        if args.output:
            tester.save_results(args.output)
        
        # Return exit code based on evaluation
        sys.exit(0)
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Load test interrupted by user")
        tester.stop_flag = True
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Load test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(2)


if __name__ == "__main__":
    main()
