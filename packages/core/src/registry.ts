import { FileSystem, TerminalIo, ProcessRunner, LLMService, SessionStore, Logger } from './ports';

export interface RegistryTypes {
  fileSystem: FileSystem;
  terminalIo: TerminalIo;
  processRunner: ProcessRunner;
  llmService: LLMService;
  sessionStore: SessionStore;
  logger: Logger;
}

export class DependencyRegistry {
  private static instances = new Map<keyof RegistryTypes, any>();

  static register<K extends keyof RegistryTypes>(key: K, instance: RegistryTypes[K]): void {
    this.instances.set(key, instance);
  }

  static get<K extends keyof RegistryTypes>(key: K): RegistryTypes[K] {
    const instance = this.instances.get(key);
    if (!instance) {
      throw new Error(`Dependency for key "${key}" not registered.`);
    }
    return instance;
  }

  static clear(): void {
    this.instances.clear();
  }
}
