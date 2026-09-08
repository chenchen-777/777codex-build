import { ensure } from './errors.mjs';

// Display-only platform snapshot. Never used for billing, routing or auth.
export function normalizeProviderGroup(input, previous = {}) {
  const result = {};
  const name = input.groupName === undefined ? previous.groupName : input.groupName;
  if (name !== undefined && name !== null) {
    ensure(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 120 && !/[\x00-\x1f\x7f-\x9f]/.test(name), '分组名称无效', 'INVALID_PROVIDER_GROUP');
    result.groupName = name.trim();
  }
  const multiplier = input.groupMultiplier === undefined ? previous.groupMultiplier : input.groupMultiplier;
  if (multiplier !== undefined && multiplier !== null) {
    ensure((typeof multiplier === 'number' || (typeof multiplier === 'string' && multiplier.length <= 64 && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(multiplier))) && Number.isFinite(Number(multiplier)) && Number(multiplier) >= 0, '分组倍率无效', 'INVALID_PROVIDER_GROUP');
    result.groupMultiplier = Number(multiplier);
  }
  return result;
}
