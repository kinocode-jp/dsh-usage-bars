// Warp: WARP_API_KEY / WARP_TOKEN (wk-... API キー)
import { getJson, findKey, offNoKey, fail, clamp } from '../util.js'

const base = { id: 'warp', label: 'Warp' }
const QUERY = `query GetRequestLimitInfo($requestContext: RequestContext!) {
  user(requestContext: $requestContext) { __typename ... on UserOutput { user {
    requestLimitInfo { isUnlimited nextRefreshTime requestLimit requestsUsedSinceLastRefresh }
    bonusGrants { requestCreditsGranted requestCreditsRemaining expiration }
    workspaces { bonusGrantsInfo { grants { requestCreditsGranted requestCreditsRemaining expiration } } }
  } } } }`

export default async function fetchWarp() {
  try {
    const key = await findKey(['WARP_API_KEY', 'WARP_TOKEN'])
    if (!key) return offNoKey(base, ['WARP_API_KEY'])
    const ver = '15.0.0'
    const body = JSON.stringify({
      query: QUERY, operationName: 'GetRequestLimitInfo',
      variables: { requestContext: { clientContext: {}, osContext: { category: 'macOS', name: 'macOS', version: ver } } },
    })
    const r = await getJson('https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo', {
      'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + key,
      'x-warp-client-id': 'warp-app', 'x-warp-os-category': 'macOS', 'x-warp-os-name': 'macOS', 'x-warp-os-version': ver,
      'user-agent': 'Warp/1.0',
    }, { method: 'POST', body })
    if (r.status === 401 || r.status === 403) return { ...base, status: 'error', error: 'APIキーが無効です', bars: [] }
    if (!r.ok) return fail(base, r)
    if (r.data?.errors?.length) return { ...base, status: 'error', error: 'APIエラー', bars: [] }
    const u = r.data?.data?.user?.user
    const li = u?.requestLimitInfo
    if (!li) return { ...base, status: 'error', error: '使用量を取得できません', bars: [] }
    const limit = Number(li.requestLimit) || 0, used = Number(li.requestsUsedSinceLastRefresh) || 0
    const t = Date.parse(li.nextRefreshTime)
    const bars = []
    if (li.isUnlimited) return { ...base, status: 'ok', plan: '無制限', bars: [{ label: '月', usedPercent: 0 }], text: '無制限' }
    bars.push({ label: '月', usedPercent: limit > 0 ? clamp(used / limit * 100) : 0, ...(Number.isFinite(t) && { resetsAt: new Date(t).toISOString() }) })
    const grants = [...(u.bonusGrants || []), ...(u.workspaces || []).flatMap(w => w?.bonusGrantsInfo?.grants || [])]
    const total = grants.reduce((s, g) => s + (Number(g.requestCreditsGranted) || 0), 0)
    const rem = grants.reduce((s, g) => s + (Number(g.requestCreditsRemaining) || 0), 0)
    if (total > 0) bars.push({ label: 'ボーナス', usedPercent: clamp((total - rem) / total * 100) })
    return { ...base, status: 'ok', bars, text: `${used}/${limit} クレジット` }
  } catch {
    return { ...base, status: 'error', error: '取得に失敗しました', bars: [] }
  }
}
