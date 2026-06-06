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
            'adrs/hexagonal_architecture',
            'adrs/react_loop_safety',
            'adrs/plugin_system_hooks',
            'adrs/skills_system',
            'adrs/confirmation_policy',
            'adrs/session_forking',
            'adrs/plugin_output_schema',
            'adrs/core_tools',
            'adrs/semantic_search_vector_store',
            'adrs/subagent_task_delegation',
            'adrs/plan_mode_gating',
          ],
        },
      ],
    },
  ],
};

export default sidebars;
