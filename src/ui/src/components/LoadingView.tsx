import { useT } from '../i18n/index';

type Props = {
  label?: string;
  fullCanvas?: boolean;
};

export default function LoadingView({ label, fullCanvas = false }: Props) {
  const t = useT();
  return (
    <div className={`loading-view${fullCanvas ? ' loading-view-full' : ''}`} role="status" aria-live="polite">
      <div className="loading-card">
        <span className="loading-spinner" aria-hidden="true" />
        <div>
          <div className="loading-label">{label ?? t('Loading')}</div>
          <div className="loading-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
