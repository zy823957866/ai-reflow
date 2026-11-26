import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { registerBuiltinNodes } from './shared/nodes'
import 'virtual:uno.css'
import './reset.css'
import '@xyflow/vue/style.css'
import 'vue-sonner/style.css'
import '@ai-reflow/ui/styles.css'
import './styles.css'

registerBuiltinNodes()

createApp(App).use(createPinia()).use(router).mount('#app')
