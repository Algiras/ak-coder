# LLM Provider Evaluation Report

Generated on: 2026-06-06T06:28:14.407Z
Total cases run per provider: 2

## Summary Comparison

| Provider | Model | Pass Rate | Avg Latency | Avg Tokens |
| --- | --- | --- | --- | --- |
| **ollama** | `gemma4:31b-cloud` | 100% | 6.7s | 160 |
| **groq** | `openai/gpt-oss-120b` | 100% | 3.2s | 84 |

## Provider Details

### ollama (`gemma4:31b-cloud`)
- **Pass Rate**: 100%
- **Avg Latency**: 6.7s
- **Avg Tokens**: 160

| Case | Status | Latency | Tokens | Details / Failures |
| --- | --- | --- | --- | --- |
| str_replace: targeted edit after read | ✅ PASS | 2.8s | 60 |  |
| str_replace: rejected when file not read first | ✅ PASS | 10.6s | 259 |  |

### groq (`openai/gpt-oss-120b`)
- **Pass Rate**: 100%
- **Avg Latency**: 3.2s
- **Avg Tokens**: 84

| Case | Status | Latency | Tokens | Details / Failures |
| --- | --- | --- | --- | --- |
| str_replace: targeted edit after read | ✅ PASS | 4.3s | 83 |  |
| str_replace: rejected when file not read first | ✅ PASS | 2.1s | 85 |  |

