import { useCallback } from 'react';

interface MockTaskResult {
  task_id: string;
  conv_id: string;
}

const MOCK_DAG = {
  intent: 'research',
  subtasks: [
    { id: 't1', name: 'market_searcher', role: 'web_searcher', tools: ['search_engine', 'webfetch'], depends_on: [] },
    { id: 't2', name: 'policy_analyst', role: 'web_searcher', tools: ['search_engine', 'webfetch'], depends_on: [] },
    { id: 't3', name: 'data_analyst', role: 'data_analyst', tools: ['python_executor'], depends_on: ['t1', 't2'] },
    { id: 't4', name: 'report_writer', role: 'writer', tools: ['file_writer'], depends_on: ['t3'] },
  ],
  parallel_groups: [['t1', 't2'], ['t3'], ['t4']],
};

export function useMockRunner(onEvent: (event: Record<string, unknown>) => void) {
  const runMockTask = useCallback(async (_query: string): Promise<MockTaskResult> => {
    const taskId = 'mock_' + Date.now();
    const convId = 'mock_conv';

    // Simulate decomposing delay
    await delay(800);
    onEvent({ type: 'status', msg: 'Decomposing task...' });

    await delay(600);
    onEvent({ type: 'dag', ...MOCK_DAG });

    // Group 1: t1, t2
    await delay(300);
    onEvent({ type: 'status', msg: 'Agents starting...' });
    onEvent({ type: 'progress', completed: 0, total: 4 });

    onEvent({ type: 'status', msg: 'market_searcher is searching...' });
    onEvent({ type: 'agent_start', subtask_id: 't1', agent_name: 'market_searcher', role: 'web_searcher' });
    onEvent({ type: 'status', msg: 'policy_analyst is searching...' });
    onEvent({ type: 'agent_start', subtask_id: 't2', agent_name: 'policy_analyst', role: 'web_searcher' });

    await delay(200);
    onEvent({ type: 'tool_call', agent_name: 'market_searcher', tool: 'search_engine', args: '{"query":"AI chip market 2025"}' });
    onEvent({ type: 'tool_call', agent_name: 'policy_analyst', tool: 'search_engine', args: '{"query":"chip policy China"}' });

    await delay(1500);
    onEvent({ type: 'agent_done', subtask_id: 't1', state: 'completed', output: '## Market Data\n- Vendor A: 23% share\n- Vendor B: 18% share', retry_count: 0 });
    onEvent({ type: 'progress', completed: 1, total: 4 });
    onEvent({ type: 'agent_done', subtask_id: 't2', state: 'completed', output: '## Policy Summary\n- National Chip Initiative\n- 15% tax rebate', retry_count: 0 });
    onEvent({ type: 'progress', completed: 2, total: 4 });

    // Group 2: t3
    await delay(300);
    onEvent({ type: 'status', msg: 'data_analyst is analyzing...' });
    onEvent({ type: 'agent_start', subtask_id: 't3', agent_name: 'data_analyst', role: 'data_analyst' });

    await delay(400);
    onEvent({ type: 'tool_call', agent_name: 'data_analyst', tool: 'python_executor', args: '{"code":"import pandas as pd\\ndf = pd.DataFrame(...)"}' });

    await delay(1200);
    onEvent({ type: 'agent_done', subtask_id: 't3', state: 'completed', output: '## Analysis\nMarket concentration CR3 = 52%. Growth rate 34% YoY.', retry_count: 0 });
    onEvent({ type: 'progress', completed: 3, total: 4 });

    // Group 3: t4
    await delay(300);
    onEvent({ type: 'status', msg: 'report_writer is writing...' });
    onEvent({ type: 'agent_start', subtask_id: 't4', agent_name: 'report_writer', role: 'writer' });

    await delay(1000);
    onEvent({ type: 'agent_done', subtask_id: 't4', state: 'completed', output: '# China AI Chip Market Report 2025\n\n## Overview\nThe domestic AI chip market is experiencing rapid growth...\n\n## Key Findings\n1. Top 3 vendors control 52% market share\n2. Government policy strongly favors domestic chips\n3. Annual growth rate: 34%', retry_count: 0 });
    onEvent({ type: 'progress', completed: 4, total: 4 });

    await delay(200);
    onEvent({ type: 'done', summary: '## Result Summary\n\n4/4 subtasks completed', results: [] });

    return { task_id: taskId, conv_id: convId };
  }, [onEvent]);

  return { runMockTask };
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
