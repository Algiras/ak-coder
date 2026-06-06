import { FileSystem, LLMService, Logger, ChatMessage } from '../../ports';
import { WorkspaceIndexer } from '../history/indexer';

export class AgentCompactor {
  constructor(
    private fs: FileSystem,
    private llm: LLMService,
    private logger: Logger,
    private getIndexer: () => WorkspaceIndexer,
    private getSessionId: () => string | null,
    private getMessages: () => ChatMessage[],
    private setMessages: (msgs: ChatMessage[]) => void,
    private getSummary: () => string | null,
    private setSummary: (sum: string | null) => void,
    private resolvePath: (p: string) => string
  ) {}

  async forceCompact(
    onStart?: () => void,
    onEnd?: () => void
  ): Promise<{ messagesBefore: number; messagesAfter: number; summaryLength: number }> {
    const messagesBefore = this.getMessages().length;
    onStart?.();
    await this.compact();
    onEnd?.();
    return {
      messagesBefore,
      messagesAfter: this.getMessages().length,
      summaryLength: this.getSummary()?.length ?? 0
    };
  }

  async compact(): Promise<void> {
    this.logger.info('Context limit exceeded. Compacting history...');
    
    const messages = this.getMessages();
    const preserveCount = Math.min(4, messages.length);
    const summaryTarget = messages.slice(0, messages.length - preserveCount);
    const preserved = messages.slice(messages.length - preserveCount);

    const compactionPrompt: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a summarization assistant. Summarize the following dialogue between a developer and a coding agent. Retain all engineering decisions, filenames, edits, and technical details. Keep it concise.'
      },
      ...summaryTarget
    ];

    const summaryResult = await this.llm.chat(compactionPrompt);
    const summary = summaryResult.text;
    this.setSummary(summary);
    this.setMessages(preserved);

    const sessionId = this.getSessionId();
    if (sessionId && summary) {
      const summaryFile = `.ak-coder/history/summary_${sessionId}.txt`;
      const resolvedPath = this.resolvePath(summaryFile);
      try {
        await this.fs.writeFile(resolvedPath, summary);
      } catch (e) {
        this.logger.warn(`Failed to save summary file: ${(e as Error).message}`);
      }
      this.getIndexer().indexSummary(summary, sessionId);
    }

    this.logger.info('Compaction complete', { summaryLength: summary?.length ?? 0 });
  }
}
