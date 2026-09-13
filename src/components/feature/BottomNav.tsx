import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export interface BottomNavItem {
  path: string;
  labelKey: string;
  icon: string;
  iconActive: string;
  badge?: number;
}

export default function BottomNav({ items }: { items: BottomNavItem[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-t border-background-100/80 pb-safe">
      <div className="flex items-stretch justify-around">
        {items.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-label={t(item.labelKey)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[60px] transition-colors cursor-pointer ${
                active ? 'text-accent-500' : 'text-foreground-400 hover:text-foreground-600'
              }`}
            >
              <i className={`${active ? item.iconActive : item.icon} text-[22px] leading-none`} />
              {typeof item.badge === 'number' && item.badge > 0 && (
                <span className="absolute top-2 right-[calc(50%-24px)] min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
              {active && (
                <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-[3px] rounded-full bg-accent-500" />
              )}
              <span className={`text-[11px] leading-none ${active ? 'font-semibold' : 'font-normal'}`}>
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}