<script setup>
import { ref } from 'vue'
const props = defineProps({ code: { type: String, default: '' } })
const copied = ref(false)
async function copy(){ await navigator.clipboard.writeText(props.code); copied.value=true; setTimeout(()=>copied.value=false,1200) }
</script>
<template>
  <div class="overflow-hidden rounded-sm border border-white/10 bg-[#02060b]">
    <div class="flex justify-end border-b border-white/10 px-3 py-2"><button @click="copy" class="text-xs text-slate-400 hover:text-white">{{ copied ? 'Copied' : 'Copy' }}</button></div>
    <pre class="overflow-auto p-4 text-xs leading-6 text-cyan-100"><code>{{ code }}</code></pre>
  </div>
</template>
