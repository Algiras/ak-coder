# Milestone 5: File & Image Context Ingestion

## Objectives
Implement workspace context ingestion, including checking `.gitignore`/`.akcoderignore`, attaching files and images, inspecting loaded context via `/context`, and executing summarization compaction.

## Deliverables
- [ ] Implement ignore file parser reading `.gitignore` and `.akcoderignore` recursively.
- [ ] Implement file scanner that automatically gathers active files and structures them in LLM prompts.
- [ ] Build `/context` slash command displaying active context details.
- [ ] Implement summarization compaction:
  *   When tokens exceed threshold, call LLM to summarize past turns.
  *   Update system instructions with the summary and purge old messages.
- [ ] Implement image ingestion supporting image path inputs or clipboard image buffers (if supported by OS).

## Verification
- Write unit tests for the ignore parser (verify ignored files are not scanned).
- Test summarization compaction with mock messages; verify that old messages are purged and system instructions updated.
