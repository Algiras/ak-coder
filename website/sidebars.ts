import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/configuration',
        'getting-started/first-run',
      ],
    },
    {
      type: 'category',
      label: 'Tools',
      items: [
        'tools/index',
        'tools/read-write',
        'tools/bash',
        'tools/search',
        'tools/planning',
      ],
    },
    {
      type: 'category',
      label: 'Providers',
      items: [
        'providers/index',
        'providers/ollama',
        'providers/openrouter',
        'providers/others',
      ],
    },
    {
      type: 'category',
      label: 'Plugins & Skills',
      items: [
        'plugins/index',
        'plugins/building',
        'plugins/skills',
      ],
    },
    {
      type: 'category',
      label: 'Eval Harness',
      items: [
        'evals/index',
        'evals/writing-evals',
        'evals/running',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/flows',
        {
          type: 'category',
          label: 'ADRs',
          items: [
            'adrs/index',
            'adrs/01_hexagonal_architecture',
            'adrs/02_react_loop_safety',
            'adrs/03_plugin_system_hooks',
            'adrs/04_skills_system',
            'adrs/05_confirmation_policy',
            'adrs/06_session_forking',
            'adrs/07_plugin_output_schema',
            'adrs/08_core_tools',
            'adrs/09_semantic_search_vector_store',
            'adrs/10_subagent_task_delegation',
            'adrs/11_plan_mode_gating',
          ],
        },
      ],
    },
  ],
};

export default sidebars;
