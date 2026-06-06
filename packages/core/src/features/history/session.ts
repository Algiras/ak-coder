import { SessionStore, ChatMessage } from '../../ports';

export class AgentSessionManager {
  constructor(
    private store: SessionStore,
    private getMessages: () => ChatMessage[],
    private setMessages: (msgs: ChatMessage[]) => void,
    private getSessionId: () => string | null,
    private setSessionId: (id: string | null) => void,
    private onSessionResumed: (messages: ChatMessage[]) => void,
    private onNewSessionStarted: () => void
  ) {}

  async startSession(sessionId: string): Promise<void> {
    this.setSessionId(sessionId);
    try {
      const msgs = await this.store.loadSession(sessionId);
      this.setMessages(msgs);
      this.onSessionResumed(msgs);
    } catch {
      this.setMessages([]);
      this.onNewSessionStarted();
    }
  }

  async listSessions(): Promise<{ sessionId: string; timestamp: number }[]> {
    return this.store.listSessions();
  }

  async forkSession(turnIndex: number, newSessionId?: string): Promise<string> {
    const sessionId = this.getSessionId();
    if (!sessionId) throw new Error('No active session to fork.');
    await this.store.saveSession(sessionId, this.getMessages());
    const forkedId = newSessionId || `fork-${sessionId}-${Date.now()}`;
    await this.store.forkSession(sessionId, turnIndex, forkedId);
    return forkedId;
  }

  async rewindToTurn(turnIndex: number): Promise<void> {
    const sessionId = this.getSessionId();
    if (!sessionId) throw new Error('No active session to rewind.');

    const messages = this.getMessages();
    const userMessageIndices = messages
      .map((m, i) => (m.role === 'user' ? i : -1))
      .filter(i => i >= 0);

    if (turnIndex < 0 || turnIndex >= userMessageIndices.length) {
      throw new Error(`Turn ${turnIndex} out of range (0–${userMessageIndices.length - 1}).`);
    }

    const nextUserIdx = userMessageIndices[turnIndex + 1] ?? messages.length;
    const truncated = messages.slice(0, nextUserIdx);
    this.setMessages(truncated);
    await this.store.saveSession(sessionId, truncated);
  }

  getUserTurns(): { turnIndex: number; messageIndex: number; preview: string }[] {
    const result: { turnIndex: number; messageIndex: number; preview: string }[] = [];
    let turnIndex = 0;
    const messages = this.getMessages();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'user') {
        const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        result.push({
          turnIndex: turnIndex++,
          messageIndex: i,
          preview: raw.replace(/\n+/g, ' ').slice(0, 60),
        });
      }
    }
    return result;
  }
}
