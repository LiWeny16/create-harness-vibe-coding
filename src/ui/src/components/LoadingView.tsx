type Props = {
  label?: string;
  fullCanvas?: boolean;
};

export default function LoadingView({ label = 'Loading', fullCanvas = false }: Props) {
  return (
    <div className={`loading-view${fullCanvas ? ' loading-view-full' : ''}`} role="status" aria-live="polite">
      <div className="loading-card">
        <span className="loading-spinner" aria-hidden="true" />
        <div>
          <div className="loading-label">{label}</div>
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
