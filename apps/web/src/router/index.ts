import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import EditorPage from '@/pages/EditorPage.vue'
import VersionsPage from '@/pages/VersionsPage.vue'
import TrialPage from '@/pages/TrialPage.vue'
import RunsPage from '@/pages/RunsPage.vue'
import RunDetailPage from '@/pages/RunDetailPage.vue'
import KnowledgePage from '@/pages/knowledge-page/index.vue'
import AgentsPage from '@/pages/agents-page/index.vue'
import McpPage from '@/pages/McpPage.vue'
import ModelsPage from '@/pages/ModelsPage.vue'
import TemplatesPage from '@/pages/TemplatesPage.vue'
import PluginsPage from '@/pages/PluginsPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage, meta: { title: '工作流', layout: 'standard' } },
    { path: '/workflows/:id', name: 'workflow-editor', component: EditorPage, meta: { title: '工作流编辑器', layout: 'editor' } },
    { path: '/workflows/:id/versions', name: 'workflow-versions', component: VersionsPage, meta: { title: '版本历史', layout: 'standard' } },
    { path: '/workflows/:id/trial', name: 'workflow-trial', component: TrialPage, meta: { title: '试运行', layout: 'standard' } },
    { path: '/runs', name: 'runs', component: RunsPage, meta: { title: '运行记录', layout: 'standard' } },
    { path: '/runs/:id', name: 'run-detail', component: RunDetailPage, meta: { title: '运行详情', layout: 'standard' } },
    { path: '/knowledge', name: 'knowledge', component: KnowledgePage, meta: { title: '知识库', layout: 'standard' } },
    { path: '/agents', name: 'agents', component: AgentsPage, meta: { title: 'Agent 工作台', layout: 'standard' } },
    { path: '/agents/:id', name: 'agent-workbench', component: AgentsPage, meta: { title: 'Agent 工作台', layout: 'standard' } },
    { path: '/mcp', name: 'mcp', component: McpPage, meta: { title: 'MCP 调用', layout: 'standard' } },
    { path: '/models', name: 'models', component: ModelsPage, meta: { title: '模型与密钥', layout: 'standard' } },
    { path: '/templates', name: 'templates', component: TemplatesPage, meta: { title: '模板市场', layout: 'standard' } },
    { path: '/plugins', name: 'plugins', component: PluginsPage, meta: { title: '插件市场', layout: 'standard' } },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
