export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
}

export class DiffEngine {
  static compare(oldStr: string, newStr: string): DiffLine[] {
    const oldLines = oldStr.split(/\r?\n/);
    const newLines = newStr.split(/\r?\n/);

    const M = oldLines.length;
    const N = newLines.length;

    // LCS DP Table
    const dp: number[][] = Array.from({ length: M + 1 }, () => Array(N + 1).fill(0));

    for (let i = 1; i <= M; i++) {
      for (let j = 1; j <= N; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to build diff
    const result: DiffLine[] = [];
    let i = M;
    let j = N;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({ type: 'unchanged', content: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ type: 'added', content: newLines[j - 1] });
        j--;
      } else {
        result.unshift({ type: 'removed', content: oldLines[i - 1] });
        i--;
      }
    }

    return result;
  }

  static renderColorDiff(diffs: DiffLine[]): string {
    let output = '';
    for (const line of diffs) {
      if (line.type === 'added') {
        output += `\x1b[32m+ ${line.content}\x1b[0m\n`; // Green +
      } else if (line.type === 'removed') {
        output += `\x1b[31m- ${line.content}\x1b[0m\n`; // Red -
      } else {
        output += `  ${line.content}\n`; // Normal
      }
    }
    return output;
  }
}
