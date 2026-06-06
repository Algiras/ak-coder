# LLM Provider Evaluation Report

Generated on: 2026-06-06T07:31:03.344Z
Total cases run per provider: 18

## Summary Comparison

| Provider | Model | Pass Rate | Avg Latency | Avg Tokens |
| --- | --- | --- | --- | --- |
| **ollama** | `gemma4:31b-cloud` | 94% | 11.2s | 163 |
| **ollama-nemotron** | `nemotron-3-nano:30b-cloud` | 100% | 19.1s | 203 |

## Evaluation Binary Score Matrix

> `1` = stable pass · `0` = failing · `~` = flaky (passes/runs shown)

| Case | ollama (`gemma4:31b-cloud`) | ollama-nemotron (`nemotron-3-nano:30b-cloud`) |
| --- | --- | --- |
| bash: runs echo and reports output | **1** (3/3) | **1** (3/3) |
| bash: safe read-only commands run without confirmation | **1** (3/3) | **1** (3/3) |
| glob: finds TypeScript files matching **/*.ts | **1** (3/3) | **1** (3/3) |
| str_replace: targeted edit after read | **1** (3/3) | **1** (3/3) |
| str_replace: rejected when file not read first | **1** (3/3) | **1** (3/3) |
| web_fetch: fetches real URL and extracts meaningful text | **1** (3/3) | **1** (3/3) |
| session: context retained across multi-turn dialogue | **1** (3/3) | **1** (3/3) |
| session: compaction preserves context | **1** (3/3) | **1** (3/3) |
| skills: SKILL.md instruction is followed in response | **1** (3/3) | **1** (3/3) |
| read_file: reads file and reports content | **1** (3/3) | **1** (3/3) |
| write_file: writes new file content | ⚠️ ~ (1/3) | **1** (3/3) |
| patch_file: patches file after reading it | **1** (3/3) | **1** (3/3) |
| list_directory: list contents of workspace | **1** (3/3) | **1** (3/3) |
| grep_search: finds target pattern in workspace | **1** (3/3) | **1** (3/3) |
| semantic_search: index workspace and find relevant file | **1** (3/3) | **1** (3/3) |
| delegate_task: spawns sub-agent and gets findings | **1** (3/3) | **1** (3/3) |
| plan: planning mode restricts mutations and returns structured plan | **1** (3/3) | **1** (3/3) |
| golden: read and write file matching golden snapshot | **1** (3/3) | **1** (3/3) |

## Provider Details

### ollama (`gemma4:31b-cloud`)
- **Pass Rate**: 94%
- **Avg Latency**: 11.2s
- **Avg Tokens**: 163

| Case | Status | Latency | Tokens | Details / Failures |
| --- | --- | --- | --- | --- |
| bash: runs echo and reports output | ✅ PASS | 2.0s | 39 |  |
| bash: safe read-only commands run without confirmation | ✅ PASS | 2.3s | 41 |  |
| glob: finds TypeScript files matching **/*.ts | ✅ PASS | 3.1s | 52 |  |
| str_replace: targeted edit after read | ✅ PASS | 3.0s | 63 |  |
| str_replace: rejected when file not read first | ✅ PASS | 3.1s | 80 |  |
| web_fetch: fetches real URL and extracts meaningful text | ✅ PASS | 2.0s | 72 |  |
| session: context retained across multi-turn dialogue | ✅ PASS | 59.0s | 356 |  |
| session: compaction preserves context | ✅ PASS | 27.1s | 754 |  |
| skills: SKILL.md instruction is followed in response | ✅ PASS | 1.5s | 10 |  |
| read_file: reads file and reports content | ✅ PASS | 2.4s | 31 |  |
| write_file: writes new file content | ✅ PASS | 15.0s | 354 |  |
| patch_file: patches file after reading it | ✅ PASS | 6.5s | 67 |  |
| list_directory: list contents of workspace | ✅ PASS | 30.6s | 85 |  |
| grep_search: finds target pattern in workspace | ✅ PASS | 8.8s | 105 |  |
| semantic_search: index workspace and find relevant file | ✅ PASS | 4.2s | 167 |  |
| delegate_task: spawns sub-agent and gets findings | ✅ PASS | 10.1s | 258 |  |
| plan: planning mode restricts mutations and returns structured plan | ✅ PASS | 9.3s | 235 |  |
| golden: read and write file matching golden snapshot | ✅ PASS | 10.9s | 160 |  |

### ollama-nemotron (`nemotron-3-nano:30b-cloud`)
- **Pass Rate**: 100%
- **Avg Latency**: 19.1s
- **Avg Tokens**: 203

| Case | Status | Latency | Tokens | Details / Failures |
| --- | --- | --- | --- | --- |
| bash: runs echo and reports output | ✅ PASS | 3.0s | 43 |  |
| bash: safe read-only commands run without confirmation | ✅ PASS | 2.6s | 45 |  |
| glob: finds TypeScript files matching **/*.ts | ✅ PASS | 4.0s | 53 |  |
| str_replace: targeted edit after read | ✅ PASS | 17.4s | 89 |  |
| str_replace: rejected when file not read first | ✅ PASS | 7.5s | 93 |  |
| web_fetch: fetches real URL and extracts meaningful text | ✅ PASS | 4.1s | 84 |  |
| session: context retained across multi-turn dialogue | ✅ PASS | 3.3s | 150 |  |
| session: compaction preserves context | ✅ PASS | 9.6s | 898 |  |
| skills: SKILL.md instruction is followed in response | ✅ PASS | 3.6s | 10 |  |
| read_file: reads file and reports content | ✅ PASS | 2.9s | 38 |  |
| write_file: writes new file content | ✅ PASS | 69.4s | 165 |  |
| patch_file: patches file after reading it | ✅ PASS | 6.7s | 96 |  |
| list_directory: list contents of workspace | ✅ PASS | 7.8s | 71 |  |
| grep_search: finds target pattern in workspace | ✅ PASS | 8.8s | 115 |  |
| semantic_search: index workspace and find relevant file | ✅ PASS | 60.5s | 614 |  |
| delegate_task: spawns sub-agent and gets findings | ✅ PASS | 10.5s | 215 |  |
| plan: planning mode restricts mutations and returns structured plan | ✅ PASS | 6.1s | 695 |  |
| golden: read and write file matching golden snapshot | ✅ PASS | 116.6s | 188 |  |

