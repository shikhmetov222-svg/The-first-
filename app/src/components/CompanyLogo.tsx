import { LOGO_COLORS, LOGO_ICONS } from '../company';

/** Квадратный логотип компании: цветной фон, тёмная линейная иконка. */
export function CompanyLogo({ icon, color, size = 48 }: { icon: string; color: string; size?: number }) {
  const Icon = LOGO_ICONS[icon] ?? LOGO_ICONS.crown;
  const bg = LOGO_COLORS[color] ?? LOGO_COLORS.gold;
  return (
    <span
      className="company-logo"
      style={{ width: size, height: size, borderRadius: size * 0.3, background: bg }}
      aria-hidden="true"
    >
      <Icon size={size * 0.52} strokeWidth={2.2} />
    </span>
  );
}
