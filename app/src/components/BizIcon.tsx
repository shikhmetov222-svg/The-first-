import type { BusinessType } from '../api';
import { BUSINESS_INFO } from '../content';

/** Иконка бизнеса в цветном квадрате. */
export function BizIcon({ type, size = 22 }: { type: BusinessType; size?: number }) {
  const Icon = BUSINESS_INFO[type].icon;
  return (
    <span className={`biz-icon ${type}`}>
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}
