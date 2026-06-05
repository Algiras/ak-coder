import { FileSystem } from './ports';

export class IgnoreMatcher {
  private rules: RegExp[] = [];

  constructor() {
    // Default ignore rules
    this.addPattern('.git/**');
    this.addPattern('node_modules/**');
    this.addPattern('.ak-coder/**');
    this.addPattern('dist/**');
    this.addPattern('build/**');
  }

  addPattern(pattern: string) {
    let clean = pattern.trim();
    if (!clean || clean.startsWith('#')) return;

    // Convert glob to regex
    // Escape regex characters except *, ?
    let regexStr = clean
      .replace(/[-\/\\^$*+?.()|[\]{}]/g, (ch) => {
        if (ch === '*') return '.*';
        if (ch === '?') return '.';
        return '\\' + ch;
      });

    // Handle folder patterns
    if (clean.endsWith('/') || clean.endsWith('/**')) {
      regexStr = '^' + regexStr;
    } else {
      regexStr = '^' + regexStr + '(|/.*)$';
    }

    try {
      this.rules.push(new RegExp(regexStr));
    } catch {
      // Ignore invalid regexes
    }
  }

  async loadIgnoreFile(fs: FileSystem, filePath: string): Promise<void> {
    if (!(await fs.exists(filePath))) return;
    const content = await fs.readFile(filePath);
    const lines = content.split('\n');
    for (const line of lines) {
      this.addPattern(line);
    }
  }

  isIgnored(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    for (const rule of this.rules) {
      if (rule.test(normalized)) return true;
    }
    return false;
  }
}
