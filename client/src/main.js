import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import Home from './views/Home.vue'
import HttpBuilder from './views/HttpBuilder.vue'
import Webhooks from './views/Webhooks.vue'
import WebSockets from './views/WebSockets.vue'
import OpenApi from './views/OpenApi.vue'
import Tools from './views/Tools.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/http', component: HttpBuilder },
    { path: '/webhooks', component: Webhooks },
    { path: '/websockets', component: WebSockets },
    { path: '/openapi', component: OpenApi },
    { path: '/tools', component: Tools }
  ]
})

createApp(App).use(router).mount('#app')
