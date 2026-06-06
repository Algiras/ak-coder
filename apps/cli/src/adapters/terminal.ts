import { TerminalIo, ConfirmationRequest, ConfirmationResult } from '@ak-coder/core';
import * as readline from 'readline';

export class NodeTerminalIo implements TerminalIo {
  private rl: readline.Interface | null;

  /**
   * @param noReadline  Set true in --stdio mode (StdioJsonRpcAdapter owns stdin).
   * @param getCompletions  Optional supplier of tab-completion strings.
   *        Pass REPL_COMMAND_NAMES from repl.ts to keep completions in sync with
   *        the command registry without hardcoding them here.
   */
  constructor(noReadline = false, getCompletions?: () => string[]) {
    if (noReadline) {
      this.rl = null;
      return;
    }
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: (line: string) => {
        const completions = getCompletions ? getCompletions() : [];
        const hits = completions.filter((c) => c.startsWith(line));
        return [hits.length ? hits : completions, line];
      }
    });
  }

  ask(question: string): Promise<string> {
    if (!this.rl) return Promise.resolve('');
    return new Promise((resolve) => {
      // Use prompt() instead of question() so Bun's readline fires the
      // completer on Tab. question() bypasses the completer in Bun 1.x.
      this.rl!.setPrompt(question);
      this.rl!.prompt();
      this.rl!.once('line', (answer) => {
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

  async confirm(request: ConfirmationRequest): Promise<ConfirmationResult> {
    const isCommand = request.action === 'bash';

    // Print detail (diff or command)
    this.write('');
    if (isCommand) {
      this.write(`\x1b[33m  $ ${request.detail}\x1b[0m`);
    } else {
      this.write(request.detail);
    }
    this.write('');

    // Build choice list
    const choices = isCommand
      ? '  [y] Yes  [a] Yes to all  [e] Edit  [n] No'
      : '  [y] Yes  [a] Yes to all  [n] No';
    this.write(`\x1b[36m${request.description}\x1b[0m`);
    this.write(choices);

    while (true) {
      const answer = (await this.ask('\x1b[90m  Choice: \x1b[0m')).toLowerCase().trim();

      if (answer === 'y' || answer === 'yes') {
        return { approved: true, applyToAll: false };
      }
      if (answer === 'a') {
        return { approved: true, applyToAll: true };
      }
      if (answer === 'n' || answer === 'no' || answer === '') {
        return { approved: false, applyToAll: false };
      }
      if (answer === 'e' && isCommand) {
        const edited = await this.ask(`\x1b[33m  Edit command: \x1b[0m`);
        if (edited.trim()) {
          return { approved: true, applyToAll: false, edited: edited.trim() };
        }
        // Empty edit = deny
        return { approved: false, applyToAll: false };
      }
      this.writeError(`  Unknown choice "${answer}". Enter y, a, n${isCommand ? ', or e' : ''}.`);
    }
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
    this.rl?.close();
  }
}
