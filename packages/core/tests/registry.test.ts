import { describe, it, expect, beforeEach } from 'bun:test';
import { DependencyRegistry } from '../src/registry';
import {
  MockFileSystem,
  MockTerminalIo,
  MockProcessRunner,
  MockLlmService,
  MockSessionStore,
  MockLogger
} from '../src/mocks';

describe('DependencyRegistry', () => {
  beforeEach(() => {
    DependencyRegistry.clear();
  });

  it('should register and resolve FileSystem adapter', async () => {
    const mockFs = new MockFileSystem();
    DependencyRegistry.register('fileSystem', mockFs);

    const resolved = DependencyRegistry.get('fileSystem');
    expect(resolved).toBe(mockFs);

    await resolved.writeFile('/test.txt', 'hello workspace');
    expect(await resolved.exists('/test.txt')).toBe(true);
    expect(await resolved.readFile('/test.txt')).toBe('hello workspace');
  });

  it('should register and resolve TerminalIo adapter', async () => {
    const mockTerminal = new MockTerminalIo();
    DependencyRegistry.register('terminalIo', mockTerminal);

    const resolved = DependencyRegistry.get('terminalIo');
    expect(resolved).toBe(mockTerminal);

    mockTerminal.inputs.push('user input');
    expect(await resolved.ask('some prompt')).toBe('user input');
  });

  it('should throw an error if dependency is not registered', () => {
    expect(() => {
      DependencyRegistry.get('fileSystem');
    }).toThrow('Dependency for key "fileSystem" not registered.');
  });
});
