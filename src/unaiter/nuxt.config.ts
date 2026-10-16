// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: [
    '@nuxt/ui',
    './plugins/router',
  ],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  runtimeConfig: {
    // Server-only. Override at runtime with NUXT_ADMINISTRATOR_USERNAME.
    administratorUsername: process.env.ADMINISTRATOR_USERNAME || 'admin',
    // Server-only. Override at runtime with NUXT_ADMINISTRATOR_PASSWORD.
    administratorPassword: process.env.ADMINISTRATOR_PASSWORD || '',
    // Server-only. Override at runtime with NUXT_DATA_ROOT.
    dataRoot: './data',
  },
  vite: {
    server: {
      allowedHosts: true,
    },
  },
})
