(function (global) {
  // FREEMIUM MODEL: no per-wash commission — mirrors lib/commission.js.
  var TIERS = {
    1: { label: 'Tier 1', platformRate: 0, operatorRate: 1, platformLabel: '0%', operatorLabel: '100%' },
    2: { label: 'Tier 2', platformRate: 0, operatorRate: 1, platformLabel: '0%', operatorLabel: '100%' },
  }

  function normalizeTier(tier) {
    return Number(tier) === 2 ? 2 : 1
  }

  function splitWashPrice(washPrice, tier) {
    var t = normalizeTier(tier)
    var cfg = TIERS[t]
    var price = Math.round(Number(washPrice) || 0)
    var operatorAmount = Math.round(price * cfg.operatorRate)
    return {
      tier: t,
      washPrice: price,
      operatorAmount: operatorAmount,
      platformAmount: price - operatorAmount,
      operatorRate: cfg.operatorRate,
      platformRate: cfg.platformRate,
      operatorLabel: cfg.operatorLabel,
      platformLabel: cfg.platformLabel,
      tierLabel: cfg.label,
    }
  }

  function resolveTier(operatorTier, washPointTier) {
    if (operatorTier != null && operatorTier !== '') return normalizeTier(operatorTier)
    if (washPointTier != null && washPointTier !== '') return normalizeTier(washPointTier)
    return 1
  }

  global.SplashPassCommission = {
    TIERS: TIERS,
    normalizeTier: normalizeTier,
    splitWashPrice: splitWashPrice,
    resolveTier: resolveTier,
  }
})(typeof window !== 'undefined' ? window : globalThis)
