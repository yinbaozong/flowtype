import type { AppSettings, PublicSettings } from './types'

export function credentialSuffix(key?: string): string {
  const value = key?.trim() || ''
  return value.length > 8 ? value.slice(-8) : ''
}

export function publicProviderSettings(settings: AppSettings): PublicSettings {
  const clean = Object.fromEntries(Object.entries(settings).filter(([key]) => !key.endsWith('Encrypted'))) as AppSettings
  return {
    ...clean, qwenApiKey: '', volcanoApiKey: '', volcanoAccessKey: '', deepseekApiKey: '',
    hasQwenApiKey: Boolean(settings.qwenApiKey), hasVolcanoApiKey: Boolean(settings.volcanoApiKey), hasDeepSeekApiKey: Boolean(settings.deepseekApiKey),
    qwenKeySuffix: credentialSuffix(settings.qwenApiKey), volcanoKeySuffix: credentialSuffix(settings.volcanoApiKey),
    volcanoAccessKeySuffix: credentialSuffix(settings.volcanoAccessKey), deepseekKeySuffix: credentialSuffix(settings.deepseekApiKey)
  }
}

export type ProviderSettings = AppSettings & Partial<Omit<PublicSettings, keyof AppSettings>>

export function providerStatus(settings: ProviderSettings): { model: string; suffix: string; configured: boolean; legacy: boolean } {
  const realtime = settings.recognitionMode !== 'batch'
  const legacy = settings.provider === 'volcano' && Boolean(settings.volcanoAccessKey || settings.volcanoAccessKeySuffix)
  if (settings.provider === 'qwen') return { model: realtime ? 'qwen3-asr-flash-realtime' : 'qwen3-asr-flash', suffix: credentialSuffix(settings.qwenApiKey) || settings.qwenKeySuffix || '', configured: Boolean(settings.qwenApiKey || settings.hasQwenApiKey), legacy: false }
  if (settings.provider === 'volcano') return { model: realtime ? settings.volcanoResourceId || 'volc.seedasr.sauc.duration' : 'volc.bigasr.auc_turbo', suffix: legacy ? credentialSuffix(settings.volcanoAccessKey) || settings.volcanoAccessKeySuffix || '' : credentialSuffix(settings.volcanoApiKey) || settings.volcanoKeySuffix || '', configured: legacy || Boolean(settings.volcanoApiKey || settings.hasVolcanoApiKey), legacy }
  if (settings.provider === 'deepseek') return { model: 'DeepSeek ASR /v1/tools/asr', suffix: credentialSuffix(settings.deepseekApiKey) || settings.deepseekKeySuffix || '', configured: Boolean(settings.deepseekApiKey || settings.hasDeepSeekApiKey), legacy: false }
  return { model: 'Demo', suffix: '', configured: false, legacy: false }
}
