# BYON Optimus Load Testing

Comprehensive load testing suite for validating system performance under high concurrent message volume.

## Features

- ✅ Simulate 100+ concurrent messages
- ✅ Multiple test profiles (burst, sustained, stress)
- ✅ Rate limiting testing
- ✅ Latency percentile tracking (P50, P95, P99)
- ✅ Success rate monitoring
- ✅ Resource utilization tracking
- ✅ Error pattern analysis
- ✅ Production readiness evaluation

## Prerequisites

```bash
pip install aiohttp
```

## Quick Start

### Run Default Load Test (100 messages, 10 workers)
```bash
cd tests/load
python load_test.py
```

### Run with Custom Parameters
```bash
# 200 messages with 20 concurrent workers
python load_test.py --messages 200 --concurrent 20

# 5-minute sustained test at 10 msg/s
python load_test.py --duration 300 --rate 10 --concurrent 20

# Stress test: 1000 messages, 100 workers
python load_test.py --messages 1000 --concurrent 100
```

## Test Profiles

### Default Profile
**Purpose**: Basic validation  
**Config**: 100 messages, 10 workers  
**Use case**: Quick smoke test

```bash
python load_test.py --profile default
```

### Burst Profile
**Purpose**: Spike traffic simulation  
**Config**: 200 messages, 50 workers, 30s duration  
**Use case**: Test system under sudden traffic spike

```bash
python load_test.py --profile burst
```

### Sustained Profile
**Purpose**: Long-running stability test  
**Config**: 5 minutes, 20 workers, 10 msg/s  
**Use case**: Validate system stability over time

```bash
python load_test.py --profile sustained
```

### Stress Profile
**Purpose**: Maximum load testing  
**Config**: 1000 messages, 100 workers  
**Use case**: Find breaking points and limits

```bash
python load_test.py --profile stress
```

### Minimal Profile
**Purpose**: Quick validation  
**Config**: 10 messages, 2 workers  
**Use case**: Fast sanity check

```bash
python load_test.py --profile minimal
```

## Results Interpretation

### Sample Output
```
================================================================================
LOAD TEST RESULTS
================================================================================

📊 Summary:
  Total Messages: 100
  Successful: 98 (98.00%)
  Failed: 2
  Duration: 12.45s
  Throughput: 8.03 messages/second

⏱️  Latency:
  Min: 45.23ms
  Avg: 156.78ms
  P50: 142.56ms
  P95: 287.91ms
  P99: 345.22ms
  Max: 456.78ms

📡 Status Codes:
  200: 98 (98.00%)
  429: 2 (2.00%)

🎯 Evaluation:
  ✅ PASS - Success Rate > 95%
  ❌ FAIL - Throughput > 10 msg/s
  ✅ PASS - P95 Latency < 1000ms
  ✅ PASS - P99 Latency < 2000ms
  ✅ PASS - No critical errors

📈 Overall: 4/5 criteria passed (80%)
⚠️  Load test PARTIAL - Some improvements needed
```

## Evaluation Criteria

### Success Rate
- **Target**: > 95%
- **Definition**: Percentage of messages successfully processed
- **Red Flag**: < 90% indicates system instability

### Throughput
- **Target**: > 10 messages/second
- **Definition**: Average messages processed per second
- **Red Flag**: < 5 msg/s indicates bottleneck

### P95 Latency
- **Target**: < 1000ms
- **Definition**: 95th percentile response time
- **Red Flag**: > 2000ms indicates performance issues

### P99 Latency
- **Target**: < 2000ms
- **Definition**: 99th percentile response time
- **Red Flag**: > 5000ms indicates severe performance issues

### Error Rate
- **Target**: < 5%
- **Definition**: Percentage of failed messages
- **Red Flag**: > 10% indicates critical issues

## Advanced Usage

### Save Results to File
```bash
python load_test.py --messages 1000 --output results.json
```

### Custom URLs
```bash
python load_test.py \
  --gateway-url http://production-gateway:3000 \
  --memory-url http://production-memory:8001
```

### Rate-Limited Test
```bash
# Test rate limiting at 50 msg/s
python load_test.py --duration 60 --rate 50 --concurrent 10
```

## Monitoring During Test

### Real-time Statistics
The test prints real-time statistics every 10 seconds:
```
[14:32:15] Messages: 457 | Rate: 15.2 msg/s | Success: 98.7% | Avg Latency: 234ms | P95: 456ms
```

### Docker Stats
Monitor resource usage:
```bash
# In another terminal
watch -n 2 'docker stats --no-stream'
```

### Service Logs
Watch for errors:
```bash
docker logs -f byon-worker
docker logs -f byon-auditor
docker logs -f byon-memory
```

## Troubleshooting

### Low Throughput
**Symptoms**: < 5 msg/s  
**Possible Causes**:
- CPU bottleneck (check `docker stats`)
- Memory service slow (check embeddings generation)
- Redis queue backup (check `redis-cli INFO`)
- Network latency

**Solutions**:
- Increase resource limits in docker-compose.yml
- Optimize embeddings batch size
- Check Redis persistence settings

### High Failure Rate
**Symptoms**: > 10% failures  
**Possible Causes**:
- Rate limiting triggered (429 errors)
- Service crashes (500 errors)
- Resource exhaustion (503 errors)
- Timeout issues

**Solutions**:
- Reduce concurrent workers
- Increase rate limit settings
- Check service health with `docker ps`
- Review error logs

### High Latency
**Symptoms**: P95 > 2000ms  
**Possible Causes**:
- Memory service slow (embeddings)
- Queue processing delay
- Disk I/O bottleneck
- CPU saturation

**Solutions**:
- Profile memory service with `py-spy`
- Check disk usage and IOPS
- Optimize FHRSS+FCPE settings
- Add more CPU resources

### Rate Limiting Errors (429)
**Expected Behavior**: Rate limiting is working correctly  
**Current Limit**: 100 requests per 60 seconds  
**Action**: If testing higher loads, adjust `RATE_LIMIT_REQUESTS` in docker-compose.yml

## Continuous Integration

### GitHub Actions
```yaml
# .github/workflows/load-test.yml
name: Load Test

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Start services
        run: docker-compose up -d
      
      - name: Wait for services
        run: sleep 30
      
      - name: Run load test
        run: |
          pip install aiohttp
          cd tests/load
          python load_test.py --profile default --output results.json
      
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: load-test-results
          path: tests/load/results.json
```

## Performance Baselines

### Expected Performance (Development)
- **Throughput**: 10-20 messages/second
- **Success Rate**: > 95%
- **P95 Latency**: 500-1000ms
- **P99 Latency**: 1000-2000ms

### Expected Performance (Production)
- **Throughput**: 20-50 messages/second
- **Success Rate**: > 99%
- **P95 Latency**: 200-500ms
- **P99 Latency**: 500-1000ms

### Scaling Guidelines

| Messages/Second | Recommended Workers | CPU Cores | Memory GB |
|----------------|-------------------|-----------|-----------|
| 10 | 5-10 | 2-4 | 4-8 |
| 25 | 10-20 | 4-8 | 8-16 |
| 50 | 20-30 | 8-12 | 16-24 |
| 100 | 30-50 | 12-16 | 24-32 |

## Best Practices

### Before Load Testing
1. ✅ Ensure all services are healthy
2. ✅ Clear old test data from handoff directories
3. ✅ Monitor baseline resource usage
4. ✅ Set up monitoring dashboards

### During Load Testing
1. ✅ Monitor service logs for errors
2. ✅ Track resource utilization (CPU, memory, disk)
3. ✅ Watch for rate limiting errors
4. ✅ Check queue depth in Redis

### After Load Testing
1. ✅ Review error patterns
2. ✅ Analyze latency distribution
3. ✅ Identify bottlenecks
4. ✅ Compare against baselines
5. ✅ Document findings

## Common Issues

### "Connection refused" errors
**Cause**: Services not running  
**Fix**: `docker-compose up -d` and wait 30s

### "Too many open files" errors
**Cause**: File descriptor limit  
**Fix**: `ulimit -n 4096`

### Redis connection errors
**Cause**: Redis not healthy  
**Fix**: `docker logs byon-redis` and restart if needed

### Memory service errors
**Cause**: Embeddings model not loaded  
**Fix**: Check memory-service logs, may need to pull model

## References

- [Production Audit](../../c:\Users\Lucian\.cursor\plans\enterprise_system_audit_989c3e19.plan.md)
- [Docker Compose Configuration](../../docker-compose.yml)
- [Memory Service](../../byon-orchestrator/memory-service/)
- [BYON Architecture](../../docs/BYON_ARCHITECTURE.md)
