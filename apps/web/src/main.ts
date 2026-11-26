import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { registerBuiltinNodes } from './shared/nodes'
import 'virtual:uno.css'
import '@unocss/reset/tailwind.css'
import '@xyflow/vue/style.css'
import './styles.css'

registerBuiltinNodes()

createApp(App).use(createPinia()).use(router).mount('#app')
