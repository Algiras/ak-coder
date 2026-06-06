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

  static renderColorDiff(diffs: DiffLine[], contextLines = 3): string {
    const hasChange = diffs.some(l => l.type !== 'unchanged');
    if (!hasChange) {
      return 'No changes';
    }

    let oldLineNum = 1;
    let newLineNum = 1;

    const linesWithMeta = diffs.map(line => {
      const currentOld = oldLineNum;
      const currentNew = newLineNum;
      if (line.type === 'unchanged') {
        oldLineNum++;
        newLineNum++;
      } else if (line.type === 'removed') {
        oldLineNum++;
      } else if (line.type === 'added') {
        newLineNum++;
      }
      return {
        ...line,
        oldNum: currentOld,
        newNum: currentNew,
        isChange: line.type !== 'unchanged'
      };
    });

    const include = new Array(linesWithMeta.length).fill(false);
    for (let k = 0; k < linesWithMeta.length; k++) {
      if (linesWithMeta[k].isChange) {
        const start = Math.max(0, k - contextLines);
        const end = Math.min(linesWithMeta.length - 1, k + contextLines);
        for (let idx = start; idx <= end; idx++) {
          include[idx] = true;
        }
      }
    }

    let output = '';
    let idx = 0;
    while (idx < linesWithMeta.length) {
      if (!include[idx]) {
        idx++;
        continue;
      }

      const hunkLines: typeof linesWithMeta = [];
      while (idx < linesWithMeta.length && include[idx]) {
        hunkLines.push(linesWithMeta[idx]);
        idx++;
      }

      if (hunkLines.length === 0) continue;

      const oldLines = hunkLines.filter(l => l.type !== 'added');
      const newLines = hunkLines.filter(l => l.type !== 'removed');

      const oldStart = oldLines.length > 0 ? oldLines[0].oldNum : 1;
      const oldLen = oldLines.length;
      const newStart = newLines.length > 0 ? newLines[0].newNum : 1;
      const newLen = newLines.length;

      output += `\x1b[36m@@ -${oldStart},${oldLen} +${newStart},${newLen} @@\x1b[0m\n`;

      for (const line of hunkLines) {
        if (line.type === 'added') {
          output += `\x1b[32m+ ${line.content}\x1b[0m\n`;
        } else if (line.type === 'removed') {
          output += `\x1b[31m- ${line.content}\x1b[0m\n`;
        } else {
          output += `  ${line.content}\n`;
        }
      }
    }

    return output;
  }
}
