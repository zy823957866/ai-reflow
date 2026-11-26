import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import EditorPage from '@/pages/EditorPage.vue'
import VersionsPage from '@/pages/VersionsPage.vue'
import TrialPage from '@/pages/TrialPage.vue'
import RunsPage from '@/pages/RunsPage.vue'
import RunDetailPage from '@/pages/RunDetailPage.vue'
import KnowledgePage from '@/pages/KnowledgePage.vue'
import McpPage from '@/pages/McpPage.vue'
import ModelsPage from '@/pages/ModelsPage.vue'
import NodesPage from '@/pages/NodesPage.vue'
import TemplatesPage from '@/pages/TemplatesPage.vue'
import PluginsPage from '@/pages/PluginsPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/workflows/:id', name: 'workflow-editor', component: EditorPage, meta: { layout: 'editor' } },
    { path: '/workflows/:id/versions', name: 'workflow-versions', component: VersionsPage },
    { path: '/workflows/:id/trial', name: 'workflow-trial', component: TrialPage },
    { path: '/runs', name: 'runs', component: RunsPage },
    { path: '/runs/:id', name: 'run-detail', component: RunDetailPage },
    { path: '/knowledge', name: 'knowledge', component: KnowledgePage },
    { path: '/mcp', name: 'mcp', component: McpPage },
    { path: '/models', name: 'models', component: ModelsPage },
    { path: '/nodes', name: 'nodes', component: NodesPage },
    { path: '/templates', name: 'templates', component: TemplatesPage },
    { path: '/plugins', name: 'plugins', component: PluginsPage },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
