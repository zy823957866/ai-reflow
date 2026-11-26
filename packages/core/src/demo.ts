import type { WorkflowDefinition } from './types'

const inputSchema = {
  type: 'object',
  required: ['question'],
  properties: {
    question: { type: 'string', title: '问题' },
    locale: { type: 'string', title: '语言', default: 'zh-CN' },
    files: { type: 'array', title: '附件', default: [] },
  },
}

/**
 * 返回三个稳定演示工作流定义。
 *
 * 固定 ID 与 `docs/13` seed 基线一致，API、worker 和 smoke 都使用这批
 * 定义，避免浏览器 mock 与数据库出现结构漂移。
 *
 * @returns 以 workflow publicId 为键的独立定义副本。
 */
export function createDemoWorkflowDefinitions(): Record<string, WorkflowDefinition> {
  return structuredClone({
    wf_support: {
      schemaVersion: '1.0',
      name: '客服知识问答',
      nodes: [
        {
          id: 'n_start',
          type: 'start',
          title: '开始',
          x: 46,
          y: 290,
          manifestVersion: '1.0.0',
          config: { entryMode: 'manual', inputSchema },
        },
        {
          id: 'n_kb',
          type: 'knowledge',
          title: '知识库检索',
          x: 310,
          y: 110,
          manifestVersion: '1.0.0',
          config: {
            operation: 'retrieve',
            knowledgeBaseId: ['kb_product_docs'],
            query: '{{ $input.question }}',
            topK: 5,
            scoreThreshold: 0.62,
            retrievalMode: 'keyword',
          },
        },
        {
          id: 'n_tool',
          type: 'tool',
          title: '订单查询',
          x: 310,
          y: 286,
          manifestVersion: '1.0.0',
          config: {
            kind: 'mcp',
            serverId: 'mcp_github',
            toolName: 'search_issues',
            arguments: { query: '{{ $input.question }}', limit: 10 },
            timeoutMs: 30000,
          },
        },
        {
          id: 'n_llm',
          type: 'llm',
          title: '生成回答',
          x: 568,
          y: 216,
          manifestVersion: '1.0.0',
          config: {
            mode: 'generate',
            modelConnectionId: 'mc_openai_gpt4o',
            temperature: 0.7,
            maxTokens: 2048,
            systemPrompt:
              '你是 Acme 的资深客服，只依据资料回答用户。资料：{{ $node.n_kb.output.context }}',
            prompt: '{{ $input.question }}',
          },
        },
        {
          id: 'n_condition',
          type: 'condition',
          title: '置信度判断',
          x: 824,
          y: 216,
          manifestVersion: '1.0.0',
          config: {
            mode: 'binary',
            conditions: [
              {
                left: '{{ $node.n_llm.output.text }}',
                operator: 'contains',
                right: 'UNKNOWN',
              },
            ],
          },
        },
        {
          id: 'n_template',
          type: 'template',
          title: '回复模板',
          x: 560,
          y: 416,
          manifestVersion: '1.0.0',
          config: {
            template: '根据 {{ $node.n_kb.output.context }} 回答 {{ $input.question }}。',
            parser: 'text',
          },
        },
        {
          id: 'n_human',
          type: 'human',
          title: '转人工坐席',
          x: 824,
          y: 416,
          manifestVersion: '1.0.0',
          config: {
            mode: 'approval',
            title: '请补充缺失信息',
            description: '回答置信度不足，转人工继续处理。',
          },
        },
        {
          id: 'n_output',
          type: 'output',
          title: '回复用户',
          x: 1080,
          y: 210,
          manifestVersion: '1.0.0',
          config: {
            mode: 'chat_response',
            content: '{{ $node.n_llm.output.text }}',
          },
        },
        {
          id: 'n_var',
          type: 'variable',
          title: '更新客户上下文',
          x: 80,
          y: 490,
          manifestVersion: '1.0.0',
          config: {
            mode: 'assign',
            assignments: { customer_tier: 'standard' },
          },
        },
      ],
      edges: [
        { id: 'e_start_kb', source: 'n_start', target: 'n_kb', sourceHandle: 'out' },
        { id: 'e_start_tool', source: 'n_start', target: 'n_tool', sourceHandle: 'out' },
        { id: 'e_kb_llm', source: 'n_kb', target: 'n_llm', sourceHandle: 'out' },
        { id: 'e_tool_llm', source: 'n_tool', target: 'n_llm', sourceHandle: 'out' },
        { id: 'e_llm_condition', source: 'n_llm', target: 'n_condition', sourceHandle: 'out' },
        {
          id: 'e_condition_template',
          source: 'n_condition',
          target: 'n_template',
          sourceHandle: 'false',
          label: 'false',
          type: 'branch',
        },
        {
          id: 'e_condition_output',
          source: 'n_condition',
          target: 'n_output',
          sourceHandle: 'true',
          label: 'true',
          type: 'branch',
        },
        {
          id: 'e_condition_human',
          source: 'n_condition',
          target: 'n_human',
          sourceHandle: 'default',
          label: 'UNKNOWN',
          type: 'branch',
        },
        { id: 'e_template_output', source: 'n_template', target: 'n_output', sourceHandle: 'out' },
        {
          id: 'e_human_output',
          source: 'n_human',
          target: 'n_output',
          sourceHandle: 'approved',
          label: 'approved',
          type: 'branch',
        },
        { id: 'e_start_var', source: 'n_start', target: 'n_var', sourceHandle: 'out' },
      ],
    },
    wf_lead_scoring: {
      schemaVersion: '1.0',
      name: '销售线索评分',
      nodes: [
        {
          id: 'lead_start',
          type: 'start',
          title: '接收线索',
          x: 40,
          y: 150,
          manifestVersion: '1.0.0',
          config: {
            entryMode: 'webhook',
            webhookPath: 'leads/inbound',
            inputSchema: {
              type: 'object',
              required: ['leadId'],
              properties: { leadId: { type: 'string', title: '线索 ID' } },
            },
          },
        },
        {
          id: 'lead_tool',
          type: 'tool',
          title: '拉取 CRM 信息',
          x: 300,
          y: 150,
          manifestVersion: '1.0.0',
          config: {
            kind: 'http',
            url: 'https://crm.example.com/api/leads',
            method: 'POST',
            headers: { Authorization: 'secret://crm' },
            body: { leadId: '{{ $input.leadId }}' },
          },
        },
        {
          id: 'lead_llm',
          type: 'llm',
          title: 'BANT 维度评分',
          x: 560,
          y: 150,
          manifestVersion: '1.0.0',
          config: {
            mode: 'structured',
            modelConnectionId: 'mc_openai_gpt4o',
            prompt: '分析线索并输出 BANT 评分：{{ $node.lead_tool.output.result }}',
            jsonSchema: {
              type: 'object',
              required: ['score'],
              properties: { score: { type: 'number' } },
            },
          },
        },
        {
          id: 'lead_var',
          type: 'variable',
          title: '写入评分',
          x: 820,
          y: 150,
          manifestVersion: '1.0.0',
          config: {
            mode: 'assign',
            assignments: { score: '{{ $node.lead_llm.output.structured.score }}' },
          },
        },
        {
          id: 'lead_out',
          type: 'output',
          title: '返回 CRM',
          x: 1060,
          y: 150,
          manifestVersion: '1.0.0',
          config: {
            mode: 'api_response',
            outputMapping: { score: '{{ $vars.score }}' },
          },
        },
      ],
      edges: [
        { id: 'lead_e1', source: 'lead_start', target: 'lead_tool' },
        { id: 'lead_e2', source: 'lead_tool', target: 'lead_llm' },
        { id: 'lead_e3', source: 'lead_llm', target: 'lead_var' },
        { id: 'lead_e4', source: 'lead_var', target: 'lead_out' },
      ],
    },
    wf_weekly_report: {
      schemaVersion: '1.0',
      name: '周报生成流水线',
      nodes: [
        {
          id: 'report_start',
          type: 'start',
          title: '定时触发',
          x: 40,
          y: 180,
          manifestVersion: '1.0.0',
          config: {
            entryMode: 'manual',
            inputSchema: {
              type: 'object',
              required: ['data'],
              properties: { data: { type: 'string', title: '汇总数据' } },
            },
          },
        },
        {
          id: 'report_parallel',
          type: 'parallel',
          title: '并发取数',
          x: 260,
          y: 180,
          manifestVersion: '1.0.0',
          config: {
            join: 'all',
            branches: [
              { id: 'jira', label: 'Jira' },
              { id: 'git', label: 'Git' },
            ],
          },
        },
        {
          id: 'report_tool_a',
          type: 'tool',
          title: '查询 Jira',
          x: 480,
          y: 90,
          manifestVersion: '1.0.0',
          config: { kind: 'http', url: 'https://jira.example.com/api' },
        },
        {
          id: 'report_tool_b',
          type: 'tool',
          title: '查询 Git',
          x: 480,
          y: 270,
          manifestVersion: '1.0.0',
          config: { kind: 'http', url: 'https://git.example.com/api' },
        },
        {
          id: 'report_llm',
          type: 'llm',
          title: '生成周报',
          x: 730,
          y: 180,
          manifestVersion: '1.0.0',
          config: {
            mode: 'generate',
            modelConnectionId: 'mc_openai_gpt4o',
            prompt: '根据 {{ $input.data }} 生成团队周报',
          },
        },
        {
          id: 'report_template',
          type: 'template',
          title: '排版',
          x: 960,
          y: 180,
          manifestVersion: '1.0.0',
          config: {
            template: '{{ $node.report_llm.output.text }}',
            parser: 'markdown',
          },
        },
        {
          id: 'report_out',
          type: 'output',
          title: '发送飞书',
          x: 1160,
          y: 180,
          manifestVersion: '1.0.0',
          config: { mode: 'workflow_output' },
        },
      ],
      edges: [
        { id: 'report_e1', source: 'report_start', target: 'report_parallel' },
        {
          id: 'report_e2',
          source: 'report_parallel',
          target: 'report_tool_a',
          sourceHandle: 'join',
        },
        {
          id: 'report_e3',
          source: 'report_parallel',
          target: 'report_tool_b',
          sourceHandle: 'join',
        },
        { id: 'report_e4', source: 'report_tool_a', target: 'report_llm' },
        { id: 'report_e5', source: 'report_tool_b', target: 'report_llm' },
        { id: 'report_e6', source: 'report_llm', target: 'report_template' },
        { id: 'report_e7', source: 'report_template', target: 'report_out' },
      ],
    },
  })
}
