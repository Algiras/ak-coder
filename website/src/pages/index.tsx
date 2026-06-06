import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const features = [
  {
    title: 'Any LLM, locally or cloud',
    description:
      'Ollama (free, local), OpenRouter, Gemini, Groq, DeepSeek — or any OpenAI-compatible endpoint. Switch providers with one config line.',
  },
  {
    title: '12 built-in tools',
    description:
      'read_file, write_file, str_replace, patch_file, bash, glob, grep_search, semantic_search, web_fetch, delegate_task, and more — with parallel read-only execution.',
  },
  {
    title: 'Hexagonal architecture',
    description:
      'AgentCore is fully decoupled from Node.js. Ports define every I/O boundary — making the core fast to test and easy to port.',
  },
  {
    title: 'Plugin system',
    description:
      'Extend with local MCP servers via plugin.json. Add lifecycle hooks, custom slash commands (Skills), and new tools without touching core.',
  },
  {
    title: 'Sub-agents',
    description:
      'Delegate subtasks to isolated agent instances. Each sub-agent gets its own context and tool set, up to a configurable depth.',
  },
  {
    title: 'Eval harness',
    description:
      '18 LLM-as-judge eval cases covering all built-in tools. Run multi-provider comparative reports to track quality across model upgrades.',
  },
];

function Hero() {
  return (
    <div className={styles.hero}>
      <div className={styles.heroInner}>
        <h1 className={styles.heroTitle}>ak-coder</h1>
        <p className={styles.heroSubtitle}>
          A hackable LLM coding agent for the terminal.
          <br />
          Local or cloud. Any provider. Fully extensible.
        </p>
        <div className={styles.install}>
          <code>bunx @algiras/ak-coder</code>
        </div>
        <div className={styles.heroCtas}>
          <Link className="button button--primary button--lg" to="/docs/getting-started/installation">
            Get Started
          </Link>
          <Link className="button button--secondary button--lg" href="https://github.com/Algiras/ak-coder">
            GitHub
          </Link>
        </div>
      </div>
    </div>
  );
}

function Features() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featuresGrid}>
          {features.map(({title, description}) => (
            <div key={title} className={styles.feature}>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <Hero />
      <main>
        <Features />
      </main>
    </Layout>
  );
}
