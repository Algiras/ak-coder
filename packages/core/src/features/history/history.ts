import { SessionStore, ChatMessage, FileSystem, LLMCallRecord } from '../../ports';

export class FileSessionStore implements SessionStore {
  constructor(private fs: FileSystem, private historyDir: string) {}

  private getSessionPath(sessionId: string): string {
    return `${this.historyDir.replace(/\/$/, '')}/${sessionId}.jsonl`;
  }

  async saveSession(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const lines = messages.map(m => JSON.stringify(m)).join('\n');
    await this.fs.writeFile(this.getSessionPath(sessionId), lines);
  }

  async loadSession(sessionId: string): Promise<ChatMessage[]> {
    const exists = await this.fs.exists(this.getSessionPath(sessionId));
    if (!exists) throw new Error(`Session ID "${sessionId}" not found.`);
    const content = await this.fs.readFile(this.getSessionPath(sessionId));
    if (!content.trim()) return [];
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as ChatMessage);
  }

  async listSessions(): Promise<{ sessionId: string; timestamp: number }[]> {
    const allFiles = await this.fs.listFiles(this.historyDir);
    const results: { sessionId: string; timestamp: number }[] = [];
    for (const file of allFiles) {
      if (file.endsWith('.jsonl')) {
        const base = file.split('/').pop() || '';
        const sessionId = base.replace('.jsonl', '');
        // Session ID is timestamp-based, parse it if possible
        const parts = sessionId.split('-');
        const timestamp = parseInt(parts[0], 10) || Date.now();
        results.push({ sessionId, timestamp });
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  private getCallsPath(): string {
    const baseDir = this.historyDir.replace(/\/history\/?$/, '').replace(/\/$/, '');
    return `${baseDir}/logs/calls.jsonl`;
  }

  async recordCall(record: LLMCallRecord): Promise<void> {
    const callsPath = this.getCallsPath();
    let currentContent = '';
    if (await this.fs.exists(callsPath)) {
      currentContent = await this.fs.readFile(callsPath);
    }
    const updatedContent = currentContent + JSON.stringify(record) + '\n';
    await this.fs.writeFile(callsPath, updatedContent);
  }

  async getCallRecords(): Promise<LLMCallRecord[]> {
    const callsPath = this.getCallsPath();
    const exists = await this.fs.exists(callsPath);
    if (!exists) return [];
    const content = await this.fs.readFile(callsPath);
    if (!content.trim()) return [];
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as LLMCallRecord);
  }

  // Branch (fork) a session at a specific turn index
  async forkSession(originalSessionId: string, turnIndex: number, newSessionId: string): Promise<ChatMessage[]> {
    const history = await this.loadSession(originalSessionId);
    if (turnIndex < 0 || turnIndex >= history.length) {
      throw new Error(`Turn index ${turnIndex} out of bounds (history size: ${history.length})`);
    }
    const branchedHistory = history.slice(0, turnIndex + 1);
    await this.saveSession(newSessionId, branchedHistory);
    return branchedHistory;
  }

  async truncateSession(sessionId: string, keepCount: number): Promise<void> {
    const history = await this.loadSession(sessionId);
    await this.saveSession(sessionId, history.slice(0, keepCount));
  }
}
