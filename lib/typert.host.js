import { configSchema, patchSchema, usageSchema, daysSchema, historySchema, clearedSchema, providerNameSchema, routeKindSchema, enabledSchema } from './contracts.js'

const pkg = '@kinocode/dsh-usage-bars'
const strictCodec = (name, schema) => ({ mode: 'strict', typeSymbol: pkg + '#' + name, schema, create: () => schema })
const definitions = [
  ['getConfig', 'Config', configSchema],
  ['updateConfig', 'Config', configSchema, 'patch', 'Patch', patchSchema],
  ['getUsage', 'Usage', usageSchema],
  ['getHistory', 'History', historySchema, 'days', 'Days', daysSchema],
  ['clearHistory', 'Cleared', clearedSchema],
]
const ROUTE_PARAMETERS = [
  { name: 'provider', wire: 'provider', source: 'json', codec: strictCodec('Provider', providerNameSchema) },
  { name: 'kind', wire: 'kind', source: 'json', codec: strictCodec('RouteKind', routeKindSchema) },
  { name: 'enabled', wire: 'enabled', source: 'json', codec: strictCodec('Enabled', enabledSchema) },
]
export const TYPERT = {
  package: pkg,
  face: 'host',
  schemas: [],
  invocations: [...definitions.map(([method, resultName, resultSchema, arg, argName, argSchema]) => ({
    id: pkg + '#usageBars/' + method,
    service: 'usageBars', namespace: 'usageBars', method,
    invocation: { kind: 'direct' },
    parameters: arg ? [{ name: arg, wire: arg, source: 'json', ...(arg === 'days' ? { acceptsUndefined: true } : {}), codec: strictCodec(argName, argSchema) }] : [],
    result: strictCodec(resultName, resultSchema),
  })), {
    id: pkg + '#usageBars/setRoute', service: 'usageBars', namespace: 'usageBars', method: 'setRoute',
    invocation: { kind: 'direct' }, parameters: ROUTE_PARAMETERS, result: strictCodec('Config', configSchema),
  }],
  model: {
    services: [{
      key: 'usageBars', exportName: 'UsageBarsService', tags: [], types: [],
      description: '各サービスの使用量、表示設定、ローカル履歴。',
      summary: '使用量バーのホストサービス。',
      jsDoc: '/** 使用量バーのホストサービス(ctx.usageBars)。 */',
      members: [...definitions.map(([name]) => ({ kind: 'method', name,
        signature: ({ getConfig: 'getConfig(): Config', updateConfig: 'updateConfig(patch: Patch): Config', getUsage: 'getUsage(): Promise<Usage>', getHistory: 'getHistory(days?: number): History', clearHistory: 'clearHistory(): true' })[name],
        summary: ({ getConfig: '秘密情報を除いた公開設定を返す。', updateConfig: '設定の変更内容を検証して保存する。', getUsage: 'キャッシュ済みの使用量を返す。', getHistory: '最大30日分のローカル履歴を返す。', clearHistory: '保存済みの履歴を消去する。' })[name],
      })), { kind: 'method', name: 'setRoute', signature: 'setRoute(provider: string, kind: "subscription" | "api", enabled: boolean): Promise<Config>', summary: 'モデル登録側の枠を有効/無効にする。' }],
    }], events: [], objects: [],
  },
}
