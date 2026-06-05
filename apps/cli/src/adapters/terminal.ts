import { TerminalIo } from '@ak-coder/core';
import * as readline from 'readline';

export class NodeTerminalIo implements TerminalIo {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: (line: string) => {
        // Tab autocompletion fallback
        const completions = ['/ping', '/context', '/help', '/history', '/resume', '/fork', '/exit'];
        const hits = completions.filter((c) => c.startsWith(line));
        return [hits.length ? hits : completions, line];
      }
    });
  }

  ask(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async askConfirm(question: string, defaultConfirm = true): Promise<boolean> {
    const suffix = defaultConfirm ? '[Y/n]' : '[y/N]';
    const answer = await this.ask(`${question} ${suffix}: `);
    if (!answer) return defaultConfirm;
    const lower = answer.toLowerCase();
    if (lower === 'y' || lower === 'yes') return true;
    if (lower === 'n' || lower === 'no') return false;
    return defaultConfirm;
  }

  write(text: string): void {
    process.stdout.write(text + '\n');
  }

  writeError(text: string): void {
    process.stderr.write(`\x1b[31m${text}\x1b[0m\n`); // red text
  }

  async selectMenu<T>(message: string, choices: { name: string; value: T }[]): Promise<T> {
    this.write(`\n\x1b[36m? ${message}\x1b[0m (Use number keys)`);
    for (let i = 0; i < choices.length; i++) {
      this.write(`  ${i + 1}) ${choices[i].name}`);
    }
    while (true) {
      const answer = await this.ask(`Select option (1-${choices.length}): `);
      const index = parseInt(answer, 10) - 1;
      if (index >= 0 && index < choices.length) {
        return choices[index].value;
      }
      this.writeError(`Invalid option. Please choose a number between 1 and ${choices.length}.`);
    }
  }

  close() {
    this.rl.close();
  }
}
